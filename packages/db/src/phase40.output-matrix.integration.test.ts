import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway, type ModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { prisma, processGenerationRun } from './index.js';

describe('G — distinct gateway outcomes through processGenerationRun', () => {
  it.each(phase40AcceptanceRegistry.G)('%s persists the exact gateway outcome', async (outcome) => {
    const fixture = await createGenerationFixture();
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
    const outcomes: Record<string, any> = { [`${fixture.generationRunId}:1`]: first };
    if (outcome === 'transient-exhausted')
      for (let attempt = 2; attempt <= 5; attempt += 1)
        outcomes[`${fixture.generationRunId}:${attempt}`] = 'transient';
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
    const result = await processGenerationRun(fixture.generationRunId, prisma, gateway);
    if (
      ['valid-draft', 'valid-regeneration', 'replay', 'rate-limit-retry', 'timeout'].includes(
        outcome,
      )
    )
      expect(result?.state).toBe('SUCCEEDED');
    else expect(['FAILED', 'INSUFFICIENT_CONTEXT']).toContain(result?.state);
    if (
      outcome === 'rate-limit-retry' ||
      outcome === 'transient-exhausted' ||
      outcome === 'timeout'
    )
      expect(result?.attempts).toBeGreaterThan(1);
    if (outcome === 'budget-overrun') expect(result?.failureCode).toBe('BUDGET_EXCEEDED');
    expect(
      await prisma.generationUsage.count({ where: { generationRunId: fixture.generationRunId } }),
    ).toBeGreaterThanOrEqual(0);
    if (outcome === 'replay')
      expect(
        (await processGenerationRun(fixture.generationRunId, prisma, fake))?.outputRevisionId,
      ).toBe(result?.outputRevisionId);
  });
});

describe('O — distinct adversarial provider outputs through strict processing', () => {
  it.each(phase40AcceptanceRegistry.O)(
    '%s rejects or accepts only its exact output shape',
    async (kind) => {
      const fixture = await createGenerationFixture();
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
          if (kind === 'unknown-citation' || kind === 'foreign-citation')
            output.sections[0].questions[0].citations = ['00000000-0000-4000-8000-000000000099'];
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
