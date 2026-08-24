import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import {
  draftGenerationRequestSchema,
  frozenGenerationSpecificationSchema,
  generatedDraftOutputSchema,
  generatedQuestionOutputSchema,
  generationContextItemSchema,
  generationContextProvenanceSchema,
  generationFailureCodeSchema,
  generationResultSchema,
  generationStatusSchema,
  questionRegenerationRequestSchema,
  assessmentRevisionSchema,
} from '@teach/contracts';
import {
  GatewayFailure,
  getGenerationModelConfiguration,
  getGenerationPromptTemplate,
  type ModelGateway,
  DeterministicFakeModelGateway,
} from '@teach/ai';
import { AccessDeniedError, authorizeWorkspace, type AccessContext } from '@teach/domain';
import {
  IdempotencyConflictError,
  mapFinalizedAssessmentRevision,
  prisma,
  resolveAccessContext,
} from './index.js';

const RESPONSE_SCHEMA_HASH = createHash('sha256')
  .update('generated-draft-output.v1|generated-question-output.v1')
  .digest('hex');
const MAX_ATTEMPTS = 3;
const MIN_CONTEXT_ITEMS = 1;

type GenerationTx = Prisma.TransactionClient;
type ContextRow = {
  knowledgeItemId: string;
  sourceVersionId: string;
  locator: string;
  textHash: string;
  curriculumVersionId: string;
  curriculumNodeId: string;
  rank: number;
  score: number;
  text: string;
};

function trustedContext(context: AccessContext, client: PrismaClient): Promise<AccessContext> {
  return resolveAccessContext(context.principal, context.organizationId, client).then(
    (resolved) => {
      authorizeWorkspace(resolved, resolved.organizationId, 'CREATE_ASSESSMENT_REVISION');
      return resolved;
    },
  );
}

