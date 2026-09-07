import { DeterministicFakeModelGateway, DeterministicFakeSemanticEvaluator } from '@teach/ai';
import { afterAll, describe, expect, it } from 'vitest';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  acknowledgeSemanticWarning,
  approveAssessmentRevision,
  getRevisionValidationReadiness,
  getTeacherWorkspace,
  getValidationResult,
  listTeacherAssessments,
  prisma,
  processGenerationRun,
  processValidationRun,
  requestRevisionValidation,
  requestTeacherQuestionRegeneration,
  saveEditedRevision,
  setSourceLifecycle,
} from './index.js';

type Role = 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN';
type Finding = Readonly<{
  severity: 'BLOCKING' | 'WARNING';
  path: string;
}>;

const validationInput = (
  assessmentId: string,
  revisionId: string,
  idempotencyKey = crypto.randomUUID(),
) => ({
  version: '1.0.0' as const,
  assessmentId,
  assessmentRevisionId: revisionId,
  idempotencyKey,
});

const semanticEvaluator = (findings: readonly Finding[] = []) =>
  new DeterministicFakeSemanticEvaluator(undefined, async (input) => ({
    version: '1.0.0' as const,
    evaluatorVersion: 'local-disabled-v1',
    promptVersion: 'validation-prompt-v1',
    modelConfigurationVersion: 'local-none-v1',
    schemaVersion: '1.0.0' as const,
    revisionId: input.revisionId,
    findings: findings.map((finding, index) => ({
      code: 'AMBIGUITY_V1',
      category: 'AMBIGUITY' as const,
      severity: finding.severity,
      path: finding.path,
      messageKey: `semantic.ambiguity.${index}`,
      evidence: { identity: 'AMBIGUITY_V1', revisionId: input.revisionId },
    })),
  }));

async function generatedFixture(role: Role = 'TEACHER') {
  const fixture = await createGenerationFixture({ role });
  const generation = await processGenerationRun(
    fixture.generationRunId,
    prisma,
    new DeterministicFakeModelGateway(),
  );
  if (!generation?.outputRevisionId)
    throw new Error('generation fixture did not persist a revision');
  const question = await prisma.assessmentQuestion.findFirstOrThrow({
    where: { section: { revisionId: generation.outputRevisionId } },
    orderBy: { order: 'asc' },
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
        key: `phase60-answer-${crypto.randomUUID()}`,
        order: 0,
        text: 'תשובה תקינה',
        answerData: {},
      },
    });
    await tx.$executeRaw`UPDATE knowledge_sources SET organization_id = ${fixture.context.organizationId}::uuid WHERE id = ${link.sourceVersion.sourceId}::uuid`;
    await tx.$executeRaw`UPDATE source_versions SET lifecycle='ACTIVE' WHERE id = ${link.sourceVersionId}::uuid`;
    await tx.$executeRaw`UPDATE source_lifecycle_events SET to_status='ACTIVE' WHERE source_id = ${link.sourceVersion.sourceId}::uuid`;
    await tx.$executeRaw`UPDATE knowledge_items SET status='ACTIVE' WHERE id = ${link.knowledgeItemId}::uuid`;
    await tx.$executeRaw`UPDATE knowledge_items SET organization_id = ${fixture.context.organizationId}::uuid WHERE id = ${link.knowledgeItemId}::uuid`;
    await tx.$executeRaw`UPDATE question_source_links SET curriculum_version_id = ${fixture.curriculumVersionId}::uuid, curriculum_node_id = ${fixture.curriculumNodeId}::uuid WHERE assessment_question_id = ${question.id}::uuid`;
    await tx.$executeRaw`UPDATE generation_context_items SET curriculum_version_id = ${fixture.curriculumVersionId}::uuid, curriculum_node_id = ${fixture.curriculumNodeId}::uuid WHERE generation_run_id = ${fixture.generationRunId}::uuid AND knowledge_item_id = ${link.knowledgeItemId}::uuid`;
  });
  return { ...fixture, revisionId: generation.outputRevisionId };
}

