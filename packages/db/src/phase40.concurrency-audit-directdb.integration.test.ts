import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  prisma,
  processGenerationRun,
  requestDraftGeneration,
} from './index.js';

function extractDatabaseDiagnostic(error: unknown): { sqlState: string; databaseMessage: string } {
  const message = error instanceof Error ? error.message : String(error);
  const connector = message.match(/code: "([0-9A-Z]{5})", message: "([^"]*)"/);
  if (connector) return { sqlState: connector[1]!, databaseMessage: connector[2]! };
  const match = message.match(/Raw query failed\. Code: `([0-9A-Z]{5})`\. Message: `([\s\S]*)`/);
  if (match) return { sqlState: match[1]!, databaseMessage: match[2]! };
  const diagnostic = error as { meta?: { code?: string; message?: string } };
  if (diagnostic.meta?.code && diagnostic.meta.message)
    return { sqlState: diagnostic.meta.code, databaseMessage: diagnostic.meta.message };
  throw new Error(`database diagnostic unavailable: ${message}`);
}

async function expectExactDatabaseError(
  action: () => Promise<unknown>,
  expectedMessage: string,
  expectedSqlState: string,
): Promise<void> {
  let error: unknown;
  let completed = false;
  try {
    await action();
    completed = true;
  } catch (caught) {
    error = caught;
  }
  expect(completed).toBe(false);
  const { sqlState, databaseMessage } = extractDatabaseDiagnostic(error);
  expect(sqlState).toBe(expectedSqlState);
  expect(databaseMessage).toBe(expectedMessage);
}
async function expectedCitationCount(runId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM generation_expected_question_citations
    WHERE generation_run_id = ${runId}::uuid
  `;
  return Number(rows[0]!.count);
}

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
        let leaseError: unknown;
        try {
          await processGenerationRun(
            fixture.generationRunId,
            prisma,
            new DeterministicFakeModelGateway(),
          );
        } catch (error) {
          leaseError = error;
        }
        expect(leaseError).toBeInstanceOf(Error);
        expect((leaseError as Error).message).toBe('GENERATION_LEASE_ACTIVE');
        expect(
          await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
        ).toBe(0);
        expect(
          await prisma.generationUsage.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(0);
        expect(
          await prisma.questionSourceLink.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(0);
        expect(await expectedCitationCount(fixture.generationRunId)).toBe(0);
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
        let leaseError: unknown;
        try {
          await processGenerationRun(
            fixture.generationRunId,
            prisma,
            new DeterministicFakeModelGateway(),
          );
        } catch (error) {
          leaseError = error;
        }
        expect(leaseError).toBeInstanceOf(Error);
        expect((leaseError as Error).message).toBe('GENERATION_LEASE_ACTIVE');
        expect(
          await prisma.generationRun.findUniqueOrThrow({ where: { id: fixture.generationRunId } }),
        ).toMatchObject({ state: 'PROCESSING', attempts: 1, outputRevisionId: null });
        expect(
          await prisma.generationUsage.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(0);
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
        expect(
          await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
        ).toBe(0);
        expect(
          await prisma.questionSourceLink.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(0);
        expect(await expectedCitationCount(fixture.generationRunId)).toBe(0);
        return;
      }
      if (kind === 'concurrent-processing') {
        const concurrentEvidenceBefore = {
          revisions: await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
          usages: await prisma.generationUsage.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          contexts: await prisma.generationContextItem.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          links: await prisma.questionSourceLink.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          expectedLinks: await expectedCitationCount(fixture.generationRunId),
          outbox: await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          audit: await prisma.auditEvent.count({ where: { targetId: fixture.generationRunId } }),
        };
        const rawResults = await Promise.allSettled([
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
        const results = [...rawResults].sort(
          (left, right) =>
            Number(right.status === 'fulfilled') - Number(left.status === 'fulfilled'),
        );
        const firstResult = results[0];
        const secondResult = results[1];
        if (!firstResult || !secondResult) throw new Error('concurrent result vector incomplete');
        expect(firstResult).toMatchObject({
          status: 'fulfilled',
          value: { state: 'SUCCEEDED', failureCode: null, outputRevisionId: expect.any(String) },
        });
        expect(secondResult.status).toBe('rejected');
        if (secondResult.status === 'rejected')
          expect((secondResult.reason as Error).message).toBe('GENERATION_LEASE_ACTIVE');
        expect(
          await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
        ).toBe(1);
        expect(
          await prisma.generationUsage.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(1);
        expect(
          await prisma.questionSourceLink.count({
            where: { generationRunId: fixture.generationRunId },
          }),
        ).toBe(1);
        expect(await expectedCitationCount(fixture.generationRunId)).toBe(1);
        const concurrentEvidenceAfter = {
          revisions: await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
          usages: await prisma.generationUsage.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          contexts: await prisma.generationContextItem.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          links: await prisma.questionSourceLink.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          expectedLinks: await expectedCitationCount(fixture.generationRunId),
          outbox: await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          audit: await prisma.auditEvent.count({ where: { targetId: fixture.generationRunId } }),
        };
        expect(concurrentEvidenceAfter).toEqual({
          revisions: concurrentEvidenceBefore.revisions + 1,
          usages: 1,
          contexts: 1,
          links: 1,
          expectedLinks: 1,
          outbox: concurrentEvidenceBefore.outbox,
          audit: concurrentEvidenceBefore.audit + 1,
        });
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
          expectedCitationCount(fixture.generationRunId),
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
            expectedCitationCount(fixture.generationRunId),
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
        await expectExactDatabaseError(
          () =>
            prisma.generationUsage.update({
              where: { id: usage.id },
              data: { requestId: 'changed' },
            }),
          'generation evidence is append-only',
          'P0001',
        );
        await expectExactDatabaseError(
          () => prisma.generationUsage.delete({ where: { id: usage.id } }),
          'generation evidence is append-only',
          'P0001',
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
        await expectExactDatabaseError(
          () =>
            prisma.generationContextItem.update({
              where: { id: context.id },
              data: { locator: 'changed' },
            }),
          'generation evidence is append-only',
          'P0001',
        );
        await expectExactDatabaseError(
          () => prisma.generationContextItem.delete({ where: { id: context.id } }),
          'generation evidence is append-only',
          'P0001',
        );
      } else if (kind === 'source-link-append-only') {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const link = await prisma.questionSourceLink.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        await expectExactDatabaseError(
          () =>
            prisma.questionSourceLink.update({
              where: { id: link.id },
              data: { locator: 'changed' },
            }),
          'generation evidence is append-only',
          'P0001',
        );
        await expectExactDatabaseError(
          () => prisma.questionSourceLink.delete({ where: { id: link.id } }),
          'generation evidence is append-only',
          'P0001',
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
      if (kind === 'run-identity')
        await expectExactDatabaseError(
          async () => {
            const foreign = await createGenerationFixture();
            return prisma.generationRun.update({
              where: { id: fixture.generationRunId },
              data: { requestingUserId: foreign.workspace.user.id },
            });
          },
          'generation run identity is immutable',
          'P0001',
        );
      else if (kind === 'forged-owner') {
        const foreign = await createGenerationFixture();
        await expectExactDatabaseError(
          () =>
            prisma.generationRun.update({
              where: { id: fixture.generationRunId },
              data: { organizationId: foreign.workspace.organization.id },
            }),
          'generation assessment owner invalid',
          'P0001',
        );
      } else if (kind === 'context-update' || kind === 'context-delete') {
        const context = await prisma.generationContextItem.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        if (kind === 'context-update')
          await expectExactDatabaseError(
            () =>
              prisma.generationContextItem.update({
                where: { id: context.id },
                data: { locator: 'forged' },
              }),
            'generation evidence is append-only',
            'P0001',
          );
        else
          await expectExactDatabaseError(
            () => prisma.generationContextItem.delete({ where: { id: context.id } }),
            'generation evidence is append-only',
            'P0001',
          );
      } else if (kind === 'usage-update' || kind === 'usage-delete') {
        const usage = await prisma.generationUsage.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        if (kind === 'usage-update')
          await expectExactDatabaseError(
            () =>
              prisma.generationUsage.update({
                where: { id: usage.id },
                data: { requestId: 'forged' },
              }),
            'generation evidence is append-only',
            'P0001',
          );
        else
          await expectExactDatabaseError(
            () => prisma.generationUsage.delete({ where: { id: usage.id } }),
            'generation evidence is append-only',
            'P0001',
          );
      } else if (kind === 'source-link-update' || kind === 'source-link-delete') {
        const link = await prisma.questionSourceLink.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        if (kind === 'source-link-update')
          await expectExactDatabaseError(
            () =>
              prisma.questionSourceLink.update({
                where: { id: link.id },
                data: { locator: 'forged' },
              }),
            'generation evidence is append-only',
            'P0001',
          );
        else
          await expectExactDatabaseError(
            () => prisma.questionSourceLink.delete({ where: { id: link.id } }),
            'generation evidence is append-only',
            'P0001',
          );
      } else if (
        kind === 'forged-context-item' ||
        kind === 'forged-context-lineage' ||
        kind === 'duplicate-context-order'
      ) {
        const context = await prisma.generationContextItem.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        const contextMessage =
          kind === 'forged-context-item'
            ? 'generation context identity or eligibility invalid'
            : kind === 'forged-context-lineage'
              ? 'generation context complete lineage invalid'
              : `Key (generation_run_id, selected_order)=(${fixture.generationRunId}, ${context.selectedOrder}) already exists.`;
        const contextSqlState = kind === 'duplicate-context-order' ? '23505' : 'P0001';
        const contextAction =
          kind === 'duplicate-context-order'
            ? () =>
                prisma.$executeRaw`INSERT INTO generation_context_items (id, generation_run_id, selected_order, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, rank, score, character_count, estimated_tokens, lineage) SELECT gen_random_uuid(), generation_run_id, selected_order, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, rank, score, character_count, estimated_tokens, lineage FROM generation_context_items WHERE id = ${context.id}::uuid`
            : () =>
                prisma.generationContextItem.create({
                  data: {
                    generationRunId: context.generationRunId,
                    selectedOrder: 99,
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
                });
        await expectExactDatabaseError(contextAction, contextMessage, contextSqlState);
      } else if (kind === 'forged-question-run') {
        const foreign = await createGenerationFixture();
        const foreignRun = await processGenerationRun(
          foreign.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const foreignResult = await getGenerationResult(foreign.context, foreign.generationRunId);
        const foreignQuestion = foreignResult?.revision?.sections[0]?.questions[0];
        const foreignItem = await prisma.knowledgeItem.findUniqueOrThrow({
          where: { id: foreign.knowledgeItemId },
        });
        if (!foreignRun?.outputRevisionId || !foreignQuestion)
          throw new Error('foreign question fixture missing');
        await expectExactDatabaseError(
          () =>
            prisma.questionSourceLink.create({
              data: {
                assessmentQuestionId: foreignQuestion.id,
                generationRunId: fixture.generationRunId,
                knowledgeItemId: foreign.knowledgeItemId,
                sourceVersionId: foreign.sourceVersionId,
                locator: 'fixture://foreign',
                textHash: foreignItem.textHash,
                curriculumVersionId: foreign.curriculumVersionId,
                curriculumNodeId: foreign.curriculumNodeId,
                lineage: 'GENERATED',
              },
            }),
          'question source assessment identity invalid',
          'P0001',
        );
      } else if (kind === 'forged-source-link') {
        const processed = await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        before = await prisma.generationRun.findUniqueOrThrow({
          where: { id: fixture.generationRunId },
        });
        const result = await getGenerationResult(fixture.context, fixture.generationRunId);
        const question = result?.revision?.sections[0]?.questions[0];
        if (!processed?.outputRevisionId || !question)
          throw new Error('source identity fixture missing');
        const pending = await requestDraftGeneration(fixture.context, {
          version: '1.0.0',
          assessmentId: fixture.assessmentId,
          idempotencyKey: `forged-source-${fixture.generationRunId}`,
          curriculumVersionId: fixture.curriculumVersionId,
          curriculumNodeIds: [fixture.curriculumNodeId],
          scoringMode: 'NONE',
          totalScoreUnits: null,
          query: 'x',
          sections: [
            {
              key: 's1',
              title: 'x',
              order: 0,
              scoreUnits: null,
              questions: [
                {
                  key: 'q1',
                  order: 0,
                  type: 'OPEN',
                  difficulty: 'LOW',
                  scoreUnits: null,
                  instructions: '',
                  emphasis: '',
                },
              ],
            },
          ],
        });
        const item = await prisma.knowledgeItem.findUniqueOrThrow({
          where: { id: fixture.knowledgeItemId },
        });
        await expectExactDatabaseError(
          () =>
            prisma.questionSourceLink.create({
              data: {
                assessmentQuestionId: question.id,
                generationRunId: pending.id,
                knowledgeItemId: fixture.knowledgeItemId,
                sourceVersionId: fixture.sourceVersionId,
                locator: 'forged-locator',
                textHash: item.textHash,
                curriculumVersionId: fixture.curriculumVersionId,
                curriculumNodeId: fixture.curriculumNodeId,
                lineage: 'GENERATED',
              },
            }),
          'question source identity invalid',
          'P0001',
        );
      } else if (kind === 'negative-usage')
        await expectExactDatabaseError(
          () =>
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
          'generation usage values invalid',
          'P0001',
        );
      else if (kind === 'duplicate-usage') {
        const usage = await prisma.generationUsage.findFirstOrThrow({
          where: { generationRunId: fixture.generationRunId },
        });
        const expectedMessage = `Key (generation_run_id, attempt)=(${fixture.generationRunId}, ${usage.attempt}) already exists.`;
        await expectExactDatabaseError(
          () =>
            prisma.$executeRaw`INSERT INTO generation_usages (id, generation_run_id, attempt, provider, model, request_id, input_tokens, output_tokens, total_tokens, cost_micros, finish_reason) SELECT gen_random_uuid(), generation_run_id, attempt, provider, model, request_id, input_tokens, output_tokens, total_tokens, cost_micros, finish_reason FROM generation_usages WHERE id = ${usage.id}::uuid`,
          expectedMessage,
          '23505',
        );
      } else if (kind === 'duplicate-idempotency') {
        const run = await prisma.generationRun.findUniqueOrThrow({
          where: { id: fixture.generationRunId },
        });
        const expectedMessage = `Key (organization_id, assessment_id, idempotency_key)=(${run.organizationId}, ${run.assessmentId}, ${run.idempotencyKey}) already exists.`;
        await expectExactDatabaseError(
          () =>
            prisma.$executeRaw`INSERT INTO generation_runs (id, organization_id, requesting_user_id, assessment_id, operation, idempotency_key, request_fingerprint, frozen_specification, curriculum_version_id, state, attempts, prompt_template_version, prompt_template_hash, model_configuration_version, model_configuration_hash, response_schema_version, response_schema_hash) SELECT gen_random_uuid(), organization_id, requesting_user_id, assessment_id, operation, idempotency_key, request_fingerprint, frozen_specification, curriculum_version_id, state, attempts, prompt_template_version, prompt_template_hash, model_configuration_version, model_configuration_hash, response_schema_version, response_schema_hash FROM generation_runs WHERE id = ${fixture.generationRunId}::uuid`,
          expectedMessage,
          '23505',
        );
      } else if (kind === 'terminal-reopen')
        await expectExactDatabaseError(
          () =>
            prisma.generationRun.update({
              where: { id: fixture.generationRunId },
              data: { state: 'PENDING' },
            }),
          'invalid generation run transition',
          'P0001',
        );
      else if (kind === 'success-without-revision') {
        await prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: {
            state: 'PROCESSING',
            attempts: 1,
            processingStartedAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + 60_000),
          },
        });
        before = await prisma.generationRun.findUniqueOrThrow({
          where: { id: fixture.generationRunId },
        });
        await expectExactDatabaseError(
          () =>
            prisma.generationRun.update({
              where: { id: fixture.generationRunId },
              data: {
                state: 'SUCCEEDED',
                provider: 'fake',
                model: 'fake',
                processedAt: new Date(),
                failureCode: null,
                outputRevisionId: null,
              },
            }),
          'success shape invalid',
          'P0001',
        );
      } else if (kind === 'orphan-identity')
        await expectExactDatabaseError(
          () =>
            prisma.generationRun.update({
              where: { id: fixture.generationRunId },
              data: { assessmentId: '00000000-0000-4000-8000-000000000099' },
            }),
          'generation assessment owner invalid',
          'P0001',
        );
      else if (kind === 'wrong-assessment-revision') {
        const foreign = await createGenerationFixture();
        const foreignRun = await processGenerationRun(
          foreign.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        if (!foreignRun?.outputRevisionId) throw new Error('foreign revision fixture missing');
        await prisma.generationRun.update({
          where: { id: fixture.generationRunId },
          data: {
            state: 'PROCESSING',
            attempts: 1,
            processingStartedAt: new Date(),
            leaseExpiresAt: new Date(Date.now() + 60_000),
          },
        });
        before = await prisma.generationRun.findUniqueOrThrow({
          where: { id: fixture.generationRunId },
        });
        await expectExactDatabaseError(
          () =>
            prisma.generationRun.update({
              where: { id: fixture.generationRunId },
              data: {
                state: 'SUCCEEDED',
                provider: 'fake',
                model: 'fake',
                processedAt: new Date(),
                failureCode: null,
                outputRevisionId: foreignRun.outputRevisionId,
              },
            }),
          'output revision identity invalid',
          'P0001',
        );
      } else throw new Error(`unhandled direct-db case: ${kind}`);
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
    const action = () =>
      prisma.generationRun.update({
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
    else if (legal) await expect(action()).resolves.toMatchObject({ state: to });
    else await expectExactDatabaseError(action, 'invalid generation run transition', 'P0001');
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
