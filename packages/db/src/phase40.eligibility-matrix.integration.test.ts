import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { prisma, selectGenerationContext, processGenerationRun } from './index.js';

describe('E1 — independent current Phase 30 eligibility dimensions', () => {
  it.each(phase40AcceptanceRegistry.E1)(
    '%s is excluded for its persisted eligibility dimension',
    async (dimension) => {
      const options =
        dimension === 'missing-review'
          ? { review: null }
          : dimension === 'rejected-review' || dimension === 'same-timestamp-rejected-review'
            ? { review: 'REJECTED' as const }
            : dimension === 'missing-permission'
              ? { permission: null }
              : dimension === 'denied-permission' ||
                  dimension === 'same-timestamp-denied-permission'
                ? { permission: 'DENIED' as const }
                : ['SUSPENDED', 'DEPRECATED', 'FAILED', 'NEEDS_RE_REVIEW'].includes(dimension)
                  ? {
                      lifecycle: dimension as
                        | 'SUSPENDED'
                        | 'DEPRECATED'
                        | 'FAILED'
                        | 'NEEDS_RE_REVIEW',
                    }
                  : dimension === 'no-result'
                    ? {}
                    : { lifecycle: 'FAILED' as const };
      const fixture = await createGenerationFixture(
        dimension === 'no-result' ? { ...options, query: 'מונח-שאינו-קיים' } : options,
      );
      if (dimension === 'inactive-item')
        await expect(
          prisma.knowledgeItem.update({
            where: { id: fixture.knowledgeItemId },
            data: { status: 'SUSPENDED' },
          }),
        ).rejects.toThrow();
      const selected = await selectGenerationContext(fixture.generationRunId, prisma);
      expect(selected).toEqual([]);
      const processed = await processGenerationRun(fixture.generationRunId, prisma, undefined);
      expect(['INSUFFICIENT_CONTEXT', 'FAILED']).toContain(processed?.state);
      expect(
        await prisma.assessmentRevision.count({
          where: {
            assessmentId: fixture.assessmentId,
            idempotencyKey: `generation:${fixture.generationRunId}`,
          },
        }),
      ).toBe(0);
    },
  );
});
afterAll(() => prisma.$disconnect());
