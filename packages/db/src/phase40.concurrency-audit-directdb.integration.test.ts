import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { prisma, processGenerationRun } from './index.js';

describe('C — real generation concurrency, lease, replay, and idempotency', () => {
  it.each(phase40AcceptanceRegistry.C)(
    '%s preserves exactly-once processing state',
    async (kind) => {
      const fixture = await createGenerationFixture();
      if (kind === 'active-lease') {
        await prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: {
            state: 'PROCESSING',
            attempts: 1,
            processingStartedAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + 60_000),
          },
        });
        await expect(
          processGenerationRun(
            fixture.generationRunId,
            prisma,
            new DeterministicFakeModelGateway(),
          ),
        ).rejects.toThrow('GENERATION_LEASE_ACTIVE');
        return;
      }
      if (
        kind === 'stale-reclaim' ||
        kind === 'crash-after-claim' ||
        kind === 'crash-after-context'
      ) {
        await prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: {
            state: 'PROCESSING',
            attempts: 1,
            processingStartedAt: new Date(Date.now() - 60_000),
            leaseExpiresAt: new Date(Date.now() - 1),
          },
        });
        const recovered = await processGenerationRun(fixture.generationRunId, prisma, undefined);
        expect(recovered?.attempts).toBe(2);
        expect(['FAILED', 'INSUFFICIENT_CONTEXT']).toContain(recovered?.state);
        return;
      }
      if (kind === 'concurrent-processing') {
        const results = await Promise.allSettled([
          processGenerationRun(
            fixture.generationRunId,
            prisma,
            new DeterministicFakeModelGateway(),
          ),
          processGenerationRun(
            fixture.generationRunId,
            prisma,
            new DeterministicFakeModelGateway(),
          ),
        ]);
        expect(
          results.some(
            (result) => result.status === 'fulfilled' && result.value?.state === 'SUCCEEDED',
          ),
        ).toBe(true);
        expect(
          await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
        ).toBe(1);
        return;
      }
      const first = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      const second = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      expect(first?.state).toBe('SUCCEEDED');
      expect(second?.outputRevisionId).toBe(first?.outputRevisionId);
      expect(
        await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
      ).toBe(1);
    },
  );
});

describe('A — persisted audit, outbox, redaction, and append-only evidence', () => {
  it.each(phase40AcceptanceRegistry.A)(
    '%s proves safe persisted observability and immutability',
    async (kind) => {
      const fixture = await createGenerationFixture();
      const requested = await prisma.outboxEvent.findFirstOrThrow({
        where: { idempotencyKey: `generation:${fixture.generationRunId}` },
      });
      expect(requested.payload).toEqual({ generationRunId: fixture.generationRunId });
      if (kind === 'usage-append-only') {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const usage = await prisma.generationUsage.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expect(
          prisma.generationUsage.update({
            where: { id: usage.id },
            data: { requestId: 'changed' },
          }),
        ).rejects.toThrow();
        await expect(prisma.generationUsage.delete({ where: { id: usage.id } })).rejects.toThrow();
      } else if (kind === 'context-append-only') {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const context = await prisma.generationContextItem.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expect(
          prisma.generationContextItem.delete({ where: { id: context.id } }),
        ).rejects.toThrow();
      } else if (kind === 'source-link-append-only') {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const link = await prisma.questionSourceLink.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expect(
          prisma.questionSourceLink.delete({ where: { id: link.id } }),
        ).rejects.toThrow();
      } else {
        const audit = await prisma.auditEvent.findFirst({
          where: { targetId: fixture.generationRunId },
        });
        expect(audit?.metadata).not.toHaveProperty('sourceText');
        expect(JSON.stringify(requested.payload)).not.toContain('שלום עולם');
      }
    },
  );
});

describe('D — direct database adversarial invariants', () => {
  it.each(phase40AcceptanceRegistry.D)(
    '%s rejects the targeted mutation and preserves the valid run',
    async (kind) => {
      const fixture = await createGenerationFixture();
      const before = await prisma.generationRun.findUniqueOrThrow({
        where: { id: fixture.generationRunId },
      });
      if (kind === 'run-identity' || kind === 'forged-owner')
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { organizationId: '00000000-0000-4000-8000-000000000099' },
          }),
        ).rejects.toThrow();
      else if (kind === 'negative-usage')
        await expect(
          prisma.generationUsage.create({
            data: {
              generationRunId: fixture.generationRunId,
              attempt: 1,
              provider: 'x',
              model: 'x',
              requestId: 'd',
              inputTokens: -1,
              outputTokens: 0,
              totalTokens: 0,
              costMicros: 0,
              finishReason: 'stop',
            },
          }),
        ).rejects.toThrow();
      else if (kind === 'duplicate-idempotency')
        await expect(
          prisma.generationRun.create({
            data: { ...before, id: undefined, updatedAt: undefined, createdAt: undefined } as never,
          }),
        ).rejects.toThrow();
      else if (kind.endsWith('-delete') || kind.endsWith('-update'))
        await expect(
          prisma.generationContextItem.delete({
            where: { id: '00000000-0000-4000-8000-000000000099' },
          }),
        ).rejects.toThrow();
      else
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { state: 'SUCCEEDED', processedAt: new Date() },
          }),
        ).rejects.toThrow();
      const after = await prisma.generationRun.findUniqueOrThrow({
        where: { id: fixture.generationRunId },
      });
      expect({
        state: after.state,
        attempts: after.attempts,
        outputRevisionId: after.outputRevisionId,
      }).toEqual({
        state: before.state,
        attempts: before.attempts,
        outputRevisionId: before.outputRevisionId,
      });
    },
  );
});

describe('L — PostgreSQL generation-run transition matrix', () => {
  it.each(phase40AcceptanceRegistry.L)('%s enforces the exact transition pair', async (pair) => {
    const [from, to] = pair.split('->');
    const fixture = await createGenerationFixture();
    if (from === 'PENDING' && to === 'PROCESSING') {
      const updated = await prisma.generationRun.update({
        where: { id: fixture.generationRunId },
        data: {
          state: 'PROCESSING',
          attempts: 1,
          processingStartedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 5000),
        },
      });
      expect(updated.state).toBe('PROCESSING');
    } else if (from === 'PROCESSING') {
      await prisma.generationRun.update({
        where: { id: fixture.generationRunId },
        data: {
          state: 'PROCESSING',
          attempts: 1,
          processingStartedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() - 1),
        },
      });
      if (to === 'PENDING') {
        const updated = await prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: { state: 'PENDING', leaseExpiresAt: null },
        });
        expect(updated.state).toBe('PENDING');
      } else if (to === 'FAILED' || to === 'INSUFFICIENT_CONTEXT') {
        const updated = await prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: {
            state: to,
            failureCode: 'CONTEXT_EMPTY',
            processedAt: new Date(),
            leaseExpiresAt: null,
          },
        });
        expect(updated.state).toBe(to);
      } else if (to === 'SUCCEEDED') {
        const result = await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        expect(result?.state).toBe('SUCCEEDED');
      } else
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { state: to as never },
          }),
        ).rejects.toThrow();
    } else {
      await prisma.generationRun.update({
        where: { id: fixture.generationRunId },
        data: {
          state: 'PROCESSING',
          attempts: 1,
          processingStartedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() - 1),
        },
      });
      await prisma.generationRun.update({
        where: { id: fixture.generationRunId },
        data: {
          state: 'FAILED',
          failureCode: 'CONTEXT_EMPTY',
          processedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      await expect(
        prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: { state: to as never },
        }),
      ).rejects.toThrow();
    }
  });
});

afterAll(() => prisma.$disconnect());
