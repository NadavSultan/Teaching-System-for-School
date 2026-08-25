import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { DeterministicFakeModelGateway, type ModelGateway } from '@teach/ai';
import { afterAll, describe, expect, it } from 'vitest';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  prisma,
  processGenerationRun,
  requestQuestionRegeneration,
  selectGenerationContext,
} from './index.js';

const missingValidatorRejection = 'MASTER_EXPECTED_VALIDATOR_REJECTION_MISSING';

type MutableGeneratedOutput = {
  citations?: string[];
  sections?: Array<{ questions: Array<{ citations: string[] }> }>;
};

function multiCitationGateway(knowledgeItemIds: string[]): ModelGateway {
  const delegate = new DeterministicFakeModelGateway();
  return {
    async execute(request) {
      const response = await delegate.execute(request);
      const output = structuredClone(response.output) as MutableGeneratedOutput;
      if (output.sections)
        for (const section of output.sections)
          for (const question of section.questions) question.citations = [...knowledgeItemIds];
      else output.citations = [...knowledgeItemIds];
      return { ...response, output };
    },
  };
}

async function addSecondEligibleKnowledgeItem(
  fixture: Awaited<ReturnType<typeof createGenerationFixture>>,
) {
  const original = await prisma.knowledgeItem.findUniqueOrThrow({
    where: { id: fixture.knowledgeItemId },
  });
  const normalizedText = `${original.normalizedText} מקור משלים מאושר`;
  return prisma.knowledgeItem.create({
    data: {
      sourceVersionId: original.sourceVersionId,
      ingestionRunId: original.ingestionRunId,
      organizationId: original.organizationId,
      visibility: original.visibility,
      locator: `${original.locator}-master-${randomUUID()}`,
      normalizedText,
      textHash: createHash('sha256').update(normalizedText, 'utf8').digest('hex'),
      metadata: original.metadata as Prisma.InputJsonValue,
      pipelineVersion: original.pipelineVersion,
      parserVersion: original.parserVersion,
      status: 'ACTIVE',
      curriculumLinks: {
        create: {
          curriculumVersionId: fixture.curriculumVersionId,
          curriculumNodeId: fixture.curriculumNodeId,
        },
      },
    },
  });
}

async function createMultiCitationRegeneration() {
  const fixture = await createGenerationFixture({ multiQuestion: true });
  const secondItem = await addSecondEligibleKnowledgeItem(fixture);
  const citationIds = [fixture.knowledgeItemId, secondItem.id];
  const baseRun = await processGenerationRun(
    fixture.generationRunId,
    prisma,
    multiCitationGateway(citationIds),
  );
  expect(baseRun?.state).toBe('SUCCEEDED');
  const base = await getGenerationResult(fixture.context, fixture.generationRunId);
  const target = base?.revision?.sections[0]?.questions[0];
  const unrelated = base?.revision?.sections[0]?.questions[1];
  if (!base?.revision || !target || !unrelated) throw new Error('master base graph missing');
  const regeneration = await requestQuestionRegeneration(fixture.context, {
    version: '1.0.0',
    assessmentId: fixture.assessmentId,
    baseRevisionId: base.revision.id,
    targetQuestionId: target.id,
    idempotencyKey: `master-regeneration-${randomUUID()}`,
    instruction: 'נסחו מחדש',
    query: 'שלום',
  });
  const regeneratedRun = await processGenerationRun(
    regeneration.id,
    prisma,
    multiCitationGateway(citationIds),
  );
  expect(regeneratedRun?.state).toBe('SUCCEEDED');
  const regenerated = await getGenerationResult(fixture.context, regeneration.id);
  const outputTarget = regenerated?.revision?.sections[0]?.questions[0];
  const outputUnrelated = regenerated?.revision?.sections[0]?.questions[1];
  if (!regeneratedRun?.outputRevisionId || !outputTarget || !outputUnrelated)
    throw new Error('master regenerated graph missing');
  expect(
    await prisma.questionSourceLink.count({
      where: {
        generationRunId: regeneration.id,
        assessmentQuestionId: outputTarget.id,
        lineage: 'GENERATED',
      },
    }),
  ).toBe(2);
  expect(
    await prisma.questionSourceLink.count({
      where: {
        generationRunId: regeneration.id,
        assessmentQuestionId: outputUnrelated.id,
        lineage: 'CARRIED_FORWARD',
      },
    }),
  ).toBe(2);
  return {
    runId: regeneration.id,
    outputRevisionId: regeneratedRun.outputRevisionId,
    outputTargetId: outputTarget.id,
    outputUnrelatedId: outputUnrelated.id,
  };
}