function mapRun(run: {
  id: string;
  assessmentId: string;
  operation: 'DRAFT' | 'REGENERATE_QUESTION';
  state: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'INSUFFICIENT_CONTEXT' | 'FAILED';
  attempts: number;
  failureCode: string | null;
  outputRevisionId: string | null;
}) {
  return generationStatusSchema.parse({
    version: '1.0.0',
    id: run.id,
    assessmentId: run.assessmentId,
    operation: run.operation,
    state: run.state,
    attempts: run.attempts,
    failureCode: run.failureCode ? generationFailureCodeSchema.parse(run.failureCode) : null,
    outputRevisionId: run.outputRevisionId,
  });
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function specificationForDraft(
  parsed: ReturnType<typeof draftGenerationRequestSchema.parse>,
  assessment: { id: string; type: 'WORKSHEET' | 'TEST'; title: string },
) {
  return frozenGenerationSpecificationSchema.parse({
    version: '1.0.0',
    operation: 'DRAFT',
    assessmentId: assessment.id,
    curriculumVersionId: parsed.curriculumVersionId,
    curriculumNodeIds: parsed.curriculumNodeIds,
    assessmentType: assessment.type,
    assessmentTitle: assessment.title,
    scoringMode: parsed.scoringMode,
    totalScoreUnits: parsed.totalScoreUnits,
    query: parsed.query,
    instructions: parsed.instructions,
    sections: parsed.sections,
    baseRevisionId: null,
    targetQuestionId: null,
    regenerationInstruction: '',
  });
}

function planFromRevision(revision: any) {
  return revision.sections.map((section: any) => ({
    key: section.key,
    title: section.title,
    order: section.order,
    instructions: section.instructions ?? '',
    scoreUnits: section.scoreUnits,
    questions: section.questions.map((question: any) => ({
      key: question.key,
      order: question.order,
      type: question.type,
      difficulty: question.difficulty ?? 'MEDIUM',
      scoreUnits: question.scoreUnits,
      instructions: question.instructions ?? '',
      emphasis: '',
    })),
  }));
}

function specificationForRegeneration(parsed: any, assessment: any, revision: any) {
  return frozenGenerationSpecificationSchema.parse({
    version: '1.0.0',
    operation: 'REGENERATE_QUESTION',
    assessmentId: assessment.id,
    curriculumVersionId: revision.curriculumVersionId,
    curriculumNodeIds: revision.nodeLinks.map((link: any) => link.curriculumNodeId),
    assessmentType: assessment.type,
    assessmentTitle: assessment.title,
    scoringMode: revision.scoringMode,
    totalScoreUnits: revision.totalScoreUnits,
    query: parsed.query,
    instructions: '',
    sections: planFromRevision(revision),
    baseRevisionId: revision.id,
    targetQuestionId: parsed.targetQuestionId,
    regenerationInstruction: parsed.instruction,
  });
}

async function createRun(
  context: AccessContext,
  specification: any,
  idempotencyKey: string,
  client: PrismaClient,
) {
  const prompt = getGenerationPromptTemplate(specification.operation);
  const model = getGenerationModelConfiguration();
  const requestFingerprint = fingerprint({ specification, idempotencyKey });
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${specification.assessmentId}::uuid FOR UPDATE`;
    const existing = await tx.generationRun.findUnique({
      where: {
        organizationId_assessmentId_idempotencyKey: {
          organizationId: context.organizationId,
          assessmentId: specification.assessmentId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError();
      return mapRun(existing);
    }
    const run = await tx.generationRun.create({
      data: {
        organizationId: context.organizationId,
        requestingUserId: context.principal.userId,
        assessmentId: specification.assessmentId,
        operation: specification.operation,
        idempotencyKey,
        requestFingerprint,
        frozenSpecification: specification,
        curriculumVersionId: specification.curriculumVersionId,
        baseRevisionId: specification.baseRevisionId,
        targetQuestionId: specification.targetQuestionId,
        promptTemplateVersion: prompt.version,
        promptTemplateHash: prompt.hash,
        modelConfigurationVersion: model.version,
        modelConfigurationHash: model.hash,
        responseSchemaVersion: '1.0.0',
        responseSchemaHash: RESPONSE_SCHEMA_HASH,
      },
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType: 'generation.requested',
        payload: { generationRunId: run.id },
        idempotencyKey: `generation:${run.id}`,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: context.principal.userId,
        organizationId: context.organizationId,
        eventType: 'generation.requested',
        targetType: 'generation_run',
        targetId: run.id,
        metadata: { operation: run.operation, curriculumVersionId: run.curriculumVersionId },
      },
    });
    return mapRun(run);
  });
}

export async function requestDraftGeneration(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = draftGenerationRequestSchema.parse(input);
  const trusted = await trustedContext(context, client);
  const assessment = await client.assessment.findFirst({
    where: { id: parsed.assessmentId, organizationId: trusted.organizationId },
  });
  if (!assessment) throw new AccessDeniedError();
  const curriculum = await client.curriculumVersion.findFirst({
    where: { id: parsed.curriculumVersionId, status: 'PUBLISHED' },
  });
  if (!curriculum) throw new Error('Curriculum version is unavailable');
  const nodes = await client.curriculumNode.findMany({
    where: { id: { in: parsed.curriculumNodeIds }, versionId: curriculum.id },
    select: { id: true },
  });
  if (nodes.length !== parsed.curriculumNodeIds.length)
    throw new Error('Curriculum nodes are unavailable');
  return createRun(
    trusted,
    specificationForDraft(parsed, assessment),
    parsed.idempotencyKey,
    client,
  );
}

export async function requestQuestionRegeneration(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = questionRegenerationRequestSchema.parse(input);
  const trusted = await trustedContext(context, client);
  const revision = await client.assessmentRevision.findFirst({
    where: {
      id: parsed.baseRevisionId,
      assessmentId: parsed.assessmentId,
      state: 'FINALIZED',
      assessment: { organizationId: trusted.organizationId },
    },
    include: {
      nodeLinks: true,
      sections: {
        orderBy: { order: 'asc' },
        include: {
          questions: {
            orderBy: { order: 'asc' },
            include: {
              answers: true,
              rubrics: true,
              subQuestions: { include: { answers: true, rubrics: true } },
            },
          },
        },
      },
    },
  });
  if (
    !revision ||
    !revision.sections.some((section) =>
      section.questions.some((q) => q.id === parsed.targetQuestionId),
    )
  )
    throw new AccessDeniedError();
  const assessment = await client.assessment.findUniqueOrThrow({
    where: { id: parsed.assessmentId },
  });
  return createRun(
    trusted,
    specificationForRegeneration(parsed, assessment, revision),
    parsed.idempotencyKey,
    client,
  );
}

export async function getGenerationStatus(
  context: AccessContext,
  runId: string,
  client: PrismaClient = prisma,
) {
  let trusted: AccessContext;
  try {
    trusted = await trustedContext(context, client);
  } catch {
    return null;
  }
  const run = await client.generationRun.findFirst({
    where: { id: runId, organizationId: trusted.organizationId },
  });
  return run ? mapRun(run) : null;
}

export async function getGenerationResult(
  accessContext: AccessContext,
  runId: string,
  client: PrismaClient = prisma,
) {
  const status = await getGenerationStatus(accessContext, runId, client);
  if (!status) return null;
  const run = await client.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      contextItems: { orderBy: { selectedOrder: 'asc' }, include: { knowledgeItem: true } },
      outputRevision: {
        include: {
          nodeLinks: true,
          sections: {
            orderBy: { order: 'asc' },
            include: {
              questions: {
                orderBy: { order: 'asc' },
                include: {
                  answers: { orderBy: { order: 'asc' } },
                  rubrics: { orderBy: { order: 'asc' } },
                  subQuestions: {
                    orderBy: { order: 'asc' },
                    include: {
                      answers: { orderBy: { order: 'asc' } },
                      rubrics: { orderBy: { order: 'asc' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const contextItems = run.contextItems.map((item) =>
    generationContextProvenanceSchema.parse({
      knowledgeItemId: item.knowledgeItemId,
      sourceVersionId: item.sourceVersionId,
      locator: item.locator,
      textHash: item.textHash,
      curriculumVersionId: item.curriculumVersionId,
      curriculumNodeId: item.curriculumNodeId,
      rank: item.rank,
      score: item.score,
      characterCount: item.characterCount,
      estimatedTokens: item.estimatedTokens,
    }),
  );
  return generationResultSchema.parse({
    version: '1.0.0',
    status,
    context: contextItems,
    revision: run.outputRevision ? mapFinalizedAssessmentRevision(run.outputRevision) : null,
  });
}

export async function selectGenerationContext(
  runId: string,
  client: PrismaClient = prisma,
): Promise<ReturnType<typeof generationContextItemSchema.parse>[]> {
  const run = await client.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const specification = frozenGenerationSpecificationSchema.parse(run.frozenSpecification);
  const rows = await client.$queryRaw<ContextRow[]>`
    SELECT ki.id AS "knowledgeItemId", sv.id AS "sourceVersionId", ki.locator, ki.text_hash AS "textHash",
           link.curriculum_version_id AS "curriculumVersionId", link.curriculum_node_id AS "curriculumNodeId",
           ROW_NUMBER() OVER (ORDER BY ts_rank(ki.search_vector, plainto_tsquery('simple', ${specification.query})) DESC, ki.id ASC, link.curriculum_version_id ASC, link.curriculum_node_id ASC)::int AS rank,
           ts_rank(ki.search_vector, plainto_tsquery('simple', ${specification.query}))::float8 AS score,
           ki.normalized_text AS text
      FROM knowledge_items ki
      JOIN knowledge_item_curriculum_node_links link ON link.knowledge_item_id = ki.id
      JOIN source_versions sv ON sv.id = ki.source_version_id
      JOIN knowledge_sources ks ON ks.id = sv.source_id
      JOIN LATERAL (SELECT to_status FROM source_lifecycle_events WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) lifecycle ON true
      JOIN LATERAL (SELECT decision FROM pedagogical_reviews WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) review ON true
      JOIN LATERAL (SELECT decision, valid_until FROM usage_permissions WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) permission ON true
      JOIN curriculum_versions cv ON cv.id = link.curriculum_version_id
     WHERE ki.status = 'ACTIVE' AND lifecycle.to_status = 'ACTIVE' AND review.decision = 'APPROVED'
       AND permission.decision = 'ALLOWED' AND (permission.valid_until IS NULL OR permission.valid_until > NOW())
       AND cv.status = 'PUBLISHED' AND link.curriculum_version_id = ${specification.curriculumVersionId}::uuid
       AND link.curriculum_node_id = ANY(${specification.curriculumNodeIds}::uuid[])
       AND (ks.visibility = 'PLATFORM_SHARED' OR ks.organization_id = ${run.organizationId}::uuid)
       AND ki.search_vector @@ plainto_tsquery('simple', ${specification.query})
     ORDER BY score DESC, ki.id ASC, link.curriculum_version_id ASC, link.curriculum_node_id ASC
     LIMIT 100`;
  const byItem = new Map<string, ContextRow>();
  for (const row of rows)
    if (!byItem.has(row.knowledgeItemId)) byItem.set(row.knowledgeItemId, row);
  return [...byItem.values()]
    .slice(0, getGenerationModelConfiguration().maxContextItems)
    .map((row, index) =>
      generationContextItemSchema.parse({
        ...row,
        rank: index + 1,
        characterCount: row.text.length,
        estimatedTokens: Math.max(1, Math.ceil(row.text.length / 4)),
      }),
    );
}

async function contextStillEligible(
  runId: string,
  items: Array<{ knowledgeItemId: string }>,
  client: PrismaClient,
) {
  if (!items.length) return false;
  const run = await client.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const specification = frozenGenerationSpecificationSchema.parse(run.frozenSpecification);
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT ki.id FROM knowledge_items ki
    JOIN source_versions sv ON sv.id = ki.source_version_id
    JOIN knowledge_sources ks ON ks.id = sv.source_id
    JOIN LATERAL (SELECT to_status FROM source_lifecycle_events WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) lifecycle ON true
    JOIN LATERAL (SELECT decision FROM pedagogical_reviews WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) review ON true
    JOIN LATERAL (SELECT decision, valid_until FROM usage_permissions WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) permission ON true
    WHERE ki.id = ANY(${items.map((item) => item.knowledgeItemId)}::uuid[])
      AND ki.status = 'ACTIVE' AND lifecycle.to_status = 'ACTIVE' AND review.decision = 'APPROVED'
      AND permission.decision = 'ALLOWED' AND (permission.valid_until IS NULL OR permission.valid_until > NOW())
      AND (ks.visibility = 'PLATFORM_SHARED' OR ks.organization_id = ${run.organizationId}::uuid)
      AND sv.id IN (SELECT source_version_id FROM knowledge_item_curriculum_node_links WHERE curriculum_version_id = ${specification.curriculumVersionId}::uuid AND curriculum_node_id = ANY(${specification.curriculumNodeIds}::uuid[]))`;
  return (
    new Set(rows.map((row) => row.id)).size ===
    new Set(items.map((item) => item.knowledgeItemId)).size
  );
}

function contentToQuestion(plan: any, content: any) {
  return {
    key: plan.key,
    type: plan.type,
    prompt: content.prompt,
    ...(content.instructions ? { instructions: content.instructions } : {}),
    order: plan.order,
    difficulty: plan.difficulty,
    scoreUnits: plan.scoreUnits,
    subQuestions: content.subQuestions,
    answers: content.answers,
    rubrics: content.rubrics,
  };
}

function buildDraftRevisionInput(run: any, output: any) {
  const specification = frozenGenerationSpecificationSchema.parse(run.frozenSpecification);
  return assessmentRevisionSchema.parse({
    version: '1.0.0',
    assessmentId: run.assessmentId,
    idempotencyKey: `generation:${run.id}`,
    curriculumVersionId: specification.curriculumVersionId,
    scoringMode: specification.scoringMode,
    totalScoreUnits: specification.totalScoreUnits,
    curriculumNodeIds: specification.curriculumNodeIds,
    sections: specification.sections.map((section: any) => {
      const returned = output.sections.find((item: any) => item.key === section.key)!;
      return {
        key: section.key,
        title: section.title,
        instructions: section.instructions,
        order: section.order,
        scoreUnits: section.scoreUnits,
        questions: section.questions.map((plan: any) => {
          const question = returned.questions.find((item: any) => item.key === plan.key)!;
          return contentToQuestion(plan, question.content);
        }),
      };
    }),
  });
}

function assertDraftShape(run: any, output: any, selected: Set<string>): void {
  const spec = frozenGenerationSpecificationSchema.parse(run.frozenSpecification);
  if (output.sections.length !== spec.sections.length) throw new Error('OUTPUT_INVALID');
  for (const section of spec.sections) {
    const got = output.sections.find((item: any) => item.key === section.key);
    if (!got || got.order !== section.order || got.questions.length !== section.questions.length)
      throw new Error('OUTPUT_INVALID');
    for (const plan of section.questions) {
      const question = got.questions.find((item: any) => item.key === plan.key);
      if (
        !question ||
        question.order !== plan.order ||
        question.type !== plan.type ||
        question.difficulty !== plan.difficulty ||
        question.scoreUnits !== plan.scoreUnits ||
        question.citations.some((id: string) => !selected.has(id))
      )
        throw new Error('OUTPUT_INVALID');
    }
  }
}

async function persistRevision(
  tx: GenerationTx,
  run: any,
  parsed: any,
  linksByQuestion: Map<string, string[]>,
) {
  const assessment = await tx.assessment.findUniqueOrThrow({ where: { id: run.assessmentId } });
  const locked = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM assessments WHERE id = ${assessment.id}::uuid FOR UPDATE`;
  if (!locked[0]) throw new AccessDeniedError();
  const revisionNumber =
    (await tx.assessmentRevision.count({ where: { assessmentId: assessment.id } })) + 1;
  const revision = await tx.assessmentRevision.create({
    data: {
      assessmentId: assessment.id,
      revisionNumber,
      idempotencyKey: `generation:${run.id}`,
      requestFingerprint: fingerprint(run.frozenSpecification),
      curriculumVersionId: run.curriculumVersionId,
      scoringMode: parsed.scoringMode,
      totalScoreUnits: parsed.totalScoreUnits,
      state: 'BUILDING',
    },
  });
  await tx.assessmentRevisionNodeLink.createMany({
    data: parsed.curriculumNodeIds.map((curriculumNodeId: string) => ({
      revisionId: revision.id,
      curriculumNodeId,
    })),
  });
  for (const section of parsed.sections) {
    const savedSection = await tx.assessmentSection.create({
      data: {
        revisionId: revision.id,
        key: section.key,
        title: section.title,
        instructions: section.instructions || null,
        order: section.order,
        scoreUnits: section.scoreUnits,
      },
    });
    for (const question of section.questions) {
      const savedQuestion = await tx.assessmentQuestion.create({
        data: {
          sectionId: savedSection.id,
          key: question.key,
          type: question.type,
          prompt: question.prompt,
          instructions: question.instructions || null,
          difficulty: question.difficulty,
          order: question.order,
          scoreUnits: question.scoreUnits,
        },
      });
      for (const answer of question.answers)
        await tx.answer.create({
          data: {
            questionId: savedQuestion.id,
            answerData: JSON.parse(JSON.stringify(answer.data ?? {})) as Prisma.InputJsonValue,
            key: answer.key,
            order: answer.order,
            text: answer.text,
            explanation: answer.explanation ?? null,
          },
        });
      for (const rubric of question.rubrics)
        await tx.rubricCriterion.create({
          data: {
            questionId: savedQuestion.id,
            key: rubric.key,
            description: rubric.description,
            order: rubric.order,
            scoreUnits: rubric.scoreUnits,
          },
        });
      for (const sub of question.subQuestions) {
        const savedSub = await tx.assessmentSubQuestion.create({
          data: {
            questionId: savedQuestion.id,
            key: sub.key,
            prompt: sub.prompt,
            order: sub.order,
            scoreUnits: sub.scoreUnits,
          },
        });
        for (const answer of sub.answers)
          await tx.answer.create({
            data: {
              subQuestionId: savedSub.id,
              answerData: JSON.parse(JSON.stringify(answer.data ?? {})) as Prisma.InputJsonValue,
              key: answer.key,
              order: answer.order,
              text: answer.text,
              explanation: answer.explanation ?? null,
            },
          });
        for (const rubric of sub.rubrics)
          await tx.rubricCriterion.create({
            data: {
              subQuestionId: savedSub.id,
              key: rubric.key,
              description: rubric.description,
              order: rubric.order,
              scoreUnits: rubric.scoreUnits,
            },
          });
      }
      for (const itemId of linksByQuestion.get(question.key) ?? []) {
        const item = await tx.knowledgeItem.findUniqueOrThrow({
          where: { id: itemId },
          include: { sourceVersion: true, curriculumLinks: true },
        });
        const lineage =
          item.curriculumLinks.find(
            (link) => link.curriculumVersionId === run.curriculumVersionId,
          ) ?? item.curriculumLinks[0];
        if (!lineage) throw new Error('OUTPUT_INVALID');
        await tx.questionSourceLink.create({
          data: {
            assessmentQuestionId: savedQuestion.id,
            generationRunId: run.id,
            knowledgeItemId: item.id,
            sourceVersionId: item.sourceVersionId,
            locator: item.locator,
            textHash: item.textHash,
            curriculumVersionId: lineage.curriculumVersionId,
            curriculumNodeId: lineage.curriculumNodeId,
            lineage: 'GENERATED',
          },
        });
      }
    }
  }
  await tx.assessmentRevision.update({ where: { id: revision.id }, data: { state: 'FINALIZED' } });
  return revision.id;
}

async function persistRegeneratedRevision(
  tx: GenerationTx,
  run: any,
  output: any,
  selectedIds: Set<string>,
) {
  const assessment = await tx.assessment.findUniqueOrThrow({ where: { id: run.assessmentId } });
  await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${assessment.id}::uuid FOR UPDATE`;
  const base = await tx.assessmentRevision.findFirstOrThrow({
    where: { id: run.baseRevisionId, assessmentId: assessment.id, state: 'FINALIZED' },
    include: {
      nodeLinks: true,
      sections: {
        orderBy: { order: 'asc' },
        include: {
          questions: {
            orderBy: { order: 'asc' },
            include: {
              answers: { orderBy: { order: 'asc' } },
              rubrics: { orderBy: { order: 'asc' } },
              subQuestions: {
                orderBy: { order: 'asc' },
                include: {
                  answers: { orderBy: { order: 'asc' } },
                  rubrics: { orderBy: { order: 'asc' } },
                },
              },
            },
          },
        },
      },
    },
  });
  const target = base.sections
    .flatMap((section: any) => section.questions)
    .find((question: any) => question.id === run.targetQuestionId);
  if (!target) throw new AccessDeniedError();
  const revisionNumber =
    (await tx.assessmentRevision.count({ where: { assessmentId: assessment.id } })) + 1;
  const revision = await tx.assessmentRevision.create({
    data: {
      assessmentId: assessment.id,
      revisionNumber,
      idempotencyKey: `generation:${run.id}`,
      requestFingerprint: fingerprint(run.frozenSpecification),
      curriculumVersionId: base.curriculumVersionId,
      scoringMode: base.scoringMode,
      totalScoreUnits: base.totalScoreUnits,
      state: 'BUILDING',
    },
  });
  await tx.assessmentRevisionNodeLink.createMany({
    data: base.nodeLinks.map((link: any) => ({
      revisionId: revision.id,
      curriculumNodeId: link.curriculumNodeId,
    })),
  });
  const oldLinks = await tx.questionSourceLink.findMany({
    where: {
      assessmentQuestionId: {
        in: base.sections.flatMap((section: any) =>
          section.questions.map((question: any) => question.id),
        ),
      },
    },
  });
  const newQuestionIds = new Map<string, string>();
  for (const section of base.sections) {
    const savedSection = await tx.assessmentSection.create({
      data: {
        revisionId: revision.id,
        key: section.key,
        title: section.title,
        instructions: section.instructions,
        order: section.order,
        scoreUnits: section.scoreUnits,
      },
    });
    for (const question of section.questions) {
      const replacement = question.id === target.id ? output.content : null;
      const savedQuestion = await tx.assessmentQuestion.create({
        data: {
          sectionId: savedSection.id,
          key: question.key,
          type: question.type,
          prompt: replacement?.prompt ?? question.prompt,
          instructions: replacement?.instructions ?? question.instructions,
          difficulty: question.difficulty,
          order: question.order,
          scoreUnits: question.scoreUnits,
        },
      });
      newQuestionIds.set(question.id, savedQuestion.id);
      const answers = replacement?.answers ?? question.answers;
      const rubrics = replacement?.rubrics ?? question.rubrics;
      const subQuestions = replacement?.subQuestions ?? question.subQuestions;
      for (const answer of answers)
        await tx.answer.create({
          data: {
            questionId: savedQuestion.id,
            answerData: JSON.parse(
              JSON.stringify(answer.answerData ?? answer.data ?? {}),
            ) as Prisma.InputJsonValue,
            key: answer.key,
            order: answer.order,
            text: answer.text,
            explanation: answer.explanation ?? null,
          },
        });
      for (const rubric of rubrics)
        await tx.rubricCriterion.create({
          data: {
            questionId: savedQuestion.id,
            key: rubric.key,
            description: rubric.description,
            order: rubric.order,
            scoreUnits: rubric.scoreUnits,
          },
        });
      for (const sub of subQuestions) {
        const savedSub = await tx.assessmentSubQuestion.create({
          data: {
            questionId: savedQuestion.id,
            key: sub.key,
            prompt: sub.prompt,
            order: sub.order,
            scoreUnits: sub.scoreUnits,
          },
        });
        for (const answer of sub.answers)
          await tx.answer.create({
            data: {
              subQuestionId: savedSub.id,
              answerData: JSON.parse(
                JSON.stringify(answer.answerData ?? answer.data ?? {}),
              ) as Prisma.InputJsonValue,
              key: answer.key,
              order: answer.order,
              text: answer.text,
              explanation: answer.explanation ?? null,
            },
          });
        for (const rubric of sub.rubrics)
          await tx.rubricCriterion.create({
            data: {
              subQuestionId: savedSub.id,
              key: rubric.key,
              description: rubric.description,
              order: rubric.order,
              scoreUnits: rubric.scoreUnits,
            },
          });
      }
    }
  }
  for (const link of oldLinks) {
    if (link.assessmentQuestionId === target.id) continue;
    const newQuestionId = newQuestionIds.get(link.assessmentQuestionId);
    if (!newQuestionId) throw new Error('OUTPUT_INVALID');
    await tx.questionSourceLink.create({
      data: {
        assessmentQuestionId: newQuestionId,
        generationRunId: run.id,
        knowledgeItemId: link.knowledgeItemId,
        sourceVersionId: link.sourceVersionId,
        locator: link.locator,
        textHash: link.textHash,
        curriculumVersionId: link.curriculumVersionId,
        curriculumNodeId: link.curriculumNodeId,
        lineage: 'CARRIED_FORWARD',
      },
    });
  }
  for (const itemId of output.citations) {
    if (!selectedIds.has(itemId)) throw new Error('OUTPUT_INVALID');
    const item = await tx.knowledgeItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { curriculumLinks: true },
    });
    const lineage = item.curriculumLinks.find(
      (link: any) => link.curriculumVersionId === run.curriculumVersionId,
    );
    if (!lineage) throw new Error('OUTPUT_INVALID');
    await tx.questionSourceLink.create({
      data: {
        assessmentQuestionId: newQuestionIds.get(target.id)!,
        generationRunId: run.id,
        knowledgeItemId: item.id,
        sourceVersionId: item.sourceVersionId,
        locator: item.locator,
        textHash: item.textHash,
        curriculumVersionId: lineage.curriculumVersionId,
        curriculumNodeId: lineage.curriculumNodeId,
        lineage: 'GENERATED',
        priorQuestionId: target.id,
      },
    });
  }
  await tx.assessmentRevision.update({ where: { id: revision.id }, data: { state: 'FINALIZED' } });
  return revision.id;
}

