import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway, type ModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  prisma,
  processGenerationRun,
  recordPedagogicalReview,
  recordUsagePermission,
  setSourceLifecycle,
} from './index.js';

describe('E2 — pre-commit eligibility invalidation', () => {
  it.each(phase40AcceptanceRegistry.E2)(
    '%s invalidates an otherwise valid run before commit',
    async (dimension) => {
      const fixture = await createGenerationFixture();
      const validGateway = new DeterministicFakeModelGateway();
      const invalidatingGateway: ModelGateway = {
        execute: async (request) => {
          if (dimension === 'rejected-review')
            await recordPedagogicalReview(fixture.context, {
              version: '1.0.0',
              sourceVersionId: fixture.sourceVersionId,
              decision: 'REJECTED',
              reason: 'race',
            });
          if (dimension === 'denied-permission')
            await recordUsagePermission(fixture.context, {
              version: '1.0.0',
              sourceVersionId: fixture.sourceVersionId,
              decision: 'DENIED',
              evidenceReference: 'race',
              scope: 'AI_GENERATION',
            });
          if (dimension === 'expired-permission')
            await prisma.usagePermission.create({
              data: {
                sourceVersionId: fixture.sourceVersionId,
                reviewerUserId: fixture.context.principal.userId,
                decision: 'ALLOWED',
                evidenceReference: 'race',
                scope: 'AI_GENERATION',
                validUntil: new Date(Date.now() - 1),
              },
            });
          if (['SUSPENDED', 'DEPRECATED', 'FAILED', 'NEEDS_RE_REVIEW'].includes(dimension))
            await setSourceLifecycle(
              fixture.context,
              fixture.sourceVersionId,
              dimension as 'SUSPENDED' | 'DEPRECATED' | 'FAILED' | 'NEEDS_RE_REVIEW',
              'race',
            );
          return validGateway.execute(request);
        },
      };
      const before = await prisma.assessmentRevision.count({
        where: { assessmentId: fixture.assessmentId },
      });
      const result = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        invalidatingGateway,
      );
      expect(['FAILED', 'INSUFFICIENT_CONTEXT']).toContain(result?.state);
      expect(
        await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
      ).toBe(before);
      expect(
        await prisma.questionSourceLink.count({
          where: { generationRunId: fixture.generationRunId },
        }),
      ).toBe(0);
      expect(
        await prisma.auditEvent.count({
          where: { targetId: fixture.generationRunId, eventType: 'generation.succeeded' },
        }),
      ).toBe(0);
    },
  );
});
afterAll(() => prisma.$disconnect());
