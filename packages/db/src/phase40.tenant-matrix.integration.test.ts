import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  getGenerationStatus,
  prisma,
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
      if (operation === 'P1')
        await expect(
          requestDraftGeneration(caller.context, draftRequest(target)),
        ).rejects.toThrow();
      if (operation === 'P2')
        await expect(
          requestQuestionRegeneration(caller.context, {
            version: '1.0.0',
            assessmentId: target.assessmentId,
            baseRevisionId: target.generationRunId,
            targetQuestionId: target.knowledgeItemId,
            idempotencyKey: `foreign-regen-${target.generationRunId}`,
            instruction: 'ניסוח',
            query: 'שלום',
          }),
        ).rejects.toThrow();
      if (operation === 'P3')
        expect(await getGenerationStatus(caller.context, target.generationRunId)).toBeNull();
      if (operation === 'P4')
        expect(await getGenerationResult(caller.context, target.generationRunId)).toBeNull();
      expect(
        await prisma.generationRun.count({
          where: { organizationId: target.context.organizationId },
        }),
      ).toBe(direction === 'A->B' ? foreignRunCount : ownerRunCount);
    },
  );
});
afterAll(() => prisma.$disconnect());
