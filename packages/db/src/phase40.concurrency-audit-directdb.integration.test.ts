import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { prisma, processGenerationRun, requestDraftGeneration } from './index.js';

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
      if (kind === 'duplicate-request') {
        const run = await prisma.generationRun.findUniqueOrThrow({
          where: { id: fixture.generationRunId },
        });
        const spec = run.frozenSpecification as any;
        const input = {
          version: '1.0.0',
          assessmentId: fixture.assessmentId,
          idempotencyKey: `duplicate-${fixture.generationRunId}`,
          curriculumVersionId: spec.curriculumVersionId,
          curriculumNodeIds: spec.curriculumNodeIds,
          scoringMode: spec.scoringMode,
          totalScoreUnits: spec.totalScoreUnits,
          query: spec.query,
          sections: spec.sections,
        };
        const first = await requestDraftGeneration(fixture.context, input);
        const retry = await requestDraftGeneration(fixture.context, input);
        expect(retry).toEqual(first);
        expect(
          await prisma.outboxEvent.count({ where: { idempotencyKey: `generation:${first.id}` } }),
        ).toBe(1);
        return;
      }
      if (kind === 'stale-reclaim') {
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
        expect(recovered?.state).toBe('FAILED');
        return;
      }
      if (kind === 'crash-after-claim') {
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
        expect(
          await prisma.outboxEvent.findFirstOrThrow({
            where: { idempotencyKey: `generation:${fixture.generationRunId}` },
          }),
        ).toMatchObject({ publishedAt: null });
        return;
      }
      if (kind === 'crash-after-context') {
        const failingGateway = {
          execute: async () => {
            throw new Error('crash after context');
          },
        };
        const failed = await processGenerationRun(fixture.generationRunId, prisma, failingGateway);
        expect(failed?.state).toBe('FAILED');
        const contextCount = await prisma.generationContextItem.count({
          where: { generationRunId: fixture.generationRunId },
        });
        const replay = await processGenerationRun(fixture.generationRunId, prisma, failingGateway);
        expect(replay?.state).toBe('FAILED');
        expect(
          await prisma.generationContextItem.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(contextCount);
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
        expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
        expect(results[0]).toMatchObject({ status: 'fulfilled', value: { state: 'SUCCEEDED' } });
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
      if (kind === 'terminal-replay' || kind === 'exactly-once-outcome') {
        const counts = await Promise.all([
          prisma.generationUsage.count({ where: { generationRunId: fixture.generationRunId } }),
          prisma.questionSourceLink.count({ where: { generationRunId: fixture.generationRunId } }),
          prisma.auditEvent.count({ where: { targetId: fixture.generationRunId } }),
        ]);
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        expect(
          await Promise.all([
            prisma.generationUsage.count({ where: { generationRunId: fixture.generationRunId } }),
            prisma.questionSourceLink.count({
              where: { generationRunId: fixture.generationRunId },
            }),
            prisma.auditEvent.count({ where: { targetId: fixture.generationRunId } }),
          ]),
        ).toEqual(counts);
      }
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
      if (kind === 'id-only-outbox')
        expect(requested.payload).toEqual({ generationRunId: fixture.generationRunId });
      if (kind === 'safe-audit') {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const audits = await prisma.auditEvent.findMany({
          where: { targetId: fixture.generationRunId },
        });
        expect(audits.length).toBe(2);
        expect(audits.every((audit) => !JSON.stringify(audit.metadata).includes('שלום עולם'))).toBe(
          true,
        );
      }
      if (kind === 'safe-failure-class') {
        const Fake = (await import('@teach/ai')).DeterministicFakeModelGateway;
        const result = await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new Fake({ [`${fixture.generationRunId}:1`]: 'malformed' }),
        );
        expect(result?.failureCode).toBe('SCHEMA_INVALID');
      }
      if (kind === 'provider-redaction') {
        const result = await processGenerationRun(fixture.generationRunId, prisma, {
          execute: async () => {
            throw new Error('provider secret שלום עולם');
          },
        });
        expect(result?.failureCode).toBe('SCHEMA_INVALID');
        expect(JSON.stringify(result)).not.toContain('שלום עולם');
      }
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
        ).rejects.toThrow(/generation evidence is append-only/);
        await expect(prisma.generationUsage.delete({ where: { id: usage.id } })).rejects.toThrow(
          /generation evidence is append-only/,
        );
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
          prisma.generationContextItem.update({
            where: { id: context.id },
            data: { locator: 'changed' },
          }),
        ).rejects.toThrow(/generation evidence is append-only/);
        await expect(
          prisma.generationContextItem.delete({ where: { id: context.id } }),
        ).rejects.toThrow(/generation evidence is append-only/);
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
          prisma.questionSourceLink.update({
            where: { id: link.id },
            data: { locator: 'changed' },
          }),
        ).rejects.toThrow(/generation evidence is append-only/);
        await expect(prisma.questionSourceLink.delete({ where: { id: link.id } })).rejects.toThrow(
          /generation evidence is append-only/,
        );
      } else if (kind === 'safe-worker-log') {
        const failed = await processGenerationRun(fixture.generationRunId, prisma, {
          execute: async () => {
            throw new Error('worker secret שלום עולם');
          },
        });
        expect(failed?.failureCode).toBe('SCHEMA_INVALID');
        const persisted = await prisma.generationRun.findUniqueOrThrow({
          where: { id: fixture.generationRunId },
        });
        expect(JSON.stringify(persisted)).not.toContain('שלום עולם');
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
      let before = await prisma.generationRun.findUniqueOrThrow({
        where: { id: fixture.generationRunId },
      });
      const needsOutput = [
        'context-update',
        'context-delete',
        'usage-update',
        'usage-delete',
        'source-link-update',
        'source-link-delete',
        'duplicate-usage',
        'duplicate-context-order',
        'forged-context-lineage',
        'forged-context-item',
        'forged-question-run',
        'forged-source-link',
      ].includes(kind);
      if (needsOutput)
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
      before = await prisma.generationRun.findUniqueOrThrow({
        where: { id: fixture.generationRunId },
      });
      if (kind === 'run-identity' || kind === 'forged-owner')
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { organizationId: '00000000-0000-4000-8000-000000000099' },
          }),
        ).rejects.toThrow(/generation assessment owner invalid/);
      else if (kind === 'context-update' || kind === 'context-delete') {
        const context = await prisma.generationContextItem.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        if (kind === 'context-update')
          await expect(
            prisma.generationContextItem.update({
              where: { id: context.id },
              data: { locator: 'forged' },
            }),
          ).rejects.toThrow(/generation evidence is append-only/);
        else
          await expect(
            prisma.generationContextItem.delete({ where: { id: context.id } }),
          ).rejects.toThrow(/generation evidence is append-only/);
      } else if (kind === 'usage-update' || kind === 'usage-delete') {
        const usage = await prisma.generationUsage.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        if (kind === 'usage-update')
          await expect(
            prisma.generationUsage.update({
              where: { id: usage.id },
              data: { requestId: 'forged' },
            }),
          ).rejects.toThrow(/generation evidence is append-only/);
        else
          await expect(prisma.generationUsage.delete({ where: { id: usage.id } })).rejects.toThrow(
            /generation evidence is append-only/,
          );
      } else if (kind === 'source-link-update' || kind === 'source-link-delete') {
        const link = await prisma.questionSourceLink.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        if (kind === 'source-link-update')
          await expect(
            prisma.questionSourceLink.update({
              where: { id: link.id },
              data: { locator: 'forged' },
            }),
          ).rejects.toThrow(/question source identity|generation evidence is append-only/);
        else
          await expect(
            prisma.questionSourceLink.delete({ where: { id: link.id } }),
          ).rejects.toThrow(/question source identity|generation evidence is append-only/);
      } else if (
        kind === 'forged-context-item' ||
        kind === 'forged-context-lineage' ||
        kind === 'duplicate-context-order'
      ) {
        const context = await prisma.generationContextItem.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expect(
          prisma.generationContextItem.create({
            data: {
              generationRunId: context.generationRunId,
              selectedOrder: kind === 'duplicate-context-order' ? context.selectedOrder : 99,
              knowledgeItemId: context.knowledgeItemId,
              sourceVersionId: context.sourceVersionId,
              locator: kind === 'forged-context-item' ? 'forged' : context.locator,
              textHash: context.textHash,
              curriculumVersionId: context.curriculumVersionId,
              curriculumNodeId: context.curriculumNodeId,
              rank: context.rank,
              score: context.score,
              characterCount: context.characterCount,
              estimatedTokens: context.estimatedTokens,
              lineage:
                kind === 'forged-context-lineage'
                  ? [
                      {
                        curriculumVersionId: '00000000-0000-4000-8000-000000000099',
                        curriculumNodeId: context.curriculumNodeId,
                      },
                    ]
                  : ((context.lineage ?? []) as any),
            },
          }),
        ).rejects.toThrow(
          /generation context identity or eligibility invalid|generation context complete lineage invalid|Unique constraint failed/,
        );
      } else if (kind === 'forged-question-run' || kind === 'forged-source-link') {
        const link = await prisma.questionSourceLink.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expect(
          prisma.questionSourceLink.update({
            where: { id: link.id },
            data:
              kind === 'forged-question-run'
                ? { generationRunId: '00000000-0000-4000-8000-000000000099' }
                : { sourceVersionId: '00000000-0000-4000-8000-000000000099' },
          }),
        ).rejects.toThrow(/generation evidence is append-only/);
      } else if (kind === 'negative-usage')
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
        ).rejects.toThrow(/generation usage values invalid|constraint/i);
      else if (kind === 'duplicate-usage') {
        const usage = await prisma.generationUsage.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expect(
          prisma.generationUsage.create({
            data: {
              generationRunId: fixture.generationRunId,
              attempt: usage.attempt,
              provider: usage.provider,
              model: usage.model,
              requestId: `${usage.requestId}-duplicate`,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              costMicros: usage.costMicros,
              finishReason: usage.finishReason,
            },
          }),
        ).rejects.toThrow(/constraint|Unique/i);
      } else if (kind === 'duplicate-idempotency')
        await expect(
          prisma.generationRun.create({
            data: { ...before, id: undefined, updatedAt: undefined, createdAt: undefined } as never,
          }),
        ).rejects.toThrow(/constraint|Unique/i);
      else if (kind === 'terminal-reopen')
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { state: 'PENDING' },
          }),
        ).rejects.toThrow(/invalid generation run transition|constraint/i);
      else if (kind === 'success-without-revision')
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { state: 'SUCCEEDED', processedAt: new Date() },
          }),
        ).rejects.toThrow(/successful generation|constraint/i);
      else if (kind === 'orphan-identity')
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { assessmentId: '00000000-0000-4000-8000-000000000099' },
          }),
        ).rejects.toThrow(/constraint|assessment|identity/i);
      else if (kind === 'wrong-assessment-revision')
        await expect(
          prisma.generationRun.update({
            where: { id: fixture.generationRunId },
            data: { outputRevisionId: '00000000-0000-4000-8000-000000000099' },
          }),
        ).rejects.toThrow(/constraint|identity/i);
      else throw new Error(`unhandled direct-db case: ${kind}`);
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
    const [from, to] = pair.split('->') as [string, string];
    const fixture = await createGenerationFixture();
    if (from === 'PROCESSING')
      await prisma.generationRun.update({
        where: { id: fixture.generationRunId },
        data: {
          state: 'PROCESSING',
          attempts: 1,
          processingStartedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() - 1),
        },
      });
    if (from === 'SUCCEEDED') {
      const succeeded = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      expect(succeeded?.state).toBe('SUCCEEDED');
    }
    if (from === 'INSUFFICIENT_CONTEXT' || from === 'FAILED') {
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
          state: from,
          failureCode: 'CONTEXT_EMPTY',
          processedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
    }
    const before = await prisma.generationRun.findUniqueOrThrow({
      where: { id: fixture.generationRunId },
    });
    const legal =
      (from === 'PENDING' && to === 'PROCESSING') ||
      (from === 'PROCESSING' &&
        ['PENDING', 'SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED'].includes(to));
    const action = prisma.generationRun.update({
      where: { id: fixture.generationRunId },
      data:
        legal && to === 'PROCESSING'
          ? {
              state: 'PROCESSING',
              attempts: 1,
              processingStartedAt: new Date(),
              leaseExpiresAt: new Date(Date.now() + 5000),
            }
          : legal && to === 'PENDING'
            ? { state: 'PENDING', leaseExpiresAt: null }
            : legal && to === 'SUCCEEDED'
              ? {
                  state: 'SUCCEEDED',
                  provider: 'fake',
                  model: 'fake',
                  outputRevisionId: before.outputRevisionId,
                  processedAt: new Date(),
                }
              : legal
                ? {
                    state: to as never,
                    failureCode: 'CONTEXT_EMPTY',
                    processedAt: new Date(),
                    leaseExpiresAt: null,
                  }
                : { state: to as never },
    });
    if (legal && from === 'PROCESSING' && to === 'SUCCEEDED')
      await expect(
        processGenerationRun(fixture.generationRunId, prisma, new DeterministicFakeModelGateway()),
      ).resolves.toMatchObject({ state: 'SUCCEEDED' });
    else if (legal) await expect(action).resolves.toMatchObject({ state: to });
    else
      await expect(action).rejects.toThrow(
        /invalid generation run transition|successful generation/,
      );
    const after = await prisma.generationRun.findUniqueOrThrow({
      where: { id: fixture.generationRunId },
    });
    if (!legal)
      expect({
        state: after.state,
        attempts: after.attempts,
        outputRevisionId: after.outputRevisionId,
      }).toEqual({
        state: before.state,
        attempts: before.attempts,
        outputRevisionId: before.outputRevisionId,
      });
  });
});

afterAll(() => prisma.$disconnect());
