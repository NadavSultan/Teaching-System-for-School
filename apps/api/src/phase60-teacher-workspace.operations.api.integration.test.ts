import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  apiErrorSchema,
  approvalResultSchema,
  approvalStatusSchema,
  editorSaveResultSchema,
  generationResultSchema,
  generationStatusSchema,
  studentSafePreviewSchema,
  teacherWorkspaceSchema,
  validationReadinessSchema,
  validationResultSchema,
  validationStatusSchema,
} from '@teach/contracts';
import {
  createAssessment,
  createKnowledgeSource,
  createPersonalWorkspace,
  getGenerationResult,
  importCurriculumDraft,
  processGenerationRun,
  processValidationRun,
  prisma,
  publishCurriculumVersion,
  recordPedagogicalReview,
  recordUsagePermission,
  registerSourceVersion,
  requestDraftGeneration,
  requestIngestion,
  resolveAccessContext,
  runIngestion,
  setSourceLifecycle,
} from '@teach/db';
import { createApp } from './bootstrap.js';

type Fixture = {
  workspace: Awaited<ReturnType<typeof createPersonalWorkspace>>;
  context: Awaited<ReturnType<typeof resolveAccessContext>>;
  assessmentId: string;
  curriculumVersionId: string;
  curriculumNodeId: string;
  sourceVersionId: string;
  generationRunId: string;
  revisionId: string;
};

const headersFor = (fixture: Fixture) => ({
  'x-dev-user-id': fixture.workspace.user.id,
  'x-dev-user-email': fixture.workspace.user.normalizedEmail,
  'x-organization-id': fixture.workspace.organization.id,
});

async function fixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const workspace = await createPersonalWorkspace({
    email: `phase60-api-${suffix}@example.test`,
    workspaceName: 'Phase 60 API',
  });
  const context = await resolveAccessContext(
    {
      version: '1.0.0',
      userId: workspace.user.id,
      email: workspace.user.normalizedEmail,
      provider: 'development',
      providerSubject: `dev:${workspace.user.id}`,
      platformAdmin: false,
    },
    workspace.organization.id,
  );
  const curriculum = await importCurriculumDraft({
    version: '1.0.0',
    code: `P60API${suffix.replaceAll('-', '').slice(0, 18).toUpperCase()}`,
    educationSystemCode: 'IL',
    subjectCode: 'HE',
    displayName: 'Phase 60 API curriculum',
    versionNumber: 1,
    nodes: [{ type: 'GRADE', code: 'G7', label: 'Grade 7', sortOrder: 0 }],
  });
  const node = await prisma.curriculumNode.findFirstOrThrow({
    where: { versionId: curriculum.version.id },
  });
  await publishCurriculumVersion(curriculum.version.id, workspace.user.id);
  const source = await createKnowledgeSource(context, {
    version: '1.0.0',
    title: 'Phase 60 API source',
    visibility: 'ORGANIZATION_PRIVATE',
    origin: 'phase60-api-integration',
  });
  const sourceVersion = await registerSourceVersion(context, {
    version: '1.0.0',
    sourceId: source.id,
    idempotencyKey: `source-${suffix}`,
    content: 'מקור מאושר ליצירת שאלת בדיקה.',
    contentReference: `fixture://phase60-api/${suffix}`,
    contentMimeType: 'text/plain',
    curriculumVersionId: curriculum.version.id,
    curriculumNodeIds: [node.id],
  });
  await recordPedagogicalReview(context, {
    version: '1.0.0',
    sourceVersionId: sourceVersion.id,
    decision: 'APPROVED',
    reason: 'Phase 60 API fixture',
  });
  await recordUsagePermission(context, {
    version: '1.0.0',
    sourceVersionId: sourceVersion.id,
    decision: 'ALLOWED',
    evidenceReference: 'Phase 60 API fixture',
    scope: 'AI_GENERATION',
  });
  await setSourceLifecycle(context, sourceVersion.id, 'ACTIVE', 'Phase 60 API fixture');
  const ingestion = await requestIngestion(context, {
    version: '1.0.0',
    sourceVersionId: sourceVersion.id,
    pipelineVersion: `plain-v1-${suffix}`,
  });
  await runIngestion(ingestion.id);
  const assessment = await createAssessment(context, {
    version: '1.0.0',
    type: 'WORKSHEET',
    title: 'Phase 60 API assessment',
  });
  const draft = await requestDraftGeneration(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `draft-${suffix}`,
    curriculumVersionId: curriculum.version.id,
    curriculumNodeIds: [node.id],
    scoringMode: 'NONE',
    totalScoreUnits: null,
    query: 'מקור',
    sections: [
      {
        key: 's1',
        title: 'Section',
        order: 0,
        scoreUnits: null,
        questions: [
          {
            key: 'q1',
            order: 0,
            type: 'OPEN',
            difficulty: 'LOW',
            scoreUnits: null,
          },
        ],
      },
    ],
  });
  const generated = await processGenerationRun(draft.id);
  if (!generated?.outputRevisionId) throw new Error('fixture generation did not create a revision');
  const output = await getGenerationResult(context, draft.id);
  const question = output?.revision?.sections[0]?.questions[0];
  if (!question) throw new Error('fixture generation output did not include a question');
  const sourceLink = await prisma.questionSourceLink.findFirstOrThrow({
    where: { assessmentQuestionId: question.id },
    include: { sourceVersion: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.answer.create({
      data: {
        questionId: question.id,
        key: 'phase60-api-answer',
        order: 0,
        text: 'תשובה תקינה',
        answerData: {},
      },
    });
    await tx.$executeRaw`UPDATE knowledge_sources SET organization_id = ${context.organizationId}::uuid WHERE id = ${sourceLink.sourceVersion.sourceId}::uuid`;
    await tx.$executeRaw`UPDATE source_versions SET lifecycle='ACTIVE' WHERE id = ${sourceLink.sourceVersionId}::uuid`;
    await tx.$executeRaw`UPDATE source_lifecycle_events SET to_status='ACTIVE' WHERE source_id = ${sourceLink.sourceVersion.sourceId}::uuid`;
    await tx.$executeRaw`UPDATE knowledge_items SET status='ACTIVE' WHERE id = ${sourceLink.knowledgeItemId}::uuid`;
    await tx.$executeRaw`UPDATE knowledge_items SET organization_id = ${context.organizationId}::uuid WHERE id = ${sourceLink.knowledgeItemId}::uuid`;
    await tx.$executeRaw`UPDATE question_source_links SET curriculum_version_id = ${curriculum.version.id}::uuid, curriculum_node_id = ${node.id}::uuid WHERE assessment_question_id = ${question.id}::uuid`;
    await tx.$executeRaw`UPDATE generation_context_items SET curriculum_version_id = ${curriculum.version.id}::uuid, curriculum_node_id = ${node.id}::uuid WHERE generation_run_id = ${draft.id}::uuid AND knowledge_item_id = ${sourceLink.knowledgeItemId}::uuid`;
  });
  return {
    workspace,
    context,
    assessmentId: assessment.id,
    curriculumVersionId: curriculum.version.id,
    curriculumNodeId: node.id,
    sourceVersionId: sourceVersion.id,
    generationRunId: draft.id,
    revisionId: generated.outputRevisionId,
  };
}