function safeCode(error: unknown): string {
  if (error instanceof GatewayFailure)
    return error.code === 'TRANSIENT' ? 'TRANSIENT_EXHAUSTED' : error.code;
  if (!(error instanceof Error)) return 'SCHEMA_INVALID';
  if (error.message === 'OUTPUT_INVALID') return 'OUTPUT_INVALID';
  if (error.message === 'CONTEXT_INVALIDATED') return 'CONTEXT_INVALIDATED';
  if (error.message === 'BUDGET_EXCEEDED') return 'BUDGET_EXCEEDED';
  return 'SCHEMA_INVALID';
}

export async function processGenerationRun(
  runId: string,
  client: PrismaClient = prisma,
  gateway: ModelGateway = new DeterministicFakeModelGateway(),
) {
  const locked = await client.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM generation_runs WHERE id = ${runId}::uuid FOR UPDATE
    `;
    if (!lockedRows[0]) return null;
    const run = await tx.generationRun.findUnique({ where: { id: runId } });
    if (!run || ['SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED'].includes(run.state)) return run;
    if (run.state !== 'PENDING') return null;
    return tx.generationRun.update({
      where: { id: runId },
      data: { state: 'PROCESSING', attempts: { increment: 1 } },
    });
  });
  if (!locked) return locked ? mapRun(locked) : null;
  if (['SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED'].includes(locked.state)) return mapRun(locked);
  const selected = await selectGenerationContext(runId, client);
  const totalChars = selected.reduce((sum, item) => sum + item.characterCount, 0);
  const totalTokens = selected.reduce((sum, item) => sum + item.estimatedTokens, 0);
  if (
    selected.length < MIN_CONTEXT_ITEMS ||
    totalChars > getGenerationModelConfiguration().maxContextChars ||
    totalTokens > getGenerationModelConfiguration().maxContextTokens
  ) {
    const failed = await client.generationRun.update({
      where: { id: runId },
      data: {
        state: 'INSUFFICIENT_CONTEXT',
        failureCode: 'CONTEXT_EMPTY',
        processedAt: new Date(),
      },
    });
    return mapRun(failed);
  }
  await client.generationContextItem.createMany({
    data: selected.map((item) => ({
      generationRunId: runId,
      selectedOrder: item.rank - 1,
      knowledgeItemId: item.knowledgeItemId,
      sourceVersionId: item.sourceVersionId,
      locator: item.locator,
      textHash: item.textHash,
      curriculumVersionId: item.curriculumVersionId,
      curriculumNodeId: item.curriculumNodeId,
      rank: item.rank,
      score: item.score,
      characterCount: item.characterCount,
      estimatedTokens: item.estimatedTokens,
    })),
  });
  let attempt = locked.attempts;
  const run = await client.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const specification = frozenGenerationSpecificationSchema.parse(run.frozenSpecification);
  const prompt = getGenerationPromptTemplate(specification.operation);
  const model = getGenerationModelConfiguration();
  while (attempt <= MAX_ATTEMPTS) {
    const operationId = `${runId}:${attempt}`;
    try {
      const response = await gateway.execute({
        operationId,
        idempotencyKey: operationId,
        operation: specification.operation,
        promptTemplateVersion: prompt.version,
        promptTemplateHash: prompt.hash,
        modelConfigurationVersion: model.version,
        modelConfigurationHash: model.hash,
        responseSchemaVersion: '1.0.0',
        responseSchemaHash: RESPONSE_SCHEMA_HASH,
        input: { specification, context: selected },
      });
      await client.generationUsage.create({
        data: {
          generationRunId: runId,
          attempt,
          provider: response.provider,
          model: response.model,
          requestId: response.requestId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
          costMicros: response.usage.costMicros,
          finishReason: response.finishReason,
        },
      });
      if (
        response.usage.totalTokens > model.maxOutputTokens ||
        response.usage.costMicros > model.maxCostMicros
      )
        throw new Error('BUDGET_EXCEEDED');
      const selectedIds = new Set(selected.map((item) => item.knowledgeItemId));
      let revisionId: string;
      let linksByQuestion = new Map<string, string[]>();
      if (specification.operation === 'DRAFT') {
        const output = generatedDraftOutputSchema.parse(response.output);
        assertDraftShape(run, output, selectedIds);
        linksByQuestion = new Map(
          output.sections.flatMap((section) =>
            section.questions.map((question) => [question.key, question.citations] as const),
          ),
        );
        const revisionInput = buildDraftRevisionInput(run, output);
        if (!(await contextStillEligible(runId, selected, client)))
          throw new Error('CONTEXT_INVALIDATED');
        revisionId = await client.$transaction(async (tx) =>
          persistRevision(tx, run, revisionInput, linksByQuestion),
        );
      } else {
        const output = generatedQuestionOutputSchema.parse(response.output);
        if (output.citations.some((id) => !selectedIds.has(id))) throw new Error('OUTPUT_INVALID');
        if (!(await contextStillEligible(runId, selected, client)))
          throw new Error('CONTEXT_INVALIDATED');
        revisionId = await client.$transaction(async (tx) =>
          persistRegeneratedRevision(tx, run, output, selectedIds),
        );
      }
      const succeeded = await client.generationRun.update({
        where: { id: runId },
        data: {
          state: 'SUCCEEDED',
          outputRevisionId: revisionId,
          provider: response.provider,
          model: response.model,
          processedAt: new Date(),
        },
      });
      await client.auditEvent.create({
        data: {
          actorUserId: run.requestingUserId,
          organizationId: run.organizationId,
          eventType: 'generation.succeeded',
          targetType: 'generation_run',
          targetId: runId,
          metadata: { attempt, outputRevisionId: revisionId, contextCount: selected.length },
        },
      });
      return mapRun(succeeded);
    } catch (error) {
      const code = safeCode(error);
      if (
        (code === 'TIMEOUT' || code === 'RATE_LIMITED' || code === 'TRANSIENT_EXHAUSTED') &&
        attempt < MAX_ATTEMPTS
      ) {
        attempt += 1;
        await client.generationRun.update({
          where: { id: runId },
          data: { state: 'PENDING', attempts: attempt },
        });
        await client.$transaction(async (tx) =>
          tx.generationRun.update({ where: { id: runId }, data: { state: 'PROCESSING' } }),
        );
        continue;
      }
      const terminal = await client.generationRun.update({
        where: { id: runId },
        data: {
          state: code === 'CONTEXT_INVALIDATED' ? 'INSUFFICIENT_CONTEXT' : 'FAILED',
          failureCode: code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : code,
          processedAt: new Date(),
        },
      });
      return mapRun(terminal);
    }
  }
  throw new Error('Generation retry exhausted');
}
