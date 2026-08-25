import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  prisma,
  processGenerationRun,
  requestDraftGeneration,
  requestQuestionRegeneration,
} from './index.js';

describe('Q — regeneration graph isolation and provenance', () => {
  it.each(phase40AcceptanceRegistry.Q)(
    '%s asserts the persisted base/output graph contract',
    async (kind) => {
      const fixture = await createGenerationFixture({ multiQuestion: true });
      const baseRun = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      expect(baseRun?.state).toBe('SUCCEEDED');
      const base = await getGenerationResult(fixture.context, fixture.generationRunId);
      const target = base?.revision?.sections[0]?.questions[0];
      expect(target).toBeTruthy();
      if (
        kind === 'missing-target' ||
        kind === 'foreign-target' ||
        kind === 'target-outside-base' ||
        kind === 'foreign-base'
      ) {
        let targetId =
          kind === 'missing-target' || kind === 'foreign-target'
            ? '00000000-0000-4000-8000-000000000099'
            : target!.id;
        if (kind === 'target-outside-base') {
          const sourceRun = await prisma.generationRun.findUniqueOrThrow({
            where: { id: fixture.generationRunId },
          });
          const spec = sourceRun.frozenSpecification as any;
          const second = await requestDraftGeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            idempotencyKey: `outside-${fixture.generationRunId}`,
            curriculumVersionId: spec.curriculumVersionId,
            curriculumNodeIds: spec.curriculumNodeIds,
            scoringMode: spec.scoringMode,
            totalScoreUnits: spec.totalScoreUnits,
            query: spec.query,
            sections: spec.sections,
          });
          await processGenerationRun(second.id, prisma, new DeterministicFakeModelGateway());
          const secondResult = await getGenerationResult(fixture.context, second.id);
          targetId = secondResult!.revision!.sections[0]!.questions[0]!.id;
        }
        await expect(
          requestQuestionRegeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            baseRevisionId:
              kind === 'foreign-base' ? '00000000-0000-4000-8000-000000000099' : base!.revision!.id,
            targetQuestionId: targetId,
            idempotencyKey: `q-${kind}-${fixture.generationRunId}`,
            instruction: 'ניסוח',
            query: 'שלום',
          }),
        ).rejects.toThrow();
        return;
      }
      if (kind === 'concurrent-sequential-revisions') {
        const [a, b] = await Promise.all([
          requestQuestionRegeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            baseRevisionId: base!.revision!.id,
            targetQuestionId: target!.id,
            idempotencyKey: `qa-${fixture.generationRunId}`,
            instruction: 'א',
            query: 'שלום',
          }),
          requestQuestionRegeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            baseRevisionId: base!.revision!.id,
            targetQuestionId: target!.id,
            idempotencyKey: `qb-${fixture.generationRunId}`,
            instruction: 'ב',
            query: 'שלום',
          }),
        ]);
        const results = await Promise.all([
          processGenerationRun(a.id, prisma, new DeterministicFakeModelGateway()),
          processGenerationRun(b.id, prisma, new DeterministicFakeModelGateway()),
        ]);
        expect(results.every((result) => result?.state === 'SUCCEEDED')).toBe(true);
        expect(new Set(results.map((result) => result?.outputRevisionId)).size).toBe(2);
        return;
      }
      const regeneration = await requestQuestionRegeneration(fixture.context, {
        version: '1.0.0',
        assessmentId: fixture.assessmentId,
        baseRevisionId: base!.revision!.id,
        targetQuestionId: target!.id,
        idempotencyKey: `q-${kind}-${fixture.generationRunId}`,
        instruction: 'נסחו מחדש',
        query: 'שלום',
      });
      const retry = await requestQuestionRegeneration(fixture.context, {
        version: '1.0.0',
        assessmentId: fixture.assessmentId,
        baseRevisionId: base!.revision!.id,
        targetQuestionId: target!.id,
        idempotencyKey: `q-${kind}-${fixture.generationRunId}`,
        instruction: 'נסחו מחדש',
        query: 'שלום',
      });
      expect(retry).toEqual(regeneration);
      const output = await processGenerationRun(
        regeneration.id,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      expect(output?.state).toBe('SUCCEEDED');
      const regenerated = await getGenerationResult(fixture.context, regeneration.id);
      expect(regenerated?.revision?.id).not.toBe(base?.revision?.id);
      expect(regenerated?.revision?.sections[0]?.questions[0]?.key).toBe(target?.key);
      const links = await prisma.questionSourceLink.findMany({
        where: { generationRunId: regeneration.id },
      });
      expect(
        links.some((link) => link.lineage === 'GENERATED' && link.priorQuestionId === target!.id),
      ).toBe(true);
      if (kind === 'unrelated-structure-equal' || kind === 'carried-forward-links') {
        expect(regenerated?.revision?.sections.length).toBe(base?.revision?.sections.length);
        expect(regenerated?.revision?.sections[1]?.questions[0]?.key).toBe(
          base?.revision?.sections[1]?.questions[0]?.key,
        );
      }
      if (kind === 'carried-forward-links')
        expect(links.some((link) => link.lineage === 'CARRIED_FORWARD')).toBe(true);
      if (kind === 'idempotent-retry') expect(retry.id).toBe(regeneration.id);
    },
  );
});
afterAll(() => prisma.$disconnect());
