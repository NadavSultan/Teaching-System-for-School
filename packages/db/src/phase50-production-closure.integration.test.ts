import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessmentRevision,
  createPersonalWorkspace,
  acknowledgeSemanticWarning,
  getValidationResult,
  getRevisionValidationReadiness,
  prisma,
  publishCurriculumVersion,
  processValidationRun,
  requestRevisionValidation,
  resolveAccessContext,
  setSourceLifecycle,
} from './index.js';
import { validationResultSchema } from '@teach/contracts';
import { DeterministicFakeModelGateway, DeterministicFakeSemanticEvaluator } from '@teach/ai';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { processGenerationRun } from './generation.js';

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase50-closure-${crypto.randomUUID()}@example.test`,
    workspaceName: 'phase50 closure',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P50C-${crypto.randomUUID()}`,
      educationSystemCode: 'IL',
      subjectCode: 'MATH',
      displayName: 'Phase 50 closure',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1 },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G1', label: 'Grade 1', sortOrder: 1 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Closure',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    {
      version: '1.0.0',
      userId: workspace.user.id,
      email: workspace.user.normalizedEmail,
      provider: 'test',
      providerSubject: workspace.user.id,
      platformAdmin: false,
    },
    workspace.organization.id,
  );
  const revision = await createAssessmentRevision(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `revision-${crypto.randomUUID()}`,
    curriculumVersionId: version.id,
    curriculumNodeIds: [node.id],
    scoringMode: 'NONE',
    sections: [
      {
        key: 's1',
        title: 'Section',
        order: 0,
        questions: [
          {
            key: 'q1',
            type: 'SHORT_TEXT',
            prompt: 'Question',
            order: 0,
            answers: [{ key: 'a1', order: 0, text: 'Answer' }],
            rubrics: [],
            subQuestions: [],
          },
        ],
      },
    ],
  });
  return { workspace, assessment, revision, context };
}

