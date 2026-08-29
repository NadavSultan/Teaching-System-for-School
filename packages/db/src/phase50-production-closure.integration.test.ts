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
} from './index.js';
import { validationResultSchema } from '@teach/contracts';
import { DeterministicFakeSemanticEvaluator } from '@teach/ai';

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
    await processValidationRun(requested.id);
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
    for (const finding of result!.findings) {
      expect(finding.confidenceBasisPoints).toBe(finding.kind === 'SEMANTIC' ? null : null);
      expect(finding.ruleVersion).toBe(finding.kind === 'DETERMINISTIC' ? '1.0.0' : null);
      expect(finding.evaluatorVersion).toBe(
        finding.kind === 'SEMANTIC' ? 'local-disabled-v1' : null,
      );
      expect(finding.schemaVersion).toBe(finding.kind === 'SEMANTIC' ? '1.0.0' : null);
    }
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
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain(input.reason);
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
    ).rejects.toThrow('Idempotency key conflicts');
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: info.id,
        reason: 'not allowed',
        idempotencyKey: `info-${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow('not acknowledgeable');
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: info.id } }),
    ).toBe(0);
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
    expect(stored.leaseExpiresAt).toBeNull();
    expect(
      await prisma.semanticEvaluation.count({
        where: { validationRunId: requested.id, state: 'FAILED' },
      }),
    ).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'validation.failed', targetId: requested.id },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('credential');
  });
});