async function expectValidatorRejects(
  runId: string,
  tamper: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  let caught: unknown;
  try {
    await prisma.$transaction(async (tx) => {
      await tamper(tx);
      await tx.$queryRaw`SELECT phase40_validate_complete_output_graph(${runId}::uuid)`;
      throw new Error(missingValidatorRejection);
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeTruthy();
  expect(String(caught)).not.toContain(missingValidatorRejection);
}

describe('Phase 40 protected master acceptance gate', () => {
  it('MG-01 persists every citation for a valid multi-citation draft', async () => {
    const fixture = await createGenerationFixture();
    const secondItem = await addSecondEligibleKnowledgeItem(fixture);
    const result = await processGenerationRun(
      fixture.generationRunId,
      prisma,
      multiCitationGateway([fixture.knowledgeItemId, secondItem.id]),
    );
    expect(result?.state).toBe('SUCCEEDED');
    expect(
      await prisma.questionSourceLink.findMany({
        where: { generationRunId: fixture.generationRunId },
        select: { knowledgeItemId: true },
        orderBy: { knowledgeItemId: 'asc' },
      }),
    ).toEqual(
      [fixture.knowledgeItemId, secondItem.id]
        .sort()
        .map((knowledgeItemId) => ({ knowledgeItemId })),
    );
  });

  it('MG-02 rejects an omitted carried-forward citation from an otherwise valid graph', async () => {
    const graph = await createMultiCitationRegeneration();
    const omitted = await prisma.questionSourceLink.findFirstOrThrow({
      where: {
        generationRunId: graph.runId,
        assessmentQuestionId: graph.outputUnrelatedId,
        lineage: 'CARRIED_FORWARD',
      },
    });
    await expectValidatorRejects(graph.runId, async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE question_source_links DISABLE TRIGGER question_source_link_append_only',
      );
      await tx.questionSourceLink.delete({ where: { id: omitted.id } });
    });
  });

  it('MG-03 rejects an omitted generated target citation', async () => {
    const graph = await createMultiCitationRegeneration();
    const omitted = await prisma.questionSourceLink.findFirstOrThrow({
      where: {
        generationRunId: graph.runId,
        assessmentQuestionId: graph.outputTargetId,
        lineage: 'GENERATED',
      },
    });
    await expectValidatorRejects(graph.runId, async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE question_source_links DISABLE TRIGGER question_source_link_append_only',
      );
      await tx.questionSourceLink.delete({ where: { id: omitted.id } });
    });
  });

  it('MG-04 rejects mutation of unrelated finalized question content', async () => {
    const graph = await createMultiCitationRegeneration();
    await expectValidatorRejects(graph.runId, async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE assessment_questions DISABLE TRIGGER finalized_question_immutable',
      );
      await tx.assessmentQuestion.update({
        where: { id: graph.outputUnrelatedId },
        data: { prompt: 'תוכן זר ששינה שאלה שאינה יעד' },
      });
    });
  });

  it('MG-05 rejects an extra empty section in a regeneration output', async () => {
    const graph = await createMultiCitationRegeneration();
    await expectValidatorRejects(graph.runId, async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE assessment_sections DISABLE TRIGGER finalized_section_immutable',
      );
      await tx.assessmentSection.create({
        data: {
          revisionId: graph.outputRevisionId,
          key: `master-extra-${randomUUID()}`,
          title: 'מדור זר',
          instructions: '',
          order: 999,
          scoreUnits: null,
        },
      });
    });
  });

  it('MG-06 resolves equal review timestamps fail-closed', async () => {
    const control = await createGenerationFixture({ review: 'APPROVED' });
    expect((await selectGenerationContext(control.generationRunId, prisma)).length).toBeGreaterThan(
      0,
    );
    const fixture = await createGenerationFixture({ review: null });
    const at = new Date('2030-01-01T00:00:00.000Z');
    await prisma.pedagogicalReview.createMany({
      data: [
        {
          sourceVersionId: fixture.sourceVersionId,
          reviewerUserId: fixture.context.principal.userId,
          decision: 'APPROVED',
          reason: 'master equal timestamp',
          createdAt: at,
        },
        {
          sourceVersionId: fixture.sourceVersionId,
          reviewerUserId: fixture.context.principal.userId,
          decision: 'REJECTED',
          reason: 'master equal timestamp',
          createdAt: at,
        },
      ],
    });
    expect(await selectGenerationContext(fixture.generationRunId, prisma)).toEqual([]);
  });

  it('MG-07 resolves equal permission timestamps fail-closed', async () => {
    const control = await createGenerationFixture({ permission: 'ALLOWED' });
    expect((await selectGenerationContext(control.generationRunId, prisma)).length).toBeGreaterThan(
      0,
    );
    const fixture = await createGenerationFixture({ permission: null });
    const at = new Date('2030-01-01T00:00:00.000Z');
    await prisma.usagePermission.createMany({
      data: [
        {
          sourceVersionId: fixture.sourceVersionId,
          reviewerUserId: fixture.context.principal.userId,
          decision: 'ALLOWED',
          evidenceReference: 'master equal timestamp',
          scope: 'AI_GENERATION',
          createdAt: at,
        },
        {
          sourceVersionId: fixture.sourceVersionId,
          reviewerUserId: fixture.context.principal.userId,
          decision: 'DENIED',
          evidenceReference: 'master equal timestamp',
          scope: 'AI_GENERATION',
          createdAt: at,
        },
      ],
    });
    expect(await selectGenerationContext(fixture.generationRunId, prisma)).toEqual([]);
  });

  it('MG-08 denies a real foreign finalized base and target without writes', async () => {
    const caller = await createGenerationFixture();
    const foreign = await createGenerationFixture();
    const processed = await processGenerationRun(
      foreign.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    const foreignResult = await getGenerationResult(foreign.context, foreign.generationRunId);
    const foreignQuestion = foreignResult?.revision?.sections[0]?.questions[0];
    if (!processed?.outputRevisionId || !foreignQuestion) throw new Error('foreign graph missing');
    const before = await prisma.generationRun.count({
      where: { organizationId: caller.context.organizationId },
    });
    await expect(
      requestQuestionRegeneration(caller.context, {
        version: '1.0.0',
        assessmentId: foreign.assessmentId,
        baseRevisionId: processed.outputRevisionId,
        targetQuestionId: foreignQuestion.id,
        idempotencyKey: `master-foreign-${randomUUID()}`,
        instruction: 'אסור',
        query: 'שלום',
      }),
    ).rejects.toThrow();
    expect(
      await prisma.generationRun.count({
        where: { organizationId: caller.context.organizationId },
      }),
    ).toBe(before);
  });

  it('MG-09 reaches the question/run identity guard before unrelated constraints', async () => {
    const runOwner = await createGenerationFixture();
    const other = await createGenerationFixture();
    await processGenerationRun(
      runOwner.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    await processGenerationRun(other.generationRunId, prisma, new DeterministicFakeModelGateway());
    const context = await prisma.generationContextItem.findFirstOrThrow({
      where: { generationRunId: runOwner.generationRunId },
    });
    const otherResult = await getGenerationResult(other.context, other.generationRunId);
    const foreignQuestion = otherResult?.revision?.sections[0]?.questions[0];
    if (!foreignQuestion) throw new Error('master foreign question missing');
    await expect(
      prisma.questionSourceLink.create({
        data: {
          assessmentQuestionId: foreignQuestion.id,
          generationRunId: runOwner.generationRunId,
          knowledgeItemId: context.knowledgeItemId,
          sourceVersionId: context.sourceVersionId,
          locator: context.locator,
          textHash: context.textHash,
          curriculumVersionId: context.curriculumVersionId,
          curriculumNodeId: context.curriculumNodeId,
          lineage: 'GENERATED',
        },
      }),
    ).rejects.toThrow(/question source assessment identity invalid/i);
  });

  it('MG-13 derives expected citations independently from validated provider output', async () => {
    const fixture = await createGenerationFixture();
    const secondItem = await addSecondEligibleKnowledgeItem(fixture);
    const triggerName = 'phase40_master_suppress_one_actual_citation';
    const functionName = 'phase40_master_suppress_one_actual_citation_fn';
    await prisma.$executeRawUnsafe(
      'ALTER TABLE question_source_links DISABLE TRIGGER question_source_link_append_only',
    );
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.generation_run_id = '${fixture.generationRunId}'::uuid
           AND NEW.knowledge_item_id = '${secondItem.id}'::uuid THEN
          DELETE FROM question_source_links WHERE id = NEW.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      AFTER INSERT ON question_source_links
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    try {
      const result = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        multiCitationGateway([fixture.knowledgeItemId, secondItem.id]),
      );
      expect(result?.state).toBe('FAILED');
      expect(result?.failureCode).toBe('SCHEMA_INVALID');
      expect(result?.outputRevisionId).toBeNull();
      expect(
        await prisma.assessmentRevision.count({
          where: {
            assessmentId: fixture.assessmentId,
            idempotencyKey: `generation:${fixture.generationRunId}`,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.questionSourceLink.count({
          where: { generationRunId: fixture.generationRunId },
        }),
      ).toBe(0);
      const expectedRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM generation_expected_question_citations
        WHERE generation_run_id = ${fixture.generationRunId}::uuid
      `;
      expect(Number(expectedRows[0]?.count ?? -1)).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON question_source_links`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await prisma.$executeRawUnsafe(
        'ALTER TABLE question_source_links ENABLE TRIGGER question_source_link_append_only',
      );
    }
  });

  it('MG-14 closes the expected citation set after a run succeeds', async () => {
    const fixture = await createGenerationFixture();
    const secondItem = await addSecondEligibleKnowledgeItem(fixture);
    const result = await processGenerationRun(
      fixture.generationRunId,
      prisma,
      multiCitationGateway([fixture.knowledgeItemId]),
    );
    const output = await getGenerationResult(fixture.context, fixture.generationRunId);
    const outputQuestion = output?.revision?.sections[0]?.questions[0];
    const curriculumLink = await prisma.knowledgeItemCurriculumNodeLink.findFirstOrThrow({
      where: {
        knowledgeItemId: secondItem.id,
        curriculumVersionId: fixture.curriculumVersionId,
        curriculumNodeId: fixture.curriculumNodeId,
      },
    });
    if (!result?.outputRevisionId || !outputQuestion)
      throw new Error('master successful output missing');

    let caught: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO generation_expected_question_citations (
            generation_run_id, assessment_question_id, knowledge_item_id, source_version_id,
            locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id
          ) VALUES (
            ${fixture.generationRunId}::uuid, ${outputQuestion.id}::uuid, ${secondItem.id}::uuid,
            ${secondItem.sourceVersionId}::uuid, ${secondItem.locator}, ${secondItem.textHash},
            ${curriculumLink.curriculumVersionId}::uuid, ${curriculumLink.curriculumNodeId}::uuid,
            'GENERATED', NULL
          )
        `;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        throw new Error(missingValidatorRejection);
      });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain('generation expected citation set is closed');
    expect(String(caught)).not.toContain(missingValidatorRejection);
  });
});

afterAll(() => prisma.$disconnect());