function editorRequest(workspace: ReturnType<typeof teacherWorkspaceSchema.parse>) {
  return {
    version: '1.0.0' as const,
    assessmentId: workspace.assessment.id,
    baseRevisionId: workspace.revision.id,
    baseRevisionNumber: workspace.revision.revisionNumber,
    idempotencyKey: crypto.randomUUID(),
    sections: workspace.revision.sections.map((section) => ({
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

describe('Phase 60 teacher workspace API operations', () => {
  let app: INestApplication;
  let priorGateway: string | undefined;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ADAPTER = 'test';
    priorGateway = process.env.PHASE40_GATEWAY;
    process.env.PHASE40_GATEWAY = 'fake';
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    if (priorGateway === undefined) delete process.env.PHASE40_GATEWAY;
    else process.env.PHASE40_GATEWAY = priorGateway;
    await app.close();
    await prisma.$disconnect();
  });

  it('O4 returns the persisted workspace and revision history but gates student preview before approval', async () => {
    const seeded = await fixture();
    const headers = headersFor(seeded);
    const workspaceResponse = await request(app.getHttpServer())
      .get(`/v1/teacher/assessments/${seeded.assessmentId}`)
      .set(headers);
    const workspace = teacherWorkspaceSchema.parse(workspaceResponse.body);

    expect(workspaceResponse.status).toBe(200);
    expect(workspace.assessment).toMatchObject({
      id: seeded.assessmentId,
      latestRevisionId: seeded.revisionId,
    });
    expect(workspace.history).toEqual([
      expect.objectContaining({ id: seeded.revisionId, revisionNumber: 1, isLatest: true }),
    ]);
    expect(workspace.readiness).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
    });

    const preview = await request(app.getHttpServer())
      .get(
        `/v1/teacher/assessments/${seeded.assessmentId}/revisions/${seeded.revisionId}/student-preview`,
      )
      .set({ ...headers, 'x-request-id': 'phase60-o4-preview' });
    const error = apiErrorSchema.parse(preview.body).error;

    expect(preview.status).toBe(404);
    expect(preview.headers['x-request-id']).toBe('phase60-o4-preview');
    expect(error).toMatchObject({ code: 'NOT_FOUND', requestId: 'phase60-o4-preview' });
  });

  it('O5 creates a persisted question-regeneration run and exposes its safe pending status and result', async () => {
    const seeded = await fixture();
    const headers = headersFor(seeded);
    const workspace = teacherWorkspaceSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/v1/teacher/assessments/${seeded.assessmentId}`)
          .set(headers)
      ).body,
    );
    const logicalQuestionId = workspace.revision.sections[0]!.questions[0]!.logicalId;
    const created = await request(app.getHttpServer())
      .post('/v1/teacher/regenerations')
      .set(headers)
      .send({
        version: '1.0.0',
        assessmentId: seeded.assessmentId,
        baseRevisionId: seeded.revisionId,
        logicalQuestionId,
        idempotencyKey: crypto.randomUUID(),
      });
    const status = generationStatusSchema.parse(created.body);

    expect(created.status).toBe(201);
    expect(status).toMatchObject({
      assessmentId: seeded.assessmentId,
      operation: 'REGENERATE_QUESTION',
      state: 'PENDING',
    });
    const [reloaded, result, audit] = await Promise.all([
      request(app.getHttpServer()).get(`/v1/teacher/regenerations/${status.id}`).set(headers),
      request(app.getHttpServer())
        .get(`/v1/teacher/regenerations/${status.id}/result`)
        .set(headers),
      prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'generation.requested', targetId: status.id },
      }),
    ]);

    expect(generationStatusSchema.parse(reloaded.body)).toEqual(status);
    expect(generationResultSchema.parse(result.body)).toMatchObject({ status, revision: null });
    expect(audit.metadata).toEqual({
      operation: 'REGENERATE_QUESTION',
      curriculumVersionId: seeded.curriculumVersionId,
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('שאלה');
  });

  it('O6 saves an immutable edited revision over HTTP and persists a safe edit audit trail', async () => {
    const seeded = await fixture();
    const headers = headersFor(seeded);
    const base = teacherWorkspaceSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/v1/teacher/assessments/${seeded.assessmentId}`)
          .set(headers)
      ).body,
    );
    const edit = editorRequest(base);
    edit.sections[0]!.questions[0]!.prompt = 'Edited through the teacher API';
    const saved = await request(app.getHttpServer())
      .post('/v1/teacher/revisions')
      .set(headers)
      .send(edit);
    const result = editorSaveResultSchema.parse(saved.body);
    const [reloaded, original, audit] = await Promise.all([
      request(app.getHttpServer())
        .get(`/v1/teacher/assessments/${seeded.assessmentId}?revisionId=${result.revisionId}`)
        .set(headers),
      request(app.getHttpServer())
        .get(`/v1/teacher/assessments/${seeded.assessmentId}?revisionId=${seeded.revisionId}`)
        .set(headers),
      prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'assessment.revision.edited', targetId: result.revisionId },
      }),
    ]);

    expect(saved.status).toBe(201);
    expect(result).toMatchObject({
      assessmentId: seeded.assessmentId,
      revisionNumber: 2,
      baseRevisionId: seeded.revisionId,
    });
    expect(
      teacherWorkspaceSchema.parse(reloaded.body).revision.sections[0]!.questions[0]!.prompt,
    ).toBe('Edited through the teacher API');
    expect(
      teacherWorkspaceSchema.parse(original.body).revision.sections[0]!.questions[0]!.prompt,
    ).not.toBe('Edited through the teacher API');
    expect(audit.metadata).toMatchObject({
      assessmentId: seeded.assessmentId,
      baseRevisionId: seeded.revisionId,
      revisionId: result.revisionId,
      questionCount: 1,
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Edited through the teacher API');
  });

  it('O7-O10 persist validation, readiness, approval, safe preview, status/history, and mapped rejection contracts', async () => {
    const seeded = await fixture();
    const headers = headersFor(seeded);
    const validation = await request(app.getHttpServer())
      .post('/v1/teacher/validations')
      .set(headers)
      .send({
        version: '1.0.0',
        assessmentId: seeded.assessmentId,
        assessmentRevisionId: seeded.revisionId,
        idempotencyKey: crypto.randomUUID(),
      });
    const pending = validationStatusSchema.parse(validation.body);

    expect(validation.status).toBe(201);
    expect(pending.state).toBe('PENDING');
    const [pendingStatus, pendingResult, pendingReadiness, validationAudit, outbox] =
      await Promise.all([
        request(app.getHttpServer()).get(`/v1/teacher/validations/${pending.id}`).set(headers),
        request(app.getHttpServer())
          .get(`/v1/teacher/validations/${pending.id}/result`)
          .set(headers),
        request(app.getHttpServer())
          .get(
            `/v1/teacher/assessments/${seeded.assessmentId}/revisions/${seeded.revisionId}/readiness`,
          )
          .set(headers),
        prisma.auditEvent.findFirstOrThrow({
          where: { eventType: 'validation.requested', targetId: pending.id },
        }),
        prisma.outboxEvent.findFirstOrThrow({
          where: {
            eventType: 'validation.requested',
            payload: { equals: { validationRunId: pending.id } },
          },
        }),
      ]);

    expect(validationStatusSchema.parse(pendingStatus.body)).toEqual(pending);
    expect(validationResultSchema.parse(pendingResult.body).status).toEqual(pending);
    expect(validationReadinessSchema.parse(pendingReadiness.body)).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_PENDING',
      validationRunId: pending.id,
    });
    expect(validationAudit.metadata).toEqual({
      rulesetVersion: 'v1',
      evaluatorVersion: 'local-disabled-v1',
    });
    expect(outbox.payload).toEqual({ validationRunId: pending.id });

    expect((await processValidationRun(pending.id))?.state).toBe('SUCCEEDED');
    const ready = await request(app.getHttpServer())
      .get(
        `/v1/teacher/assessments/${seeded.assessmentId}/revisions/${seeded.revisionId}/readiness`,
      )
      .set(headers);
    const readyState = validationReadinessSchema.parse(ready.body);
    expect(readyState.status).toBe('READY');
    expect(readyState.reasonCode).toBeNull();
    expect(readyState.validationRunId).toBe(pending.id);

    const approval = await request(app.getHttpServer())
      .post('/v1/teacher/approvals')
      .set(headers)
      .send({
        version: '1.0.0',
        assessmentId: seeded.assessmentId,
        assessmentRevisionId: seeded.revisionId,
        idempotencyKey: crypto.randomUUID(),
      });
    const approved = approvalResultSchema.parse(approval.body);
    const [approvalStatus, history, preview, approvalAudit] = await Promise.all([
      request(app.getHttpServer())
        .get(
          `/v1/teacher/assessments/${seeded.assessmentId}/revisions/${seeded.revisionId}/approval`,
        )
        .set(headers),
      request(app.getHttpServer())
        .get(`/v1/teacher/assessments/${seeded.assessmentId}/approvals`)
        .set(headers),
      request(app.getHttpServer())
        .get(
          `/v1/teacher/assessments/${seeded.assessmentId}/revisions/${seeded.revisionId}/student-preview`,
        )
        .set(headers),
      prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'assessment.revision.approved', targetId: approved.approvalId },
      }),
    ]);

    expect(approval.status).toBe(201);
    expect(approvalStatusSchema.parse(approvalStatus.body)).toMatchObject({
      approved: true,
      approvalId: approved.approvalId,
      approvalSequence: 1,
    });
    expect(history.body).toEqual([
      expect.objectContaining({
        approvalId: approved.approvalId,
        assessmentRevisionId: seeded.revisionId,
        validationRunId: pending.id,
      }),
    ]);
    const safePreview = studentSafePreviewSchema.parse(preview.body);
    expect(preview.status).toBe(200);
    expect(JSON.stringify(safePreview)).not.toContain('Answer');
    expect(JSON.stringify(safePreview)).not.toContain('rubric');
    expect(approvalAudit.metadata).toMatchObject({
      assessmentId: seeded.assessmentId,
      assessmentRevisionId: seeded.revisionId,
      validationRunId: pending.id,
      approvalSequence: 1,
    });

    const deniedApproval = await request(app.getHttpServer())
      .post('/v1/teacher/approvals')
      .set({ ...headers, 'x-request-id': 'phase60-o10-rejection' })
      .send({
        version: '1.0.0',
        assessmentId: seeded.assessmentId,
        assessmentRevisionId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      });
    const rejection = apiErrorSchema.parse(deniedApproval.body).error;

    expect(deniedApproval.status).toBe(404);
    expect(deniedApproval.headers['x-request-id']).toBe('phase60-o10-rejection');
    expect(rejection).toMatchObject({ code: 'NOT_FOUND', requestId: 'phase60-o10-rejection' });
  });
});
