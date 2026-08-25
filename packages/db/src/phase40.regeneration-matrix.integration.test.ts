import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { AccessDeniedError } from '@teach/domain';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  prisma,
  processGenerationRun,
  requestDraftGeneration,
  requestQuestionRegeneration,
} from './index.js';
async function expectedCitationCount(runId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM generation_expected_question_citations
    WHERE generation_run_id = ${runId}::uuid
  `;
  return Number(rows[0]!.count);
}

describe('Q — regeneration graph isolation and provenance', () => {
  const missingQuestionId = '00000000-0000-4000-8000-000000000099';
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
      if (kind === 'foreign-base') {
        const foreign = await createGenerationFixture();
        const foreignRun = await processGenerationRun(
          foreign.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const foreignResult = await getGenerationResult(foreign.context, foreign.generationRunId);
        const foreignBase = foreignResult?.revision;
        if (!foreignRun?.outputRevisionId || !foreignBase)
          throw new Error('foreign base fixture missing finalized output');
        const before = {
          runs: await prisma.generationRun.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          outbox: await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          audits: await prisma.auditEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          revisions: await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
        };
        let caught: unknown;
        try {
          await requestQuestionRegeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            baseRevisionId: foreignBase.id,
            targetQuestionId: target!.id,
            idempotencyKey: `q-foreign-base-${fixture.generationRunId}`,
            instruction: 'ניסוח',
            query: 'שלום',
          });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AccessDeniedError);
        expect((caught as Error).message).toBe('Resource not found or unavailable');
        expect(
          await prisma.generationRun.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        ).toBe(before.runs);
        expect(
          await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        ).toBe(before.outbox);
        expect(
          await prisma.auditEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        ).toBe(before.audits);
        expect(
          await prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
        ).toBe(before.revisions);
        return;
      }
      const isTargetBoundaryCase = new Set([
        'missing-target',
        'foreign-target',
        'target-outside-base',
      ]).has(kind);
      if (isTargetBoundaryCase) {
        let targetId = target!.id;
        if (kind === 'missing-target') targetId = missingQuestionId;
        if (kind === 'foreign-target') {
          const foreign = await createGenerationFixture();
          const foreignBase = await processGenerationRun(
            foreign.generationRunId,
            prisma,
            new DeterministicFakeModelGateway(),
          );
          const foreignResult = await getGenerationResult(foreign.context, foreign.generationRunId);
          if (!foreignBase?.outputRevisionId || !foreignResult?.revision?.sections[0]?.questions[0])
            throw new Error('foreign target fixture missing');
          targetId = foreignResult.revision.sections[0].questions[0].id;
        }
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
        const before = {
          runs: await prisma.generationRun.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          revisions: await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
          outbox: await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          audits: await prisma.auditEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        };
        let caught: unknown;
        try {
          await requestQuestionRegeneration(fixture.context, {
            version: '1.0.0',
            assessmentId: fixture.assessmentId,
            baseRevisionId: base!.revision!.id,
            targetQuestionId: targetId,
            idempotencyKey: `q-${kind}-${fixture.generationRunId}`,
            instruction: 'ניסוח',
            query: 'שלום',
          });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AccessDeniedError);
        expect((caught as Error).message).toBe('Resource not found or unavailable');
        expect(
          await prisma.generationRun.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        ).toBe(before.runs);
        expect(
          await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
        ).toBe(before.revisions);
        expect(
          await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        ).toBe(before.outbox);
        expect(
          await prisma.auditEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
        ).toBe(before.audits);
        return;
      }
      if (kind === 'concurrent-sequential-revisions') {
        const concurrentEvidenceBefore = {
          revisions: await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
          usages: await prisma.generationUsage.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          links: await prisma.questionSourceLink.count({
            where: { generationRunId: fixture.generationRunId },
          }),
          expectedLinks: await expectedCitationCount(fixture.generationRunId),
          outbox: await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          audit: 0,
        };
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
        expect(
          results.map((result) => ({ state: result?.state, failureCode: result?.failureCode })),
        ).toEqual([
          { state: 'SUCCEEDED', failureCode: null },
          { state: 'SUCCEEDED', failureCode: null },
        ]);
        expect(results[0]?.outputRevisionId).not.toBe(results[1]?.outputRevisionId);
        const concurrentEvidenceAfter = {
          revisions: await prisma.assessmentRevision.count({
            where: { assessmentId: fixture.assessmentId },
          }),
          usages: await prisma.generationUsage.count({
            where: { generationRunId: { in: [a.id, b.id] } },
          }),
          links: await prisma.questionSourceLink.count({
            where: { generationRunId: { in: [a.id, b.id] } },
          }),
          expectedLinks: (await expectedCitationCount(a.id)) + (await expectedCitationCount(b.id)),
          outbox: await prisma.outboxEvent.count({
            where: { organizationId: fixture.context.organizationId },
          }),
          audit: await prisma.auditEvent.count({ where: { targetId: { in: [a.id, b.id] } } }),
        };
        expect(concurrentEvidenceAfter).toEqual({
          revisions: concurrentEvidenceBefore.revisions + 2,
          usages: 2,
          links: concurrentEvidenceBefore.links * 2,
          expectedLinks: concurrentEvidenceBefore.expectedLinks * 2,
          outbox: concurrentEvidenceBefore.outbox + 2,
          audit: concurrentEvidenceBefore.audit + 4,
        });
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
      const baseQuestionIds = base!
        .revision!.sections.flatMap((section) => section.questions)
        .filter((question) => question.id !== target!.id)
        .map((question) => question.id);
      const normalizeLink = (link: (typeof links)[number]) => ({
        knowledgeItemId: link.knowledgeItemId,
        sourceVersionId: link.sourceVersionId,
        locator: link.locator,
        textHash: link.textHash,
        curriculumVersionId: link.curriculumVersionId,
        curriculumNodeId: link.curriculumNodeId,
        lineage: link.lineage,
        priorQuestionId: link.priorQuestionId,
      });
      const carriedBaseLinks = (
        await prisma.questionSourceLink.findMany({
          where: { assessmentQuestionId: { in: baseQuestionIds } },
          orderBy: [{ knowledgeItemId: 'asc' }, { assessmentQuestionId: 'asc' }],
        })
      ).map(normalizeLink);
      const carriedOutputLinks = links
        .filter((link) => link.lineage === 'CARRIED_FORWARD')
        .map(normalizeLink)
        .sort((a, b) => a.knowledgeItemId.localeCompare(b.knowledgeItemId));
      expect(carriedOutputLinks).toEqual(
        carriedBaseLinks.map((link) => ({
          ...link,
          lineage: 'CARRIED_FORWARD',
          priorQuestionId: expect.any(String),
        })),
      );
      expect(carriedOutputLinks).toHaveLength(carriedBaseLinks.length);
      expect(
        links.filter((link) => link.lineage === 'GENERATED' && link.priorQuestionId === target!.id),
      ).toHaveLength(1);
      if (kind === 'unrelated-structure-equal' || kind === 'carried-forward-links') {
        expect(regenerated?.revision?.sections.length).toBe(base?.revision?.sections.length);
        expect(regenerated?.revision?.sections[1]?.questions[0]?.key).toBe(
          base?.revision?.sections[1]?.questions[0]?.key,
        );
      }
      if (kind === 'carried-forward-links')
        expect(carriedOutputLinks.length).toBe(carriedBaseLinks.length);
      if (kind === 'idempotent-retry') expect(retry.id).toBe(regeneration.id);
    },
  );
});
afterAll(() => prisma.$disconnect());
