import { afterAll, describe, expect, it } from 'vitest';
import {
  acknowledgeSemanticWarning,
  approveAssessmentRevision,
  createAssessmentRevision,
  createKnowledgeSource,
  createPersonalWorkspace,
  getApprovalHistory,
  getApprovalStatus,
  getStudentSafePreview,
  prisma,
  publishCurriculumVersion,
  recordPedagogicalReview,
  recordUsagePermission,
  registerSourceVersion,
  resolveAccessContext,
  saveEditedRevision,
  setSourceLifecycle,
} from './index.js';

const principal = (userId: string) => ({
  version: '1.0.0' as const,
  userId,
  email: `phase60-approval-${userId}@example.test`,
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase60-approval-${crypto.randomUUID()}@example.test`,
    workspaceName: 'Phase 60 approval',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P60A${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Phase 60 approval',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1 },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G8', label: 'Grade 8', sortOrder: 1 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Phase 60 approval',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    principal(workspace.user.id),
    workspace.organization.id,
  );
  const revision = await createAssessmentRevision(
    context,
    revisionInput(assessment.id, version.id, node.id),
  );
  return { workspace, assessment, revision, context, version, node };
}

function revisionInput(assessmentId: string, curriculumVersionId: string, nodeId: string) {
  const suffix = crypto.randomUUID();
  return {
    version: '1.0.0' as const,
    assessmentId,
    idempotencyKey: `phase60-approval-revision-${suffix}`,
    curriculumVersionId,
    curriculumNodeIds: [nodeId],
    scoringMode: 'NONE' as const,
    sections: [
      {
        key: `s-${suffix}`,
        title: 'Section',
        order: 0,
        questions: [
          {
            key: `q-${suffix}`,
            type: 'SHORT_TEXT' as const,
            prompt: 'Question',
            order: 0,
            answers: [{ key: `a-${suffix}`, order: 0, text: 'Answer' }],
            rubrics: [],
            subQuestions: [],
          },
        ],
      },
    ],
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Finding = { kind: 'DETERMINISTIC' | 'SEMANTIC'; severity?: 'BLOCKING' | 'WARNING' | 'INFO' };

async function completeRun(
  f: Fixture,
  options: { revisionId?: string; sequence?: number; finding?: Finding } = {},
) {
  const revisionId = options.revisionId ?? f.revision.id;
  const run = await prisma.validationRun.create({
    data: {
      organizationId: f.workspace.organization.id,
      assessmentId: f.assessment.id,
      assessmentRevisionId: revisionId,
      requestingUserId: f.workspace.user.id,
      rulesetVersion: 'v1',
      evaluatorVersion: 'local-disabled-v1',
      revisionSequence: options.sequence ?? 1,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: 'a'.repeat(64),
    },
  });
  await prisma.validationRun.update({
    where: { id: run.id },
    data: {
      state: 'PROCESSING',
      attempts: 1,
      processingStartedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  const rules = await prisma.validationRuleDefinition.findMany({
    where: { rulesetVersion: 'v1' },
    orderBy: { deterministicOrder: 'asc' },
  });
  const deterministicFailure = options.finding?.kind === 'DETERMINISTIC';
  const executions = await Promise.all(
    rules.map((rule, index) =>
      prisma.validationRuleExecution.create({
        data: {
          validationRunId: run.id,
          ruleDefinitionId: rule.id,
          outcome: deterministicFailure && index === 0 ? 'FAIL' : 'PASS',
          evidence: { identity: rule.ruleId, revisionId },
        },
      }),
    ),
  );
  const evaluation = await prisma.semanticEvaluation.create({
    data: {
      validationRunId: run.id,
      evaluatorVersion: 'local-disabled-v1',
      promptVersion: 'validation-prompt-v1',
      modelConfigurationVersion: 'local-none-v1',
      schemaVersion: '1.0.0',
      state: 'SUCCEEDED',
      latencyMs: 0,
    },
  });
  let findingId: string | undefined;
  if (deterministicFailure) {
    const rule = rules[0]!;
    findingId = (
      await prisma.validationFinding.create({
        data: {
          organizationId: f.workspace.organization.id,
          validationRunId: run.id,
          assessmentRevisionId: revisionId,
          executionId: executions[0]!.id,
          kind: 'DETERMINISTIC',
          code: rule.ruleId,
          category: rule.category,
          severity: 'BLOCKING',
          path: 'revision',
          messageKey: `${rule.ruleId}_FAILED`,
          evidence: { identity: rule.ruleId, revisionId },
          ruleVersion: rule.ruleVersion,
        },
      })
    ).id;
  } else if (options.finding?.kind === 'SEMANTIC') {
    const severity = options.finding.severity ?? 'WARNING';
    const category = severity === 'INFO' ? 'DIFFICULTY_FIT' : 'AMBIGUITY';
    const code = `${category}_V1`;
    findingId = (
      await prisma.validationFinding.create({
        data: {
          organizationId: f.workspace.organization.id,
          validationRunId: run.id,
          assessmentRevisionId: revisionId,
          semanticEvaluationId: evaluation.id,
          kind: 'SEMANTIC',
          code,
          category,
          severity,
          path: 'question.q1',
          messageKey: `semantic.${category.toLowerCase()}`,
          evidence: { identity: code, revisionId },
          evaluatorVersion: 'local-disabled-v1',
        },
      })
    ).id;
  }
  await prisma.validationRun.update({
    where: { id: run.id },
    data: {
      state: 'SUCCEEDED',
      completedAt: new Date(),
      leaseExpiresAt: null,
      deterministicPassCount: deterministicFailure ? 10 : 11,
      deterministicFailCount: deterministicFailure ? 1 : 0,
      semanticFindingCount: options.finding?.kind === 'SEMANTIC' ? 1 : 0,
    },
  });
  return { run, findingId };
}

function approvalInput(
  f: Fixture,
  idempotencyKey = crypto.randomUUID(),
  revisionId = f.revision.id,
) {
  return {
    version: '1.0.0' as const,
    assessmentId: f.assessment.id,
    assessmentRevisionId: revisionId,
    idempotencyKey,
  };
}

async function approvalCounts(f: Fixture) {
  const [approvals, audits] = await Promise.all([
    prisma.assessmentApproval.count({ where: { assessmentId: f.assessment.id } }),
    prisma.auditEvent.count({
      where: {
        organizationId: f.workspace.organization.id,
        eventType: 'assessment.revision.approved',
      },
    }),
  ]);
  return { approvals, audits };
}

async function expectApprovalRejected(operation: () => Promise<unknown>, reason: string) {
  await expect(operation()).rejects.toMatchObject({ code: reason });
}

async function attachEligibleSource(f: Fixture) {
  const source = await createKnowledgeSource(f.context, {
    version: '1.0.0',
    title: 'Approval eligibility source',
    visibility: 'ORGANIZATION_PRIVATE',
    origin: 'phase60-approval-test',
  });
  const sourceVersion = await registerSourceVersion(f.context, {
    version: '1.0.0',
    sourceId: source.id,
    idempotencyKey: crypto.randomUUID(),
    content: 'Persisted source content for approval eligibility.',
    contentReference: `fixture://phase60-approval/${crypto.randomUUID()}`,
    contentMimeType: 'text/plain',
    curriculumVersionId: f.version.id,
    curriculumNodeIds: [f.node.id],
  });
  await recordPedagogicalReview(f.context, {
    version: '1.0.0',
    sourceVersionId: sourceVersion.id,
    decision: 'APPROVED',
    reason: 'Approved',
  });
  await recordUsagePermission(f.context, {
    version: '1.0.0',
    sourceVersionId: sourceVersion.id,
    decision: 'ALLOWED',
    evidenceReference: 'Approval eligibility',
    scope: 'AI_GENERATION',
  });
  await setSourceLifecycle(f.context, sourceVersion.id, 'ACTIVE', 'Eligible for approval');
  const ingestion = await prisma.ingestionRun.create({
    data: {
      sourceVersionId: sourceVersion.id,
      contentHash: 'd'.repeat(64),
      pipelineVersion: `phase60-approval-${crypto.randomUUID()}`,
      parserVersion: 'phase60-approval',
      status: 'SUCCEEDED' as const,
      attempts: 1,
      completedAt: new Date(),
    },
  });
  const item = await prisma.knowledgeItem.create({
    data: {
      sourceVersionId: sourceVersion.id,
      organizationId: f.workspace.organization.id,
      visibility: 'ORGANIZATION_PRIVATE',
      locator: `phase60-approval-${crypto.randomUUID()}`,
      normalizedText: 'Persisted source content for approval eligibility.',
      textHash: 'c'.repeat(64),
      pipelineVersion: 'phase60-approval',
      parserVersion: 'phase60-approval',
      ingestionRunId: ingestion.id,
      curriculumLinks: {
        create: { curriculumVersionId: f.version.id, curriculumNodeId: f.node.id },
      },
    },
  });
  const question = await prisma.assessmentQuestion.findFirstOrThrow({
    where: { section: { revisionId: f.revision.id } },
  });
  const generation = await prisma.generationRun.create({
    data: {
      organizationId: f.workspace.organization.id,
      requestingUserId: f.workspace.user.id,
      assessmentId: f.assessment.id,
      operation: 'DRAFT',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: 'e'.repeat(64),
      frozenSpecification: { curriculumNodeIds: [f.node.id] },
      curriculumVersionId: f.version.id,
      promptTemplateVersion: 'phase60-approval',
      promptTemplateHash: 'f'.repeat(64),
      modelConfigurationVersion: 'phase60-approval',
      modelConfigurationHash: 'a'.repeat(64),
      responseSchemaVersion: '1.0.0',
      responseSchemaHash: 'b'.repeat(64),
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.questionSourceLink.create({
      data: {
        assessmentQuestionId: question.id,
        generationRunId: generation.id,
        knowledgeItemId: item.id,
        sourceVersionId: sourceVersion.id,
        locator: item.locator,
        textHash: item.textHash,
        curriculumVersionId: f.version.id,
        curriculumNodeId: f.node.id,
        lineage: 'GENERATED',
      },
    });
  });
  return { sourceVersionId: sourceVersion.id };
}

