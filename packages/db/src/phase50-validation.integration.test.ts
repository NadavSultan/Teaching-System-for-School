import { afterAll, describe, expect, it } from 'vitest';
import {
  createPersonalWorkspace,
  createAssessmentRevision,
  createKnowledgeSource,
  getGenerationResult,
  getRevisionValidationReadiness,
  getValidationStatus,
  publishCurriculumVersion,
  processValidationRun,
  processGenerationRun,
  recordPedagogicalReview,
  recordUsagePermission,
  registerSourceVersion,
  prisma,
  requestIngestion,
  requestRevisionValidation,
  resolveAccessContext,
  runIngestion,
  setSourceLifecycle,
} from './index.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { validationRules } from '@teach/domain';

const principal = (userId: string) => ({
  version: '1.0.0' as const,
  userId,
  email: 'phase50@example.test',
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase50-${Date.now()}-${Math.random()}@example.test`,
    workspaceName: 'phase50',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P50-${Date.now()}-${Math.random()}`,
      educationSystemCode: 'IL',
      subjectCode: 'MATH',
      displayName: 'Phase 50',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: {
      curriculumId: curriculum.id,
      versionNumber: 1,
    },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G1', label: 'Grade 1', sortOrder: 1 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Phase 50',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    principal(workspace.user.id),
    workspace.organization.id,
  );
  const revision = await createAssessmentRevision(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `revision-${Math.random()}`,
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
  return { workspace, assessment, revision, context, node };
}

async function generatedValidationFixture() {
  const f = await createGenerationFixture();
  const generated = await processGenerationRun(
    f.generationRunId,
    prisma,
    new DeterministicFakeModelGateway(),
  );
  if (generated?.state !== 'SUCCEEDED') throw new Error('generated fixture did not succeed');
  const output = await getGenerationResult(f.context, f.generationRunId);
  if (!output?.revision) throw new Error('generated fixture output missing');
  const question = output.revision.sections[0]!.questions[0]!;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.answer.create({
      data: {
        questionId: question.id,
        key: 'phase50-answer',
        order: 0,
        text: 'תשובה תקינה',
        answerData: {},
      },
    });
  });
  return { ...f, revisionId: output.revision.id, questionId: question.id };
}

