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

describe('G — distinct gateway outcomes through processGenerationRun', () => {
  it.each(phase40AcceptanceRegistry.G)('%s persists the exact gateway outcome', async (outcome) => {
    const fixture = await createGenerationFixture();
    let runId = fixture.generationRunId;
    if (outcome === 'valid-regeneration') {
      const base = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      const result = await getGenerationResult(fixture.context, fixture.generationRunId);
      const question = result?.revision?.sections[0]?.questions[0];
      if (!base?.outputRevisionId || !question) throw new Error('missing regeneration base');
      const regeneration = await requestQuestionRegeneration(fixture.context, {
        version: '1.0.0',
        assessmentId: fixture.assessmentId,
        baseRevisionId: base.outputRevisionId,
        targetQuestionId: question.id,
        idempotencyKey: `gateway-regeneration-${fixture.generationRunId}`,
        instruction: 'ניסוח חלופי',
        query: 'שלום',
      });
      runId = regeneration.id;
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
    if (
      ['valid-draft', 'valid-regeneration', 'replay', 'rate-limit-retry', 'timeout'].includes(
        outcome,
      )
    )
      expect(result?.state).toBe('SUCCEEDED');
    else expect(result?.state).toBe('FAILED');
    if (outcome === 'rate-limit-retry') expect(result?.attempts).toBe(2);
    if (outcome === 'transient-exhausted') expect(result?.attempts).toBe(3);
    if (outcome === 'timeout') expect(result?.attempts).toBe(2);
    if (outcome === 'budget-overrun') expect(result?.failureCode).toBe('BUDGET_EXCEEDED');
    const usageCount = await prisma.generationUsage.count({ where: { generationRunId: runId } });
    const usageExpected = [
      'valid-draft',
      'valid-regeneration',
      'malformed',
      'schema-violation',
      'timeout',
      'rate-limit-retry',
      'budget-overrun',
      'replay',
    ].includes(outcome)
      ? 1
      : 0;
    expect(usageCount).toBe(usageExpected);
    if (outcome === 'replay')
      expect((await processGenerationRun(runId, prisma, fake))?.outputRevisionId).toBe(
        result?.outputRevisionId,
      );
  });
});

describe('O — distinct adversarial provider outputs through strict processing', () => {
  it.each(phase40AcceptanceRegistry.O)(
    '%s rejects or accepts only its exact output shape',
    async (kind) => {
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
      if (kind === 'valid-planned-draft') expect(result?.state).toBe('SUCCEEDED');
      else expect(result?.state).toBe('FAILED');
      if (kind !== 'valid-planned-draft')
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