async function editorInput(f: Fixture) {
  const base = await prisma.assessmentRevision.findUniqueOrThrow({
    where: { id: f.revision.id },
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: {
          questions: {
            orderBy: { order: 'asc' },
            include: {
              answers: { orderBy: { order: 'asc' } },
              rubrics: { orderBy: { order: 'asc' } },
              subQuestions: {
                orderBy: { order: 'asc' },
                include: {
                  answers: { orderBy: { order: 'asc' } },
                  rubrics: { orderBy: { order: 'asc' } },
                },
              },
            },
          },
        },
      },
    },
  });
  return {
    version: '1.0.0' as const,
    assessmentId: f.assessment.id,
    baseRevisionId: base.id,
    baseRevisionNumber: base.revisionNumber,
    idempotencyKey: crypto.randomUUID(),
    sections: base.sections.map((section) => ({
      key: section.key,
      title: section.title,
      instructions: section.instructions,
      order: section.order,
      scoreUnits: section.scoreUnits,
      questions: section.questions.map((question) => ({
        logicalId: question.logicalId,
        key: question.key,
        type: question.type,
        prompt: `${question.prompt} edited`,
        instructions: question.instructions,
        order: question.order,
        scoreUnits: question.scoreUnits,
        answers: question.answers.map((answer) => ({
          key: answer.key,
          order: answer.order,
          text: answer.text,
          explanation: answer.explanation,
        })),
        rubrics: question.rubrics.map((rubric) => ({
          key: rubric.key,
          description: rubric.description,
          order: rubric.order,
          scoreUnits: rubric.scoreUnits,
        })),
        subQuestions: question.subQuestions.map((subQuestion) => ({
          key: subQuestion.key,
          prompt: subQuestion.prompt,
          order: subQuestion.order,
          scoreUnits: subQuestion.scoreUnits,
          answers: subQuestion.answers.map((answer) => ({
            key: answer.key,
            order: answer.order,
            text: answer.text,
            explanation: answer.explanation,
          })),
          rubrics: subQuestion.rubrics.map((rubric) => ({
            key: rubric.key,
            description: rubric.description,
            order: rubric.order,
            scoreUnits: rubric.scoreUnits,
          })),
        })),
      })),
    })),
  };
}

