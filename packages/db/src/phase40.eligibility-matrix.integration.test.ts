import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { prisma, selectGenerationContext, processGenerationRun } from './index.js';

describe('E1 — independent current Phase 30 eligibility dimensions', () => {
  it.each(phase40AcceptanceRegistry.E1)(
    '%s is excluded for its named persisted dimension',
    async (dimension) => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const fixture = await createGenerationFixture(
        dimension === 'missing-review'
          ? { review: null }
          : dimension === 'rejected-review'
            ? { review: 'REJECTED' }
            : dimension === 'missing-permission'
              ? { permission: null }
              : dimension === 'denied-permission'
                ? { permission: 'DENIED' }
                : dimension === 'expired-permission'
                  ? { permission: 'ALLOWED', permissionValidUntil: past }
                  : dimension === 'DRAFT'
                    ? { lifecycle: 'DRAFT' }
                    : dimension === 'SUSPENDED' ||
                        dimension === 'DEPRECATED' ||
                        dimension === 'FAILED' ||
                        dimension === 'NEEDS_RE_REVIEW'
                      ? { lifecycle: dimension }
                      : dimension === 'same-timestamp-rejected-review'
                        ? { review: 'APPROVED' }
                        : dimension === 'same-timestamp-denied-permission'
                          ? { permission: 'ALLOWED' }
                          : dimension === 'wrong-node'
                            ? { wrongRequestedNode: true }
                            : dimension === 'wrong-curriculum-version'
                              ? { wrongRequestedCurriculum: true }
                              : dimension === 'no-result'
                                ? { query: 'מונח-שאינו-קיים' }
                                : dimension === 'inactive-item'
                                  ? { inactiveItem: true }
                                  : dimension === 'cross-tenant-private'
                                    ? { crossTenantPrivate: true }
                                    : { lifecycle: 'SUSPENDED' },
      );
      if (dimension === 'same-timestamp-rejected-review') {
        const at = new Date();
        await prisma.pedagogicalReview.create({
          data: {
            id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
            sourceVersionId: fixture.sourceVersionId,
            reviewerUserId: fixture.context.principal.userId,
            decision: 'REJECTED',
            reason: 'same timestamp',
            createdAt: at,
          },
        });
        const latest = await prisma.pedagogicalReview.findFirstOrThrow({
          where: { sourceVersionId: fixture.sourceVersionId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        expect(latest.decision).toBe('REJECTED');
      } else if (dimension === 'same-timestamp-denied-permission') {
        const at = new Date();
        await prisma.usagePermission.create({
          data: {
            id: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
            sourceVersionId: fixture.sourceVersionId,
            reviewerUserId: fixture.context.principal.userId,
            decision: 'DENIED',
            evidenceReference: 'same timestamp',
            scope: 'AI_GENERATION',
            createdAt: at,
          },
        });
        const latest = await prisma.usagePermission.findFirstOrThrow({
          where: { sourceVersionId: fixture.sourceVersionId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        expect(latest.decision).toBe('DENIED');
      }
      const selected = await selectGenerationContext(fixture.generationRunId, prisma);
      expect(selected).toEqual([]);
      const processed = await processGenerationRun(fixture.generationRunId, prisma, undefined);
      expect(processed?.state).toBe('FAILED');
      expect(
        await prisma.assessmentRevision.count({
          where: {
            assessmentId: fixture.assessmentId,
            idempotencyKey: `generation:${fixture.generationRunId}`,
          },
        }),
      ).toBe(0);
      const item = await prisma.knowledgeItem.findUniqueOrThrow({
        where: { id: fixture.knowledgeItemId },
      });
      if (dimension === 'inactive-item') expect(item.status).toBe('SUSPENDED');
      if (dimension === 'expired-permission')
        expect(
          (
            await prisma.usagePermission.findFirstOrThrow({
              where: { sourceVersionId: fixture.sourceVersionId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            })
          ).validUntil!.getTime(),
        ).toBeLessThan(Date.now());
    },
  );
});
afterAll(() => prisma.$disconnect());
