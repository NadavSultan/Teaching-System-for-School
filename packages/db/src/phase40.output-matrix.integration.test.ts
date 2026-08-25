import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway, type ModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  prisma,
  processGenerationRun,
  requestQuestionRegeneration,
} from './index.js';

type Expected = {
  state: 'SUCCEEDED' | 'FAILED';
  failureCode: string | null;
  attempts: number;
  usageCount: number;
  outputRevisionCount: number;
  sourceLinkCount: number;
  expectedCitationCount: number;
};

const gatewayExpectedByOutcome: Record<string, Expected> = {
  'valid-draft': {
    state: 'SUCCEEDED',
    failureCode: null,
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 1,
    sourceLinkCount: 1,
    expectedCitationCount: 1,
  },
  'valid-regeneration': {
    state: 'SUCCEEDED',
    failureCode: null,
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 1,
    sourceLinkCount: 1,
    expectedCitationCount: 1,
  },
  'malformed': {
    state: 'FAILED',
    failureCode: 'SCHEMA_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'schema-violation': {
    state: 'FAILED',
    failureCode: 'SCHEMA_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'timeout': {
    state: 'SUCCEEDED',
    failureCode: null,
    attempts: 2,
    usageCount: 1,
    outputRevisionCount: 1,
    sourceLinkCount: 1,
    expectedCitationCount: 1,
  },
  'rate-limit-retry': {
    state: 'SUCCEEDED',
    failureCode: null,
    attempts: 2,
    usageCount: 1,
    outputRevisionCount: 1,
    sourceLinkCount: 1,
    expectedCitationCount: 1,
  },
  'transient-exhausted': {
    state: 'FAILED',
    failureCode: 'TRANSIENT_EXHAUSTED',
    attempts: 3,
    usageCount: 0,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'permanent-error': {
    state: 'FAILED',
    failureCode: 'PERMANENT_PROVIDER_ERROR',
    attempts: 1,
    usageCount: 0,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'budget-overrun': {
    state: 'FAILED',
    failureCode: 'BUDGET_EXCEEDED',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'replay': {
    state: 'SUCCEEDED',
    failureCode: null,
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 1,
    sourceLinkCount: 1,
    expectedCitationCount: 1,
  },
};

const adversarialExpectedByKind: Record<string, Expected> = {
  'valid-planned-draft': {
    state: 'SUCCEEDED',
    failureCode: null,
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 1,
    sourceLinkCount: 1,
    expectedCitationCount: 1,
  },
  'unknown-field': {
    state: 'FAILED',
    failureCode: 'SCHEMA_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'missing-section': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'unplanned-key': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'duplicate-key': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'wrong-order': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'type-mismatch': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'difficulty-mismatch': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'score-mismatch': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'missing-citation': {
    state: 'FAILED',
    failureCode: 'SCHEMA_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'unknown-citation': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
  'foreign-citation': {
    state: 'FAILED',
    failureCode: 'OUTPUT_INVALID',
    attempts: 1,
    usageCount: 1,
    outputRevisionCount: 0,
    sourceLinkCount: 0,
    expectedCitationCount: 0,
  },
};

async function evidence(runId: string, assessmentId: string) {
  const expectedCitationRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM generation_expected_question_citations
    WHERE generation_run_id = ${runId}::uuid
  `;
  return {
    usageCount: await prisma.generationUsage.count({ where: { generationRunId: runId } }),
    outputRevisionCount: await prisma.assessmentRevision.count({
      where: { assessmentId, idempotencyKey: `generation:${runId}` },
    }),
    sourceLinkCount: await prisma.questionSourceLink.count({ where: { generationRunId: runId } }),
    expectedCitationCount: Number(expectedCitationRows[0]!.count),
  };
}

describe('G — distinct gateway outcomes through processGenerationRun', () => {
  it.each(phase40AcceptanceRegistry.G)(
    '%s persists its explicit terminal evidence',
    async (outcome) => {
      const fixture = await createGenerationFixture();
      let runId = fixture.generationRunId;
      if (outcome === 'valid-regeneration') {
        const base = await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const baseResult = await getGenerationResult(fixture.context, fixture.generationRunId);
        const question = baseResult?.revision?.sections[0]?.questions[0];
        if (!base?.outputRevisionId || !question) throw new Error('missing regeneration base');
        runId = (
          await requestQuestionRegeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            baseRevisionId: base.outputRevisionId,
            targetQuestionId: question.id,
            idempotencyKey: `gateway-regeneration-${fixture.generationRunId}`,
            instruction: 'ניסוח חלופי',
            query: 'שלום',
          })
        ).id;
      }
      const first =
        outcome === 'rate-limit-retry'
          ? 'rate-limit'
          : outcome === 'transient-exhausted'
            ? 'transient'
            : outcome === 'permanent-error'
              ? 'permanent'
              : outcome === 'timeout'
                ? 'hang'
                : outcome === 'malformed'
                  ? 'malformed'
                  : outcome === 'schema-violation'
                    ? 'schema-violation'
                    : 'valid-draft';
      const outcomes: Record<string, any> = { [`${runId}:1`]: first };
      if (outcome === 'transient-exhausted')
        for (let attempt = 2; attempt <= 5; attempt += 1)
          outcomes[`${runId}:${attempt}`] = 'transient';
      const fake = new DeterministicFakeModelGateway(outcomes);
      const gateway: ModelGateway =
        outcome === 'budget-overrun'
          ? {
              execute: async (request) => {
                const response = await new DeterministicFakeModelGateway().execute(request);
                return {
                  ...response,
                  usage: {
                    ...response.usage,
                    inputTokens: 999999,
                    outputTokens: 999999,
                    totalTokens: 1999998,
                    costMicros: 999999,
                  },
                };
              },
            }
          : fake;
      const result = await processGenerationRun(runId, prisma, gateway);
      const expected = gatewayExpectedByOutcome[outcome]!;
      expect({
        state: result?.state,
        failureCode: result?.failureCode,
        attempts: result?.attempts,
      }).toEqual({
        state: expected.state,
        failureCode: expected.failureCode,
        attempts: expected.attempts,
      });
      expect(await evidence(runId, fixture.assessmentId)).toEqual({
        usageCount: expected.usageCount,
        outputRevisionCount: expected.outputRevisionCount,
        sourceLinkCount: expected.sourceLinkCount,
        expectedCitationCount: expected.expectedCitationCount,
      });
      if (outcome === 'replay') {
        const replay = await processGenerationRun(runId, prisma, fake);
        expect(replay?.outputRevisionId).toBe(result?.outputRevisionId);
      }
    },
  );
});

describe('O — distinct adversarial provider outputs through strict processing', () => {
  it.each(phase40AcceptanceRegistry.O)('%s persists its explicit output evidence', async (kind) => {
    const fixture = await createGenerationFixture();
    const foreign = kind === 'foreign-citation' ? await createGenerationFixture() : null;
    const valid = new DeterministicFakeModelGateway();
    const gateway: ModelGateway = {
      execute: async (request) => {
        const response = await valid.execute(request);
        if (kind === 'valid-planned-draft') return response;
        const output: any = response.output;
        if (kind === 'unknown-field') output.unexpected = true;
        if (kind === 'missing-section') output.sections = [];
        if (kind === 'unplanned-key') output.sections[0].questions[0].key = 'not-planned';
        if (kind === 'duplicate-key') output.sections.push(output.sections[0]);
        if (kind === 'wrong-order') output.sections[0].questions[0].order = 4;
        if (kind === 'type-mismatch') output.sections[0].questions[0].type = 'CLOSED';
        if (kind === 'difficulty-mismatch') output.sections[0].questions[0].difficulty = 'HIGH';
        if (kind === 'score-mismatch') output.sections[0].questions[0].scoreUnits = 1;
        if (kind === 'missing-citation') output.sections[0].questions[0].citations = [];
        if (kind === 'unknown-citation')
          output.sections[0].questions[0].citations = ['00000000-0000-4000-8000-000000000099'];
        if (kind === 'foreign-citation')
          output.sections[0].questions[0].citations = [foreign!.knowledgeItemId];
        return { ...response, output };
      },
    };
    const result = await processGenerationRun(fixture.generationRunId, prisma, gateway);
    const expected = adversarialExpectedByKind[kind]!;
    expect({
      state: result?.state,
      failureCode: result?.failureCode,
      attempts: result?.attempts,
    }).toEqual({
      state: expected.state,
      failureCode: expected.failureCode,
      attempts: expected.attempts,
    });
    expect(await evidence(fixture.generationRunId, fixture.assessmentId)).toEqual({
      usageCount: expected.usageCount,
      outputRevisionCount: expected.outputRevisionCount,
      sourceLinkCount: expected.sourceLinkCount,
      expectedCitationCount: expected.expectedCitationCount,
    });
  });
});
afterAll(() => prisma.$disconnect());