describe('Phase 60 persisted approval integration', () => {
  afterAll(() => prisma.$disconnect());

  it('A02 creates exactly one safe audit event after the persisted approval', async () => {
    const f = await fixture();
    const { run } = await completeRun(f);
    const approval = await approveAssessmentRevision(f.context, approvalInput(f));
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'assessment.revision.approved', targetId: approval.approvalId },
    });
    expect(await approvalCounts(f)).toEqual({ approvals: 1, audits: 1 });
    expect(audit.metadata).toEqual({
      operation: 'ASSESSMENT_REVISION_APPROVED',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      validationRunId: run.id,
      approvalSequence: 1,
      approvalCount: 1,
      contractVersion: '1.0.0',
      validationRulesetVersion: 'v1',
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Question');
    expect(JSON.stringify(audit.metadata)).not.toContain('Answer');
  });

  it('A03 replays an identical persisted request without another approval or audit', async () => {
    const f = await fixture();
    await completeRun(f);
    const input = approvalInput(f, crypto.randomUUID());
    const first = await approveAssessmentRevision(f.context, input);
    const replay = await approveAssessmentRevision(f.context, input);
    expect(replay).toEqual(first);
    expect(await approvalCounts(f)).toEqual({ approvals: 1, audits: 1 });
  });

  it('A04 rejects a changed persisted request under the same idempotency key', async () => {
    const f = await fixture();
    await completeRun(f);
    const key = crypto.randomUUID();
    await approveAssessmentRevision(f.context, approvalInput(f, key));
    await expect(
      approveAssessmentRevision(f.context, {
        ...approvalInput(f, key),
        assessmentRevisionId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await approvalCounts(f)).toEqual({ approvals: 1, audits: 1 });
  });

  it('A05 rejects an assessment revision with no validation evidence and persists no approval audit', async () => {
    const f = await fixture();
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'VALIDATION_REQUIRED',
    );
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A06 rejects pending and processing validation arrangements with no approval audit', async () => {
    const f = await fixture();
    const pending = await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 1,
        idempotencyKey: crypto.randomUUID(),
        requestFingerprint: 'a'.repeat(64),
      },
    });
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'VALIDATION_PENDING',
    );
    await prisma.validationRun.update({
      where: { id: pending.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'VALIDATION_PROCESSING',
    );
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A07 rejects failed and incomplete validation arrangements with no approval audit', async () => {
    const f = await fixture();
    const failed = await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 1,
        idempotencyKey: crypto.randomUUID(),
        requestFingerprint: 'a'.repeat(64),
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute' WHERE id=${failed.id}::uuid`;
    await prisma.$executeRaw`UPDATE validation_runs SET state='FAILED', failure_code='FIXTURE_FAILURE', completed_at=now(), lease_expires_at=NULL WHERE id=${failed.id}::uuid`;
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'VALIDATION_FAILED',
    );
    await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 2,
        idempotencyKey: crypto.randomUUID(),
        requestFingerprint: 'b'.repeat(64),
      },
    });
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'VALIDATION_PENDING',
    );
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A08 rejects a complete deterministic blocker with no approval audit', async () => {
    const f = await fixture();
    await completeRun(f, { finding: { kind: 'DETERMINISTIC' } });
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'DETERMINISTIC_BLOCKER',
    );
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A09 rejects a complete semantic blocker with no approval audit', async () => {
    const f = await fixture();
    await completeRun(f, { finding: { kind: 'SEMANTIC', severity: 'BLOCKING' } });
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'SEMANTIC_BLOCKER',
    );
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A10 requires a persisted warning acknowledgement before approval can proceed', async () => {
    const f = await fixture();
    const { findingId } = await completeRun(f, {
      finding: { kind: 'SEMANTIC', severity: 'WARNING' },
    });
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'WARNING_ACKNOWLEDGEMENT_REQUIRED',
    );
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: findingId!,
      reason: 'Reviewed for approval',
      idempotencyKey: crypto.randomUUID(),
    });
    await approveAssessmentRevision(f.context, approvalInput(f));
    expect(await approvalCounts(f)).toEqual({ approvals: 1, audits: 1 });
  });

  it('A11 rejects a persisted source eligibility revocation with no approval audit', async () => {
    const f = await fixture();
    const source = await attachEligibleSource(f);
    await completeRun(f);
    await setSourceLifecycle(f.context, source.sourceVersionId, 'SUSPENDED', 'Eligibility revoked');
    await expectApprovalRejected(
      () => approveAssessmentRevision(f.context, approvalInput(f)),
      'SOURCE_ELIGIBILITY_CHANGED',
    );
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A12 rejects a stale revision even when its own validation evidence is READY', async () => {
    const f = await fixture();
    await completeRun(f);
    await createAssessmentRevision(
      f.context,
      revisionInput(f.assessment.id, f.version.id, f.node.id),
    );
    await expect(approveAssessmentRevision(f.context, approvalInput(f))).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A13 rejects a foreign tenant revision without an approval or audit disclosure', async () => {
    const f = await fixture();
    const foreign = await fixture();
    await completeRun(f);
    await expect(
      approveAssessmentRevision(
        f.context,
        approvalInput(f, crypto.randomUUID(), foreign.revision.id),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
    expect(await approvalCounts(f)).toEqual({ approvals: 0, audits: 0 });
    expect(await approvalCounts(foreign)).toEqual({ approvals: 0, audits: 0 });
  });

  it('A14 returns exact immutable approval history to the authorized persisted reader', async () => {
    const f = await fixture();
    const { run } = await completeRun(f);
    const approval = await approveAssessmentRevision(f.context, approvalInput(f));
    await expect(getApprovalHistory(f.context, f.assessment.id)).resolves.toEqual([
      expect.objectContaining({
        approvalId: approval.approvalId,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        validationRunId: run.id,
        approvingUserId: f.workspace.user.id,
        approvalSequence: 1,
        contractVersion: '1.0.0',
        validationRulesetVersion: 'v1',
      }),
    ]);
  });

  it('A15 keeps an approved historical revision while a later persisted edit is unapproved', async () => {
    const f = await fixture();
    await completeRun(f);
    const approval = await approveAssessmentRevision(f.context, approvalInput(f));
    const edited = await saveEditedRevision(f.context, await editorInput(f));
    expect(edited.revisionId).not.toBe(f.revision.id);
    await expect(getApprovalHistory(f.context, f.assessment.id)).resolves.toEqual([
      expect.objectContaining({
        approvalId: approval.approvalId,
        assessmentRevisionId: f.revision.id,
      }),
    ]);
    await expect(
      getApprovalStatus(f.context, f.assessment.id, edited.revisionId),
    ).resolves.toMatchObject({
      approved: false,
      approvalId: null,
      approvalSequence: null,
    });
  });

  it('A16 uses the exact approved revision for a student-safe preview instead of a later edit', async () => {
    const f = await fixture();
    await completeRun(f);
    await approveAssessmentRevision(f.context, approvalInput(f));
    const edited = await saveEditedRevision(f.context, await editorInput(f));
    await expect(
      getStudentSafePreview(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({
      assessmentId: f.assessment.id,
      revisionId: f.revision.id,
    });
    await expect(
      getStudentSafePreview(f.context, f.assessment.id, edited.revisionId),
    ).rejects.toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
  });

  it('C06 converges real concurrent identical approvals to one row and one audit', async () => {
    const f = await fixture();
    await completeRun(f);
    const input = approvalInput(f, crypto.randomUUID());
    const [first, second] = await Promise.all([
      approveAssessmentRevision(f.context, input),
      approveAssessmentRevision(f.context, input),
    ]);
    expect(second.approvalId).toBe(first.approvalId);
    expect(await approvalCounts(f)).toEqual({ approvals: 1, audits: 1 });
  });

  it('C07 prevents concurrent approvals of different revision identities from approving stale history', async () => {
    const f = await fixture();
    await completeRun(f);
    const latest = await createAssessmentRevision(
      f.context,
      revisionInput(f.assessment.id, f.version.id, f.node.id),
    );
    await completeRun(f, { revisionId: latest.id });
    const [stale, current] = await Promise.allSettled([
      approveAssessmentRevision(f.context, approvalInput(f, crypto.randomUUID(), f.revision.id)),
      approveAssessmentRevision(f.context, approvalInput(f, crypto.randomUUID(), latest.id)),
    ]);
    expect(stale).toMatchObject({ status: 'rejected', reason: { code: 'STALE_REVISION' } });
    expect(current).toMatchObject({
      status: 'fulfilled',
      value: { assessmentRevisionId: latest.id },
    });
    expect(await approvalCounts(f)).toEqual({ approvals: 1, audits: 1 });
  });
});