describe('Phase 50 persisted validation operations', () => {
  afterAll(() => prisma.$disconnect());

  it('persists one pending run and one ID-only outbox event atomically', async () => {
    const f = await fixture();
    const result = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-one',
    });
    expect(result.state).toBe('PENDING');
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `validation:${result.id}` },
    });
    expect(event.payload).toEqual({ validationRunId: result.id });
    expect(await getValidationStatus(f.context, result.id)).toMatchObject({
      id: result.id,
      state: 'PENDING',
      revisionSequence: 1,
    });
  });

  it('D18 persisted current eligibility rejects each inactive source state and preserves shared sources', async () => {
    const check = async (
      mutate: (f: Awaited<ReturnType<typeof createGenerationFixture>>) => Promise<void>,
    ) => {
      const f = await createGenerationFixture();
      const generated = await processGenerationRun(
        f.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      expect(generated?.state).toBe('SUCCEEDED');
      const output = await getGenerationResult(f.context, f.generationRunId);
      expect(output?.revision?.id).toBeTruthy();
      const generatedQuestion = output!.revision!.sections[0]!.questions[0]!;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.answer.create({
          data: {
            questionId: generatedQuestion.id,
            key: 'd18-answer',
            order: 0,
            text: 'תשובה תקינה',
            answerData: {},
          },
        });
      });
      await mutate(f);
      const requested = await requestRevisionValidation(f.context, {
        version: '1.0.0',
        assessmentId: f.assessmentId,
        assessmentRevisionId: output!.revision!.id,
        idempotencyKey: `d18-validation-${Math.random()}`,
      });
      const processed = await processValidationRun(requested.id);
      expect(processed?.state).toBe('FAILED');
      const findings = await prisma.validationFinding.findMany({
        where: { validationRunId: requested.id },
        orderBy: { id: 'asc' },
        select: { code: true, severity: true },
      });
      expect(findings).toEqual([{ code: 'CURRENT_SOURCE_ELIGIBILITY', severity: 'BLOCKING' }]);
    };
    await check(async (f) => {
      await recordPedagogicalReview(f.context, {
        version: '1.0.0',
        sourceVersionId: f.sourceVersionId,
        decision: 'REJECTED',
        reason: 'd18',
      });
    });
    await check(async (f) => {
      await recordUsagePermission(f.context, {
        version: '1.0.0',
        sourceVersionId: f.sourceVersionId,
        decision: 'DENIED',
        evidenceReference: 'd18',
        scope: 'AI_GENERATION',
      });
    });
    await check(async (f) => {
      await recordUsagePermission(f.context, {
        version: '1.0.0',
        sourceVersionId: f.sourceVersionId,
        decision: 'ALLOWED',
        evidenceReference: 'd18',
        scope: 'AI_GENERATION',
        validUntil: '2020-01-01T00:00:00.000Z',
      });
    });
    await check(async (f) => {
      await setSourceLifecycle(f.context, f.sourceVersionId, 'SUSPENDED', 'd18');
    });
    await check(async (f) => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE knowledge_items SET status = 'SUSPENDED' WHERE id = ${f.knowledgeItemId}::uuid`;
      });
    });
    const shared = await createGenerationFixture();
    const generated = await processGenerationRun(
      shared.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    expect(generated?.state).toBe('SUCCEEDED');
    const sharedOutput = await getGenerationResult(shared.context, shared.generationRunId);
    const sharedQuestion = sharedOutput!.revision!.sections[0]!.questions[0]!;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.answer.create({
        data: {
          questionId: sharedQuestion.id,
          key: 'd18-shared-answer',
          order: 0,
          text: 'תשובה תקינה',
          answerData: {},
        },
      });
      await tx.$executeRaw`UPDATE knowledge_sources SET visibility = 'PLATFORM_SHARED', organization_id = NULL WHERE id = ${shared.sourceId}::uuid`;
      await tx.$executeRaw`UPDATE knowledge_items SET visibility = 'PLATFORM_SHARED', organization_id = NULL WHERE id = ${shared.knowledgeItemId}::uuid`;
    });
    const sharedRequest = await requestRevisionValidation(shared.context, {
      version: '1.0.0',
      assessmentId: shared.assessmentId,
      assessmentRevisionId: sharedOutput!.revision!.id,
      idempotencyKey: `d18-shared-${Math.random()}`,
    });
    const sharedProcessed = await processValidationRun(sharedRequest.id);
    expect(sharedProcessed?.state).toBe('SUCCEEDED');
    const foreign = await createGenerationFixture();
    const foreignGenerated = await processGenerationRun(
      foreign.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    expect(foreignGenerated?.state).toBe('SUCCEEDED');
    const foreignOutput = await getGenerationResult(foreign.context, foreign.generationRunId);
    const foreignQuestion = foreignOutput!.revision!.sections[0]!.questions[0]!;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.answer.create({
        data: {
          questionId: foreignQuestion.id,
          key: 'd18-private-answer',
          order: 0,
          text: 'תשובה תקינה',
          answerData: {},
        },
      });
      const other = await tx.organization.create({
        data: { name: 'foreign-source-owner', workspaceType: 'SCHOOL' },
      });
      await tx.$executeRaw`UPDATE knowledge_sources SET organization_id = ${other.id}::uuid WHERE id = ${foreign.sourceId}::uuid`;
      await tx.$executeRaw`UPDATE knowledge_items SET organization_id = ${other.id}::uuid WHERE id = ${foreign.knowledgeItemId}::uuid`;
    });
    const foreignRequest = await requestRevisionValidation(foreign.context, {
      version: '1.0.0',
      assessmentId: foreign.assessmentId,
      assessmentRevisionId: foreignOutput!.revision!.id,
      idempotencyKey: `d18-private-${Math.random()}`,
    });
    const foreignProcessed = await processValidationRun(foreignRequest.id);
    expect(foreignProcessed?.state).toBe('FAILED');
    expect(
      await prisma.validationFinding.findMany({
        where: { validationRunId: foreignRequest.id },
        orderBy: { id: 'asc' },
        select: { code: true, severity: true },
      }),
    ).toEqual([{ code: 'CURRENT_SOURCE_ELIGIBILITY', severity: 'BLOCKING' }]);
  });

  it('replays the exact request and rejects a conflicting idempotency payload', async () => {
    const f = await fixture();
    const input = {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-replay',
    };
    const first = await requestRevisionValidation(f.context, input);
    const replay = await requestRevisionValidation(f.context, input);
    expect(replay.id).toBe(first.id);
    await expect(
      requestRevisionValidation(f.context, {
        ...input,
        assessmentId: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
  });

  it('reloads persisted membership instead of trusting a forged role field', async () => {
    const f = await fixture();
    const forged = {
      ...f.context,
      role: 'SCHOOL_ADMIN' as const,
      organizationId: f.workspace.organization.id,
    };
    const result = await requestRevisionValidation(forged, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-forged-role',
    });
    expect(result.state).toBe('PENDING');
  });

  it('uses the greatest committed sequence for readiness', async () => {
    const f = await fixture();
    expect(
      await getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
    await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-old',
    });
    const newest = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-new',
    });
    expect(newest.revisionSequence).toBe(2);
    expect(
      await getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_PENDING',
      validationRunId: newest.id,
    });
  });

  it('D17 persisted canonical source snapshot rejects a forged locator and hash', async () => {
    const f = await fixture();
    const source = await createKnowledgeSource(f.context, {
      version: '1.0.0',
      title: 'Canonical source',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'phase50-d17',
    });
    const sourceVersion = await registerSourceVersion(f.context, {
      version: '1.0.0',
      sourceId: source.id,
      idempotencyKey: 'd17-version',
      content: 'canonical persisted text',
      contentReference: 'fixture://phase50-d17',
      contentMimeType: 'text/plain',
      curriculumVersionId: f.revision.curriculumVersionId,
      curriculumNodeIds: [f.node.id],
    });
    await recordPedagogicalReview(f.context, {
      version: '1.0.0',
      sourceVersionId: sourceVersion.id,
      decision: 'APPROVED',
      reason: 'phase50 fixture',
    });
    await recordUsagePermission(f.context, {
      version: '1.0.0',
      sourceVersionId: sourceVersion.id,
      decision: 'ALLOWED',
      evidenceReference: 'phase50 fixture',
      scope: 'AI_GENERATION',
    });
    await setSourceLifecycle(f.context, sourceVersion.id, 'ACTIVE', 'phase50 fixture');
    const ingestion = await requestIngestion(f.context, {
      version: '1.0.0',
      sourceVersionId: sourceVersion.id,
      pipelineVersion: 'plain-v1',
    });
    await runIngestion(ingestion.id);
    const item = await prisma.knowledgeItem.findFirstOrThrow({
      where: { sourceVersionId: sourceVersion.id },
    });
    const run = await prisma.generationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        requestingUserId: f.workspace.user.id,
        assessmentId: f.assessment.id,
        operation: 'DRAFT',
        idempotencyKey: 'd17-generation',
        requestFingerprint: 'a'.repeat(64),
        frozenSpecification: { curriculumNodeIds: [f.node.id] },
        curriculumVersionId: f.revision.curriculumVersionId,
        promptTemplateVersion: 'd17-prompt',
        promptTemplateHash: 'b'.repeat(64),
        modelConfigurationVersion: 'd17-model',
        modelConfigurationHash: 'c'.repeat(64),
        responseSchemaVersion: '1.0.0',
        responseSchemaHash: 'd'.repeat(64),
      },
    });
    const output = await createAssessmentRevision(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      idempotencyKey: `generation:${run.id}`,
      curriculumVersionId: f.revision.curriculumVersionId,
      curriculumNodeIds: [f.node.id],
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
    await prisma.generationContextItem.create({
      data: {
        generationRunId: run.id,
        selectedOrder: 0,
        knowledgeItemId: item.id,
        sourceVersionId: sourceVersion.id,
        locator: item.locator,
        textHash: item.textHash,
        curriculumVersionId: f.revision.curriculumVersionId,
        curriculumNodeId: f.node.id,
        rank: 1,
        score: 1,
        characterCount: 1,
        estimatedTokens: 1,
        lineage: [
          { curriculumVersionId: f.revision.curriculumVersionId, curriculumNodeId: f.node.id },
        ],
      },
    });
    const question = await prisma.assessmentQuestion.findFirstOrThrow({
      where: { section: { revisionId: output.id } },
    });
    await prisma.generationRun.update({
      where: { id: run.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`
      INSERT INTO generation_expected_question_citations
        (generation_run_id, assessment_question_id, knowledge_item_id, source_version_id,
         locator, text_hash, curriculum_version_id, curriculum_node_id, lineage)
      VALUES
        (${run.id}::uuid, ${question.id}::uuid, ${item.id}::uuid, ${sourceVersion.id}::uuid,
         ${item.locator}, ${item.textHash}, ${f.revision.curriculumVersionId}::uuid,
         ${f.node.id}::uuid, 'GENERATED'::"GenerationLineage")
      `;
      await tx.questionSourceLink.create({
        data: {
          assessmentQuestionId: question.id,
          generationRunId: run.id,
          knowledgeItemId: item.id,
          sourceVersionId: sourceVersion.id,
          locator: item.locator,
          textHash: item.textHash,
          curriculumVersionId: f.revision.curriculumVersionId,
          curriculumNodeId: f.node.id,
          lineage: 'GENERATED',
        },
      });
      await tx.$executeRaw`
        UPDATE question_source_links
        SET locator = ${'wrong-non-empty-locator'}, text_hash = ${'e'.repeat(64)}
        WHERE generation_run_id = ${run.id}::uuid AND assessment_question_id = ${question.id}::uuid
      `;
      await tx.$executeRaw`
        UPDATE generation_expected_question_citations
        SET locator = ${'wrong-non-empty-locator'}, text_hash = ${'e'.repeat(64)}
        WHERE generation_run_id = ${run.id}::uuid AND assessment_question_id = ${question.id}::uuid
      `;
      await tx.generationRun.update({
        where: { id: run.id },
        data: {
          state: 'SUCCEEDED',
          outputRevisionId: output.id,
          provider: 'local',
          model: 'phase50-fixture',
          processedAt: new Date(),
        },
      });
    });
    const requested = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: output.id,
      idempotencyKey: 'd17-validation',
    });
    const processed = await processValidationRun(requested.id);
    expect(processed?.state).toBe('FAILED');
    const findings = await prisma.validationFinding.findMany({
      where: { validationRunId: requested.id },
      select: { code: true, severity: true },
    });
    expect(findings).toEqual([
      { code: 'SOURCE_LINK_COMPLETENESS_AND_IDENTITY', severity: 'BLOCKING' },
      { code: 'CURRENT_SOURCE_ELIGIBILITY', severity: 'BLOCKING' },
    ]);
  });

  it('rejects a direct run insert with mismatched assessment and revision identity', async () => {
    const f = await fixture();
    const otherAssessment = await prisma.assessment.create({
      data: {
        organizationId: f.workspace.organization.id,
        type: 'WORKSHEET',
        title: 'Other',
        createdByUserId: f.workspace.user.id,
      },
    });
    const other = await createAssessmentRevision(f.context, {
      version: '1.0.0',
      assessmentId: otherAssessment.id,
      idempotencyKey: `other-${Math.random()}`,
      curriculumVersionId: f.revision.curriculumVersionId,
      curriculumNodeIds: [],
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
    await expect(
      prisma.$executeRaw`INSERT INTO validation_runs (organization_id, assessment_id, assessment_revision_id, requesting_user_id, ruleset_version, evaluator_version, revision_sequence, idempotency_key, request_fingerprint) VALUES (${f.workspace.organization.id}::uuid, ${f.assessment.id}::uuid, ${other.id}::uuid, ${f.workspace.user.id}::uuid, 'v1', 'local-disabled-v1', 1, ${`direct-${Math.random()}`}, ${'c'.repeat(64)})`,
    ).rejects.toThrow('phase50 revision identity or finalized state rejected');
  });
});