describe('Phase 50 production service closure', () => {
  afterAll(() => prisma.$disconnect());

  it('converges concurrent same-key validation requests into one run and one ID-only outbox row', async () => {
    const f = await fixture();
    const input = {
      version: '1.0.0' as const,
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `same-${crypto.randomUUID()}`,
    };
    const [left, right] = await Promise.all([
      requestRevisionValidation(f.context, input),
      requestRevisionValidation(f.context, input),
    ]);
    expect(left.id).toBe(right.id);
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: {
          eventType: 'validation.requested',
          payload: { path: ['validationRunId'], equals: left.id },
        },
      }),
    ).toBe(1);
  });

  it('returns the strict non-disclosing validation-required shape for a missing revision', async () => {
    const f = await fixture();
    const expected = {
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    };
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, crypto.randomUUID()),
    ).resolves.toEqual(expected);
    const foreign = await fixture();
    await expect(
      getRevisionValidationReadiness(f.context, foreign.assessment.id, foreign.revision.id),
    ).resolves.toEqual(expected);
  });

  it('maps a persisted completed run through the strict result schema in registry order', async () => {
    const f = await fixture();
    const requested = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `result-${crypto.randomUUID()}`,
    });
    await processValidationRun(
      requested.id,
      prisma,
      new DeterministicFakeSemanticEvaluator({
        version: '1.0.0',
        evaluatorVersion: 'local-disabled-v1',
        promptVersion: 'validation-prompt-v1',
        modelConfigurationVersion: 'local-none-v1',
        schemaVersion: '1.0.0',
        revisionId: f.revision.id,
        findings: [
          {
            category: 'AMBIGUITY',
            code: 'AMBIGUITY_V1',
            severity: 'WARNING',
            path: 'semantic[0]',
            messageKey: 'ambiguity.persisted',
            evidence: { identity: 'semantic-persisted', revisionId: f.revision.id },
            confidenceBasisPoints: 8734,
          },
        ],
      }),
    );
    const result = await getValidationResult(f.context, requested.id);
    expect(result).not.toBeNull();
    expect(validationResultSchema.parse(result)).toEqual(result);
    expect(result!.executions).toHaveLength(11);
    expect(result!.executions.map((execution) => execution.ruleId)).toEqual([
      'REVISION_FINALIZED_AND_OWNED',
      'STRICT_REVISION_CONTRACT',
      'PLAN_COUNT_KEY_ORDER',
      'CURRICULUM_SCOPE_PUBLISHED',
      'ANSWER_COMPLETENESS_AND_TARGETS',
      'EXACT_SCORE_TREE',
      'STABLE_ID_AND_EXACT_DUPLICATE',
      'DETERMINISTIC_ANSWER_LEAKAGE',
      'SOURCE_LINK_COMPLETENESS_AND_IDENTITY',
      'CURRENT_SOURCE_ELIGIBILITY',
      'GENERATION_REVISION_PROVENANCE',
    ]);
    expect(result!.findings).toEqual(
      [...result!.findings].sort((a, b) =>
        `${a.kind}:${a.path}:${a.code}:${a.id}`.localeCompare(
          `${b.kind}:${b.path}:${b.code}:${b.id}`,
        ),
      ),
    );
    const deterministic = result!.findings.find((finding) => finding.kind === 'DETERMINISTIC');
    const semantic = result!.findings.find((finding) => finding.kind === 'SEMANTIC');
    expect(deterministic).toMatchObject({
      ruleVersion: '1.0.0',
      evaluatorVersion: null,
      schemaVersion: null,
      confidenceBasisPoints: null,
    });
    expect(semantic).toMatchObject({
      confidenceBasisPoints: 8734,
      ruleVersion: null,
      evaluatorVersion: 'local-disabled-v1',
      schemaVersion: '1.0.0',
    });
    const stored = await prisma.validationRun.findUniqueOrThrow({ where: { id: requested.id } });
    expect(stored).toMatchObject({
      state: 'SUCCEEDED',
      deterministicPassCount: 0,
      deterministicFailCount: 11,
      semanticFindingCount: 1,
      leaseExpiresAt: null,
    });
    expect(
      await prisma.validationRun.count({ where: { id: requested.id, state: 'SUCCEEDED' } }),
    ).toBe(1);
    expect(
      await prisma.semanticEvaluation.findUniqueOrThrow({
        where: { validationRunId: requested.id },
      }),
    ).toMatchObject({
      state: 'SUCCEEDED',
      evaluatorVersion: 'local-disabled-v1',
      promptVersion: 'validation-prompt-v1',
      modelConfigurationVersion: 'local-none-v1',
      schemaVersion: '1.0.0',
    });
    const successAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'validation.succeeded', targetId: requested.id },
    });
    expect(successAudit.metadata).toEqual({ deterministicFailCount: 11, semanticFindingCount: 1 });
  });

  it('converges semantic warning acknowledgement and records exactly one safe audit', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `ack-run-${crypto.randomUUID()}`,
    });
    await processValidationRun(run.id);
    const evaluation = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: run.id },
    });
    const finding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: run.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: evaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'WARNING',
        path: 'question[0]',
        messageKey: 'ambiguity.warning',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const input = {
      version: '1.0.0' as const,
      findingId: finding.id,
      reason: 'Reviewed by owner',
      idempotencyKey: `ack-${crypto.randomUUID()}`,
    };
    const [left, right] = await Promise.all([
      acknowledgeSemanticWarning(f.context, input),
      acknowledgeSemanticWarning(f.context, input),
    ]);
    expect(left.id).toBe(right.id);
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(1);
    const audits = await prisma.auditEvent.findMany({
      where: { eventType: 'validation.warning_acknowledged', targetId: finding.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: f.workspace.user.id,
      organizationId: f.workspace.organization.id,
      targetId: finding.id,
    });
    const metadata = audits[0]!.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual([
      'findingId',
      'reasonClass',
      'reasonHash',
      'validationRunId',
    ]);
    expect(metadata).toMatchObject({
      findingId: finding.id,
      validationRunId: run.id,
      reasonClass: 'ACKNOWLEDGEMENT',
    });
    expect(metadata.reasonHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(metadata)).not.toContain(input.reason);
  });

  it('rejects reused acknowledgement keys and non-warning findings without creating evidence', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `reject-run-${crypto.randomUUID()}`,
    });
    await processValidationRun(run.id);
    const evaluation = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: run.id },
    });
    const warning = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: run.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: evaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'WARNING',
        path: 'warning',
        messageKey: 'warning',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const info = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: run.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: evaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'INFO',
        path: 'info',
        messageKey: 'info',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const blocking = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: run.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: evaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'BLOCKING',
        path: 'blocking',
        messageKey: 'blocking',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const alternateWarning = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: run.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: evaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'WARNING',
        path: 'alternate-warning',
        messageKey: 'alternate-warning',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const deterministic = await prisma.validationFinding.findFirstOrThrow({
      where: { validationRunId: run.id, kind: 'DETERMINISTIC' },
    });
    const key = `conflict-${crypto.randomUUID()}`;
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: warning.id,
      reason: 'first',
      idempotencyKey: key,
    });
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: warning.id,
        reason: 'different',
        idempotencyKey: key,
      }),
    ).rejects.toThrow('Idempotency key was already used with different content');
    const beforeConflictAcks = await prisma.validationFindingAcknowledgement.count();
    const beforeConflictAudits = await prisma.auditEvent.count({
      where: { eventType: 'validation.warning_acknowledged' },
    });
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: alternateWarning.id,
        reason: 'different finding',
        idempotencyKey: key,
      }),
    ).rejects.toThrow('Idempotency key was already used with different content');
    expect(await prisma.validationFindingAcknowledgement.count()).toBe(beforeConflictAcks);
    expect(
      await prisma.auditEvent.count({ where: { eventType: 'validation.warning_acknowledged' } }),
    ).toBe(beforeConflictAudits);
    for (const finding of [deterministic, blocking, info]) {
      const acknowledgements = await prisma.validationFindingAcknowledgement.count({
        where: { findingId: finding.id },
      });
      const audits = await prisma.auditEvent.count({
        where: { eventType: 'validation.warning_acknowledged', targetId: finding.id },
      });
      await expect(
        acknowledgeSemanticWarning(f.context, {
          version: '1.0.0',
          findingId: finding.id,
          reason: 'not acknowledgeable',
          idempotencyKey: `reject-${finding.id}`,
        }),
      ).rejects.toThrow('not acknowledgeable');
      expect(
        await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
      ).toBe(acknowledgements);
      expect(
        await prisma.auditEvent.count({
          where: { eventType: 'validation.warning_acknowledged', targetId: finding.id },
        }),
      ).toBe(audits);
    }
  });

  it('persists bounded semantic failure as one terminal run with a cleared lease and safe audit', async () => {
    const f = await fixture();
    const requested = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `semantic-failure-${crypto.randomUUID()}`,
    });
    const evaluator = new DeterministicFakeSemanticEvaluator(undefined, () => {
      throw new Error('credential=redacted');
    });
    const completed = await processValidationRun(requested.id, prisma, evaluator);
    expect(completed).toMatchObject({ state: 'FAILED', failureCode: 'PERMANENT_EVALUATOR_ERROR' });
    const stored = await prisma.validationRun.findUniqueOrThrow({ where: { id: requested.id } });
    expect(stored).toMatchObject({
      state: 'FAILED',
      failureCode: 'PERMANENT_EVALUATOR_ERROR',
      leaseExpiresAt: null,
      semanticFindingCount: 0,
      deterministicPassCount: 0,
      deterministicFailCount: 11,
    });
    expect(
      await prisma.validationRuleExecution.count({ where: { validationRunId: requested.id } }),
    ).toBe(11);
    const executions = await prisma.validationRuleExecution.findMany({
      where: { validationRunId: requested.id },
      orderBy: { ruleDefinition: { deterministicOrder: 'asc' } },
    });
    expect(executions).toHaveLength(11);
    expect(executions.every((execution) => execution.outcome === 'FAIL')).toBe(true);
    expect(executions.every((execution) => typeof execution.evidence === 'object')).toBe(true);
    expect(
      await prisma.semanticEvaluation.count({
        where: { validationRunId: requested.id, state: 'FAILED' },
      }),
    ).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'validation.failed', targetId: requested.id },
    });
    expect(
      await prisma.auditEvent.count({
        where: { eventType: 'validation.failed', targetId: requested.id },
      }),
    ).toBe(1);
    expect(audit.metadata).toEqual({
      failureCode: 'PERMANENT_EVALUATOR_ERROR',
      deterministicFailCount: 11,
    });
  });

  it('uses the real assertion for owned readiness, P5030 eligibility change, and fail-closed errors', async () => {
    const f = await createGenerationFixture();
    const generated = await processGenerationRun(
      f.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    expect(generated?.state).toBe('SUCCEEDED');
    const revision = await prisma.assessmentRevision.findFirstOrThrow({
      where: { assessmentId: f.assessmentId },
      orderBy: { createdAt: 'desc' },
    });
    const question = await prisma.assessmentQuestion.findFirstOrThrow({
      where: { section: { revisionId: revision.id } },
    });
    const link = await prisma.questionSourceLink.findFirstOrThrow({
      where: { assessmentQuestionId: question.id },
      include: { sourceVersion: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.answer.create({
        data: {
          questionId: question.id,
          key: 'closure-answer',
          order: 0,
          text: 'תשובה תקינה',
          answerData: {},
        },
      });
      await tx.$executeRaw`UPDATE knowledge_sources SET organization_id=${f.context.organizationId}::uuid WHERE id=${link.sourceVersion.sourceId}::uuid`;
      await tx.$executeRaw`UPDATE source_versions SET lifecycle='ACTIVE' WHERE id=${f.sourceVersionId}::uuid`;
      await tx.$executeRaw`UPDATE knowledge_items SET organization_id=${f.context.organizationId}::uuid WHERE id=${link.knowledgeItemId}::uuid`;
      await tx.$executeRaw`UPDATE question_source_links SET curriculum_version_id=${f.curriculumVersionId}::uuid, curriculum_node_id=${f.curriculumNodeId}::uuid WHERE assessment_question_id=${question.id}::uuid`;
      await tx.$executeRaw`UPDATE generation_context_items SET curriculum_version_id=${f.curriculumVersionId}::uuid, curriculum_node_id=${f.curriculumNodeId}::uuid WHERE generation_run_id=${f.generationRunId}::uuid AND knowledge_item_id=${link.knowledgeItemId}::uuid`;
    });
    const run = await prisma.validationRun.create({
      data: {
        organizationId: f.context.organizationId,
        assessmentId: f.assessmentId,
        assessmentRevisionId: revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 1,
        idempotencyKey: `ready-${crypto.randomUUID()}`,
        requestFingerprint: 'r'.repeat(64),
      },
    });
    const rules = await prisma.validationRuleDefinition.findMany({
      where: { rulesetVersion: 'v1' },
      orderBy: { deterministicOrder: 'asc' },
    });
    for (const rule of rules)
      await prisma.validationRuleExecution.create({
        data: {
          validationRunId: run.id,
          ruleDefinitionId: rule.id,
          outcome: 'PASS',
          evidence: { identity: rule.ruleId, revisionId: revision.id },
        },
      });
    await prisma.semanticEvaluation.create({
      data: {
        validationRunId: run.id,
        evaluatorVersion: 'local-disabled-v1',
        promptVersion: 'validation-prompt-v1',
        modelConfigurationVersion: 'local-none-v1',
        schemaVersion: '1.0.0',
        state: 'SUCCEEDED',
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL, deterministic_pass_count=11, deterministic_fail_count=0 WHERE id=${run.id}::uuid`;
    });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessmentId, revision.id),
    ).resolves.toEqual({
      version: '1.0.0',
      status: 'READY',
      reasonCode: null,
      validationRunId: run.id,
    });
    await setSourceLifecycle(
      f.context,
      f.sourceVersionId,
      'SUSPENDED',
      'closure eligibility change',
    );
    await expect(
      getRevisionValidationReadiness(f.context, f.assessmentId, revision.id),
    ).resolves.toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'SOURCE_ELIGIBILITY_CHANGED',
      validationRunId: run.id,
    });
    await setSourceLifecycle(
      f.context,
      f.sourceVersionId,
      'ACTIVE',
      'closure eligibility restored',
    );
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE validation_runs SET deterministic_pass_count=10 WHERE id=${run.id}::uuid`;
    });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessmentId, revision.id),
    ).resolves.toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_FAILED',
      validationRunId: run.id,
    });
  });
});