async function workspace(
  fixture: Awaited<ReturnType<typeof generatedFixture>>,
  revisionId = fixture.revisionId,
) {
  return getTeacherWorkspace(fixture.context, fixture.assessmentId, revisionId);
}

function editorInput(
  view: Awaited<ReturnType<typeof workspace>>,
  idempotencyKey = crypto.randomUUID(),
) {
  return {
    version: '1.0.0' as const,
    assessmentId: view.assessment.id,
    baseRevisionId: view.revision.id,
    baseRevisionNumber: view.revision.revisionNumber,
    idempotencyKey,
    sections: view.revision.sections.map((section) => ({
      key: section.key,
      title: section.title,
      instructions: section.instructions,
      order: section.order,
      scoreUnits: section.scoreUnits,
      questions: section.questions.map((question) => ({
        logicalId: question.logicalId,
        key: question.key,
        type: question.type,
        prompt: question.prompt,
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
          order: rubric.order,
          description: rubric.description,
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
            order: rubric.order,
            description: rubric.description,
            scoreUnits: rubric.scoreUnits,
          })),
        })),
      })),
    })),
  };
}

async function completedRun(
  fixture: Awaited<ReturnType<typeof generatedFixture>>,
  revisionId = fixture.revisionId,
  findings: readonly Finding[] = [],
) {
  const requested = await requestRevisionValidation(
    fixture.context,
    validationInput(fixture.assessmentId, revisionId),
  );
  const completed = await processValidationRun(requested.id, prisma, semanticEvaluator(findings));
  expect(completed).toMatchObject({ state: 'SUCCEEDED' });
  return requested;
}

async function warningFinding(runId: string) {
  return prisma.validationFinding.findFirstOrThrow({
    where: { validationRunId: runId, kind: 'SEMANTIC', severity: 'WARNING' },
  });
}

