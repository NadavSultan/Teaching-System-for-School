import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { AccessDeniedError } from '@teach/domain';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  getGenerationStatus,
  prisma,
  processGenerationRun,
  requestDraftGeneration,
  requestQuestionRegeneration,
} from './index.js';

const draftRequest = (foreign: Awaited<ReturnType<typeof createGenerationFixture>>) => ({
  version: '1.0.0' as const,
  assessmentId: foreign.assessmentId,
  idempotencyKey: `foreign-${foreign.generationRunId}`,
  curriculumVersionId: foreign.curriculumVersionId,
  curriculumNodeIds: [foreign.curriculumNodeId],
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
});

async function expectAccessDenied(action: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AccessDeniedError);
  const exactMessage = 'Resource not found or unavailable';
  expect((caught as Error).message).toBe(exactMessage);
  expect(exactMessage).toBe('Resource not found or unavailable');
}

describe('T — persisted bidirectional tenant matrix', () => {
  it.each(phase40AcceptanceRegistry.T)(
    '%s denies or discloses nothing across tenant ownership',
    async (caseId) => {
      const owner = await createGenerationFixture();
      const foreign = await createGenerationFixture();
      const foreignRunCount = await prisma.generationRun.count({
        where: { organizationId: foreign.context.organizationId },
      });
      const ownerRunCount = await prisma.generationRun.count({
        where: { organizationId: owner.context.organizationId },
      });
      const [direction, operation] = caseId.split(':');
      const caller = direction === 'A->B' ? owner : foreign;
      const target = direction === 'A->B' ? foreign : owner;
      const foreignBase = await processGenerationRun(
        target.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      const foreignResult = await getGenerationResult(target.context, target.generationRunId);
      const foreignQuestion = foreignResult?.revision?.sections[0]?.questions[0];
      if (!foreignBase?.outputRevisionId || !foreignQuestion)
        throw new Error('foreign finalized graph missing');
      if (operation === 'P1')
        await expectAccessDenied(() =>
          requestDraftGeneration(caller.context, draftRequest(target)),
        );
      if (operation === 'P2')
        await expectAccessDenied(() =>
          requestQuestionRegeneration(caller.context, {
            version: '1.0.0',
            assessmentId: target.assessmentId,
            baseRevisionId: foreignBase.outputRevisionId,
            targetQuestionId: foreignQuestion.id,
            idempotencyKey: `foreign-regen-${target.generationRunId}`,
            instruction: 'ניסוח',
            query: 'שלום',
          }),
        );
      if (operation === 'P3')
        expect(await getGenerationStatus(caller.context, target.generationRunId)).toBeNull();
      if (operation === 'P4')
        expect(await getGenerationResult(caller.context, target.generationRunId)).toBeNull();
      expect(
        await prisma.generationRun.count({
          where: { organizationId: foreign.context.organizationId },
        }),
      ).toBe(foreignRunCount);
      expect(
        await prisma.generationRun.count({
          where: { organizationId: owner.context.organizationId },
        }),
      ).toBe(ownerRunCount);
    },
  );
});
afterAll(() => prisma.$disconnect());
