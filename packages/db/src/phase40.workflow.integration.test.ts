import { afterAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@teach/contracts';
import { DeterministicFakeModelGateway, type ModelGateway } from '@teach/ai';
import {
  createAssessment,
  createKnowledgeSource,
  createPersonalWorkspace,
  importCurriculumDraft,
  prisma,
  processGenerationRun,
  publishCurriculumVersion,
  recordPedagogicalReview,
  recordUsagePermission,
  registerSourceVersion,
  requestIngestion,
  requestDraftGeneration,
  requestQuestionRegeneration,
  runIngestion,
  setSourceLifecycle,
} from './index.js';

describe('Phase 40 complete draft and regeneration workflow', () => {
  afterAll(() => prisma.$disconnect());
  it('finalizes a draft and regenerates only the target question with provenance', async () => {
    const suffix = Date.now();
    const workspace = await createPersonalWorkspace({
      email: `p40-flow-${suffix}@example.test`,
      workspaceName: 'P40 flow',
    });
    const context = {
      principal: {
        version: CONTRACT_VERSION,
        userId: workspace.user.id,
        email: workspace.user.normalizedEmail,
        provider: 'development',
        providerSubject: `dev:${workspace.user.id}`,
        platformAdmin: false,
      },
      organizationId: workspace.organization.id,
      userStatus: 'ACTIVE' as const,
      membershipStatus: 'ACTIVE' as const,
      role: 'TEACHER' as const,
      organizationStatus: 'ACTIVE' as const,
      workspaceType: 'PERSONAL' as const,
    };
    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `P40_${suffix}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'עברית',
      versionNumber: 1,
      nodes: [{ type: 'GRADE', code: 'G7', label: 'ז', sortOrder: 0 }],
    });
    await publishCurriculumVersion(curriculum.version.id, workspace.user.id);
    const node = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id },
    });
    const source = await createKnowledgeSource(context, {
      version: '1.0.0',
      title: 'מקור',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'phase40',
    });
    const registered = await registerSourceVersion(context, {
      version: '1.0.0',
      sourceId: source.id,
      idempotencyKey: 'v1',
      content: 'שלום עולם',
      contentReference: `fixture://p40/${suffix}`,
      contentMimeType: 'text/plain',
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [node.id],
    });
    await recordPedagogicalReview(context, {
      version: '1.0.0',
      sourceVersionId: registered.id,
      decision: 'APPROVED',
      reason: 'fixture',
    });
    await recordUsagePermission(context, {
      version: '1.0.0',
      sourceVersionId: registered.id,
      decision: 'ALLOWED',
      evidenceReference: 'fixture',
      scope: 'AI_GENERATION',
    });
    await setSourceLifecycle(context, registered.id, 'ACTIVE', 'fixture active');
    const ingestion = await requestIngestion(context, {
      version: '1.0.0',
      sourceVersionId: registered.id,
      pipelineVersion: 'plain-v1',
    });
    await runIngestion(ingestion.id);
    const assessment = await createAssessment(context, {
      version: '1.0.0',
      type: 'WORKSHEET',
      title: 'דף עבודה',
    });
    const request = {
      version: '1.0.0' as const,
      assessmentId: assessment.id,
      idempotencyKey: 'draft-1',
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [node.id],
      scoringMode: 'NONE' as const,
      totalScoreUnits: null,
      query: 'שלום',
      sections: [
        {
          key: 's1',
          title: 'קטע',
          order: 0,
          scoreUnits: null,
          questions: [
            {
              key: 'q1',
              order: 0,
              type: 'OPEN',
              difficulty: 'LOW' as const,
              scoreUnits: null,
              instructions: '',
              emphasis: '',
            },
          ],
        },
      ],
    };
    const run = await requestDraftGeneration(context, request);
    const result = await processGenerationRun(run.id, prisma, new DeterministicFakeModelGateway());
    if (!result) throw new Error('generation did not return a status');
    expect(result.state).toBe('SUCCEEDED');
    expect(result.outputRevisionId).toBeTruthy();
    const revision = await prisma.assessmentRevision.findUniqueOrThrow({
      where: { id: result.outputRevisionId! },
      include: { sections: { include: { questions: true } } },
    });
    const target = revision.sections[0]!.questions[0]!;
    expect(target.prompt).toContain('שאלה בעברית');
    const regeneration = await requestQuestionRegeneration(context, {
      version: '1.0.0',
      assessmentId: assessment.id,
      baseRevisionId: revision.id,
      targetQuestionId: target.id,
      idempotencyKey: 'regen-1',
      instruction: 'נסחו מחדש',
      query: 'שלום',
    });
    const regenerated = await processGenerationRun(
      regeneration.id,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    if (!regenerated) throw new Error('regeneration did not return a status');
    expect(regenerated.state).toBe('SUCCEEDED');
    expect(regenerated.outputRevisionId).not.toBe(revision.id);
    expect(
      await prisma.assessmentRevision.count({
        where: { assessmentId: assessment.id, state: 'FINALIZED' },
      }),
    ).toBe(2);
    expect(
      await prisma.questionSourceLink.count({
        where: {
          generationRunId: regeneration.id,
          lineage: 'GENERATED',
          priorQuestionId: target.id,
        },
      }),
    ).toBe(1);

    const lateGateway: ModelGateway = {
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_100));
        return {
          provider: 'late-test',
          model: 'late-test',
          requestId: 'late-test',
          output: { version: '1.0.0', sections: [] },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            costMicros: 0,
            finishReason: 'stop',
          },
          finishReason: 'stop',
        };
      },
    };
    const timeoutRun = await requestDraftGeneration(context, {
      ...request,
      idempotencyKey: 'draft-timeout',
    });
    const timeoutResult = await processGenerationRun(timeoutRun.id, prisma, lateGateway);
    expect(timeoutResult?.state).toBe('FAILED');
    expect(timeoutResult?.failureCode).toBe('TIMEOUT');
    expect(timeoutResult?.attempts).toBe(3);
    expect(timeoutResult?.outputRevisionId).toBeNull();

    const budgetGateway: ModelGateway = {
      execute: async () => ({
        provider: 'budget-test',
        model: 'budget-test',
        requestId: 'budget-test',
        output: { version: '1.0.0', sections: [] },
        usage: {
          inputTokens: 1,
          outputTokens: 2_001,
          totalTokens: 2_002,
          costMicros: 1,
          finishReason: 'length',
        },
        finishReason: 'length',
      }),
    };
    const budgetRun = await requestDraftGeneration(context, {
      ...request,
      idempotencyKey: 'draft-budget',
    });
    const budgetResult = await processGenerationRun(budgetRun.id, prisma, budgetGateway);
    expect(budgetResult?.state).toBe('FAILED');
    expect(budgetResult?.failureCode).toBe('BUDGET_EXCEEDED');
    expect(budgetResult?.outputRevisionId).toBeNull();
    expect(await prisma.generationUsage.count({ where: { generationRunId: budgetRun.id } })).toBe(
      1,
    );
    await prisma.outboxEvent.updateMany({
      where: { eventType: 'generation.requested', status: 'PENDING' },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  });
});