describe('Phase 60 persisted teacher validation workflow', () => {
  afterAll(() => prisma.$disconnect());

  it('V01 creates an edited persisted revision with no validation and a validation-required readiness state', async () => {
    const f = await generatedFixture();
    const base = await workspace(f);
    const input = editorInput(base);
    input.sections[0]!.title = `${input.sections[0]!.title} edited`;
    const saved = await saveEditedRevision(f.context, input);
    const edited = await workspace(f, saved.revisionId);
    expect(edited.validation).toBeNull();
    expect(edited.readiness).toEqual({
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
  });

  it('V02 persists one validation run, ID-only outbox payload, and request audit through the real service', async () => {
    const f = await generatedFixture();
    const requested = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    expect(
      await prisma.validationRun.count({
        where: { id: requested.id, assessmentRevisionId: f.revisionId },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.findFirstOrThrow({
        where: {
          eventType: 'validation.requested',
          payload: { path: ['validationRunId'], equals: requested.id },
        },
      }),
    ).toMatchObject({ payload: { validationRunId: requested.id } });
    expect(
      await prisma.auditEvent.count({
        where: { eventType: 'validation.requested', targetId: requested.id },
      }),
    ).toBe(1);
  });

  it('V03 reloads a persisted pending run into non-ready teacher workspace state', async () => {
    const f = await generatedFixture();
    const requested = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    const view = await workspace(f);
    expect(view.validation).toMatchObject({ id: requested.id, state: 'PENDING' });
    expect(view.readiness).toMatchObject({ status: 'BLOCKED', reasonCode: 'VALIDATION_PENDING' });
    expect(view.approval.approved).toBe(false);
  });

  it('V04 reloads a persisted processing run into non-ready teacher workspace state', async () => {
    const f = await generatedFixture();
    const requested = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    await prisma.validationRun.update({
      where: { id: requested.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const view = await workspace(f);
    expect(view.validation).toMatchObject({ id: requested.id, state: 'PROCESSING' });
    expect(view.readiness).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_PROCESSING',
    });
    expect(view.approval.approved).toBe(false);
  });

  it('V05 persists evaluator failure and reloads its safe blocked readiness state', async () => {
    const f = await generatedFixture();
    const requested = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    const failed = await processValidationRun(
      requested.id,
      prisma,
      new DeterministicFakeSemanticEvaluator(undefined, () => {
        throw new Error('credential=must-not-be-persisted');
      }),
    );
    expect(failed).toMatchObject({ state: 'FAILED', failureCode: 'PERMANENT_EVALUATOR_ERROR' });
    const view = await workspace(f);
    expect(view.validation).toMatchObject({
      id: requested.id,
      state: 'FAILED',
      failureCode: 'PERMANENT_EVALUATOR_ERROR',
    });
    expect(view.readiness).toMatchObject({ status: 'BLOCKED', reasonCode: 'VALIDATION_FAILED' });
    expect(view.approval.approved).toBe(false);
  });

  it('V06 persists a deterministic blocker and returns its exact persisted editor path', async () => {
    const f = await generatedFixture();
    const question = await prisma.assessmentQuestion.findFirstOrThrow({
      where: { section: { revisionId: f.revisionId } },
      orderBy: { order: 'asc' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.questionSourceLink.deleteMany({ where: { assessmentQuestionId: question.id } });
    });
    const run = await completedRun(f);
    const result = await getValidationResult(f.context, run.id);
    expect(
      result!.findings.find((finding) => finding.code === 'SOURCE_LINK_COMPLETENESS_AND_IDENTITY'),
    ).toMatchObject({
      kind: 'DETERMINISTIC',
      severity: 'BLOCKING',
      path: 'sources',
      messageKey: 'SOURCE_LINK_COMPLETENESS_AND_IDENTITY_FAILED',
    });
  });

  it('V07 persists a semantic blocker at its editor path and rejects acknowledgement as a warning', async () => {
    const f = await generatedFixture();
    const run = await completedRun(f, f.revisionId, [
      { severity: 'BLOCKING', path: 'sections[0].questions[0]' },
    ]);
    const result = await getValidationResult(f.context, run.id);
    const blocker = result!.findings.find((finding) => finding.kind === 'SEMANTIC');
    expect(blocker).toMatchObject({ severity: 'BLOCKING', path: 'sections[0].questions[0]' });
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: blocker!.id,
        reason: 'not a warning',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow('not acknowledgeable');
  });

  it('V08 returns a persisted semantic warning with only safe contract evidence fields', async () => {
    const f = await generatedFixture();
    const run = await completedRun(f, f.revisionId, [
      { severity: 'WARNING', path: 'sections[0].questions[0]' },
    ]);
    const result = await getValidationResult(f.context, run.id);
    const warning = result!.findings.find((finding) => finding.kind === 'SEMANTIC');
    expect(warning).toMatchObject({
      severity: 'WARNING',
      category: 'AMBIGUITY',
      path: 'sections[0].questions[0]',
      messageKey: 'semantic.ambiguity.0',
      evidence: { identity: 'AMBIGUITY_V1', revisionId: f.revisionId },
    });
    expect(Object.keys(warning!.evidence).sort()).toEqual(['identity', 'revisionId']);
  });

  it('V09 acknowledges one persisted eligible warning, writes one safe audit, and updates readiness', async () => {
    const f = await generatedFixture();
    const run = await completedRun(f, f.revisionId, [
      { severity: 'WARNING', path: 'sections[0].questions[0]' },
    ]);
    const finding = await warningFinding(run.id);
    expect(
      await getRevisionValidationReadiness(f.context, f.assessmentId, f.revisionId),
    ).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'WARNING_ACKNOWLEDGEMENT_REQUIRED',
      validationRunId: run.id,
    });
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: finding.id,
      reason: 'Reviewed by teacher',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await getRevisionValidationReadiness(f.context, f.assessmentId, f.revisionId),
    ).toMatchObject({
      status: 'READY',
      reasonCode: null,
      validationRunId: run.id,
    });
    const audit = await prisma.auditEvent.findMany({
      where: { eventType: 'validation.warning_acknowledged', targetId: finding.id },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain('Reviewed by teacher');
  });

  it('V10 converges an acknowledgement retry and rejects conflicting content for its persisted key', async () => {
    const f = await generatedFixture();
    const run = await completedRun(f, f.revisionId, [
      { severity: 'WARNING', path: 'sections[0].questions[0]' },
    ]);
    const finding = await warningFinding(run.id);
    const input = {
      version: '1.0.0' as const,
      findingId: finding.id,
      reason: 'Reviewed',
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await acknowledgeSemanticWarning(f.context, input);
    const replay = await acknowledgeSemanticWarning(f.context, input);
    expect(replay.id).toBe(first.id);
    await expect(
      acknowledgeSemanticWarning(f.context, { ...input, reason: 'Changed reason' }),
    ).rejects.toThrow('Idempotency key was already used with different content');
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(1);
  });

  it('V11 keeps validation runs and acknowledgements scoped to their persisted revision after an edit', async () => {
    const f = await generatedFixture();
    const run = await completedRun(f, f.revisionId, [
      { severity: 'WARNING', path: 'sections[0].questions[0]' },
    ]);
    const finding = await warningFinding(run.id);
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: finding.id,
      reason: 'Reviewed',
      idempotencyKey: crypto.randomUUID(),
    });
    const input = editorInput(await workspace(f));
    input.sections[0]!.title = `${input.sections[0]!.title} new revision`;
    const saved = await saveEditedRevision(f.context, input);
    const edited = await workspace(f, saved.revisionId);
    expect(edited.validation).toBeNull();
    expect(edited.readiness).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: saved.revisionId } }),
    ).toBe(0);
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(1);
  });

  it('V12 reloads changed persisted source eligibility and immediately blocks an otherwise passing revision', async () => {
    const f = await generatedFixture();
    const run = await completedRun(f);
    expect(
      await getRevisionValidationReadiness(f.context, f.assessmentId, f.revisionId),
    ).toMatchObject({
      status: 'READY',
      validationRunId: run.id,
    });
    await setSourceLifecycle(
      f.context,
      f.sourceVersionId,
      'SUSPENDED',
      'Phase 60 eligibility changed',
    );
    const view = await workspace(f);
    expect(view.readiness).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'SOURCE_ELIGIBILITY_CHANGED',
      validationRunId: run.id,
    });
    await expect(
      approveAssessmentRevision(f.context, {
        version: '1.0.0',
        assessmentId: f.assessmentId,
        assessmentRevisionId: f.revisionId,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('O2 returns selected revision history validation readiness and approval from one RepeatableRead snapshot', async () => {
    const f = await generatedFixture();
    const validation = await completedRun(f);
    const approved = await approveAssessmentRevision(f.context, {
      version: '1.0.0',
      assessmentId: f.assessmentId,
      assessmentRevisionId: f.revisionId,
      idempotencyKey: crypto.randomUUID(),
    });
    const base = await workspace(f);

    let firstReadEntered = false;
    let enterSnapshotRead!: () => void;
    let releaseSnapshotRead!: () => void;
    const snapshotReadEntered = new Promise<void>((resolve) => {
      enterSnapshotRead = resolve;
    });
    const releaseSnapshot = new Promise<void>((resolve) => {
      releaseSnapshotRead = resolve;
    });
    const snapshotClient = prisma.$extends({
      query: {
        assessment: {
          async findFirst({ args, query }) {
            const result = await query(args);
            if (!firstReadEntered) {
              firstReadEntered = true;
              enterSnapshotRead();
              await releaseSnapshot;
            }
            return result;
          },
        },
      },
    });

    const read = getTeacherWorkspace(
      f.context,
      f.assessmentId,
      undefined,
      snapshotClient as unknown as typeof prisma,
    );
    await snapshotReadEntered;

    const edit = editorInput(base);
    edit.sections[0]!.title = `${edit.sections[0]!.title} concurrent snapshot edit`;
    const concurrent = await saveEditedRevision(f.context, edit);
    expect(concurrent.revisionNumber).toBe(base.revision.revisionNumber + 1);

    releaseSnapshotRead();
    const view = await read;
    expect(view.revision.id).toBe(f.revisionId);
    expect(view.assessment).toMatchObject({
      latestRevisionId: f.revisionId,
      latestRevisionNumber: base.revision.revisionNumber,
      latestApprovalRevisionId: f.revisionId,
    });
    expect(view.history.map((item) => item.id)).toEqual([f.revisionId]);
    expect(view.validation).toMatchObject({
      id: validation.id,
      assessmentRevisionId: f.revisionId,
    });
    expect(view.readiness).toMatchObject({ status: 'READY', validationRunId: validation.id });
    expect(view.approval).toMatchObject({ approved: true, approvalId: approved.approvalId });
  });
});

describe('Phase 60 persisted tenant and authority reloads', () => {
  it('T01 lists no Tenant B assessments to Tenant A', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    const listed = await listTeacherAssessments(a.context);
    expect(listed.items.map((item) => item.id)).not.toContain(b.assessmentId);
  });

  it('T02 lists no Tenant A assessments to Tenant B', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    const listed = await listTeacherAssessments(b.context);
    expect(listed.items.map((item) => item.id)).not.toContain(a.assessmentId);
  });

  it('T03 rejects Tenant A reading Tenant B workspace and revision history without disclosure', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    await expect(
      getTeacherWorkspace(a.context, b.assessmentId, b.revisionId),
    ).rejects.toMatchObject({
      code: 'RESOURCE_UNAVAILABLE',
    });
  });

  it('T04 rejects Tenant B reading Tenant A workspace and revision history without disclosure', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    await expect(
      getTeacherWorkspace(b.context, a.assessmentId, a.revisionId),
    ).rejects.toMatchObject({
      code: 'RESOURCE_UNAVAILABLE',
    });
  });

  it('T05 rejects Tenant A mutation attempts against Tenant B persisted data', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    const bView = await workspace(b);
    const run = await completedRun(b, b.revisionId, [
      { severity: 'WARNING', path: 'sections[0].questions[0]' },
    ]);
    const finding = await warningFinding(run.id);
    await expect(saveEditedRevision(a.context, editorInput(bView))).rejects.toThrow();
    await expect(
      requestRevisionValidation(a.context, validationInput(b.assessmentId, b.revisionId)),
    ).rejects.toThrow();
    await expect(
      requestTeacherQuestionRegeneration(a.context, {
        version: '1.0.0',
        assessmentId: b.assessmentId,
        baseRevisionId: b.revisionId,
        logicalQuestionId: bView.revision.sections[0]!.questions[0]!.logicalId,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    await expect(
      acknowledgeSemanticWarning(a.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'foreign',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    await expect(
      approveAssessmentRevision(a.context, {
        version: '1.0.0',
        assessmentId: b.assessmentId,
        assessmentRevisionId: b.revisionId,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('T06 rejects Tenant B mutation attempts against Tenant A persisted data', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    const aView = await workspace(a);
    const run = await completedRun(a, a.revisionId, [
      { severity: 'WARNING', path: 'sections[0].questions[0]' },
    ]);
    const finding = await warningFinding(run.id);
    await expect(saveEditedRevision(b.context, editorInput(aView))).rejects.toThrow();
    await expect(
      requestRevisionValidation(b.context, validationInput(a.assessmentId, a.revisionId)),
    ).rejects.toThrow();
    await expect(
      requestTeacherQuestionRegeneration(b.context, {
        version: '1.0.0',
        assessmentId: a.assessmentId,
        baseRevisionId: a.revisionId,
        logicalQuestionId: aView.revision.sections[0]!.questions[0]!.logicalId,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    await expect(
      acknowledgeSemanticWarning(b.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'foreign',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    await expect(
      approveAssessmentRevision(b.context, {
        version: '1.0.0',
        assessmentId: a.assessmentId,
        assessmentRevisionId: a.revisionId,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('T07 gives missing and foreign revisions the same non-disclosing readiness shape', async () => {
    const a = await generatedFixture();
    const b = await generatedFixture();
    const expected = {
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    };
    await expect(
      getRevisionValidationReadiness(a.context, a.assessmentId, crypto.randomUUID()),
    ).resolves.toEqual(expected);
    await expect(
      getRevisionValidationReadiness(a.context, b.assessmentId, b.revisionId),
    ).resolves.toEqual(expected);
  });

  it('T08 allows an active persisted TEACHER to execute its tenant validation workflow', async () => {
    const f = await generatedFixture('TEACHER');
    const run = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    expect(run.state).toBe('PENDING');
  });

  it('T09 allows an active persisted COORDINATOR to execute its tenant validation workflow', async () => {
    const f = await generatedFixture('COORDINATOR');
    const run = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    expect(run.state).toBe('PENDING');
  });

  it('T10 allows an active persisted SCHOOL_ADMIN to execute its tenant validation workflow', async () => {
    const f = await generatedFixture('SCHOOL_ADMIN');
    const run = await requestRevisionValidation(
      f.context,
      validationInput(f.assessmentId, f.revisionId),
    );
    expect(run.state).toBe('PENDING');
  });

  it('T11 rejects a persisted PLATFORM_ADMIN tenant context from teacher workspace operations', async () => {
    const f = await generatedFixture();
    const auditCountBefore = await prisma.auditEvent.count({
      where: { organizationId: f.context.organizationId },
    });
    await prisma.user.update({ where: { id: f.workspace.user.id }, data: { platformAdmin: true } });
    await prisma.membership.update({
      where: {
        userId_organizationId: {
          userId: f.workspace.user.id,
          organizationId: f.context.organizationId,
        },
      },
      data: { role: 'TEACHER' },
    });
    const forgedTeacher = { ...f.context, role: 'TEACHER' as const };
    await expect(
      getTeacherWorkspace(forgedTeacher, f.assessmentId, f.revisionId),
    ).rejects.toThrow();
    await expect(
      requestRevisionValidation(forgedTeacher, validationInput(f.assessmentId, f.revisionId)),
    ).rejects.toThrow();
    expect(
      await prisma.auditEvent.count({ where: { organizationId: f.context.organizationId } }),
    ).toBe(auditCountBefore);
  });

  it('T12 rejects an inactive persisted user despite a forged active client context', async () => {
    const f = await generatedFixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.user.update({ where: { id: f.workspace.user.id }, data: { status: 'INACTIVE' } });
    });
    await expect(
      getTeacherWorkspace({ ...f.context, userStatus: 'ACTIVE' }, f.assessmentId, f.revisionId),
    ).rejects.toThrow();
  });

  it('T13 rejects an inactive persisted membership despite a forged active client context', async () => {
    const f = await generatedFixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.membership.update({
        where: {
          userId_organizationId: {
            userId: f.workspace.user.id,
            organizationId: f.context.organizationId,
          },
        },
        data: { status: 'INACTIVE' },
      });
    });
    await expect(
      getTeacherWorkspace(
        { ...f.context, membershipStatus: 'ACTIVE' },
        f.assessmentId,
        f.revisionId,
      ),
    ).rejects.toThrow();
  });

  it('T14 rejects an inactive persisted organization despite a forged active client context', async () => {
    const f = await generatedFixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.organization.update({
        where: { id: f.context.organizationId },
        data: { status: 'INACTIVE' },
      });
    });
    await expect(
      getTeacherWorkspace(
        { ...f.context, organizationStatus: 'ACTIVE' },
        f.assessmentId,
        f.revisionId,
      ),
    ).rejects.toThrow();
  });
});
