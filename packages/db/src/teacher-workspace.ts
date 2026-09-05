import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { editorSaveRequestSchema, editorSaveResultSchema } from '@teach/contracts';
import {
  authorizeWorkspace,
  EditorSnapshotError,
  prepareEditedSnapshot,
  type AccessContext,
} from '@teach/domain';
import { prisma } from './index.js';

export class EditorSaveError extends Error {
  constructor(
    public readonly code:
      | 'RESOURCE_UNAVAILABLE'
      | 'STALE_BASE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'CURRICULUM_UNAVAILABLE'
      | 'INVALID_EDITOR_SNAPSHOT',
  ) {
    super(code);
    this.name = 'EditorSaveError';
  }
}

const includeGraph = {
  nodeLinks: true,
  sections: {
    orderBy: { order: 'asc' as const },
    include: {
      questions: {
        orderBy: { order: 'asc' as const },
        include: {
          answers: { orderBy: { order: 'asc' as const } },
          rubrics: { orderBy: { order: 'asc' as const } },
          subQuestions: {
            orderBy: { order: 'asc' as const },
            include: {
              answers: { orderBy: { order: 'asc' as const } },
              rubrics: { orderBy: { order: 'asc' as const } },
            },
          },
          questionSourceLinks: true,
        },
      },
    },
  },
} as const;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function saveEditedRevision(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  authorizeWorkspace(context, context.organizationId, 'CREATE_ASSESSMENT_REVISION');
  const parsed = editorSaveRequestSchema.parse(input);
  const storageKey = sha256(
    `phase60-editor\0${context.organizationId}\0${context.principal.userId}\0${parsed.idempotencyKey}`,
  );
  const requestFingerprint = sha256(JSON.stringify(parsed));

  const execute = () =>
    client.$transaction(
      async (tx) => {
        const assessment = await tx.assessment.findFirst({
          where: { id: parsed.assessmentId, organizationId: context.organizationId },
        });
        if (!assessment) throw new EditorSaveError('RESOURCE_UNAVAILABLE');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${assessment.id}::text, 60))`;

        const existing = await tx.assessmentRevision.findUnique({
          where: {
            assessmentId_idempotencyKey: {
              assessmentId: assessment.id,
              idempotencyKey: storageKey,
            },
          },
        });
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint)
            throw new EditorSaveError('IDEMPOTENCY_CONFLICT');
          if (existing.state !== 'FINALIZED' || existing.baseRevisionId !== parsed.baseRevisionId)
            throw new EditorSaveError('IDEMPOTENCY_CONFLICT');
          return editorSaveResultSchema.parse({
            version: '1.0.0',
            assessmentId: assessment.id,
            revisionId: existing.id,
            revisionNumber: existing.revisionNumber,
            baseRevisionId: existing.baseRevisionId,
          });
        }

        const base = await tx.assessmentRevision.findFirst({
          where: {
            id: parsed.baseRevisionId,
            revisionNumber: parsed.baseRevisionNumber,
            assessmentId: assessment.id,
            state: 'FINALIZED',
          },
          include: includeGraph,
        });
        if (!base) throw new EditorSaveError('RESOURCE_UNAVAILABLE');
        const latest = await tx.assessmentRevision.findFirst({
          where: { assessmentId: assessment.id, state: 'FINALIZED' },
          orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
          select: { id: true, revisionNumber: true },
        });
        if (!latest || latest.id !== base.id || latest.revisionNumber !== parsed.baseRevisionNumber)
          throw new EditorSaveError('STALE_BASE');

        const curriculum = await tx.curriculumVersion.findFirst({
          where: { id: base.curriculumVersionId, status: 'PUBLISHED' },
          select: { id: true },
        });
        const nodeIds = base.nodeLinks.map((link) => link.curriculumNodeId);
        const linkedNodes = curriculum
          ? await tx.curriculumNode.findMany({
              where: { id: { in: nodeIds }, versionId: curriculum.id },
              select: { id: true },
            })
          : [];
        if (
          !curriculum ||
          new Set(nodeIds).size !== nodeIds.length ||
          linkedNodes.length !== nodeIds.length
        )
          throw new EditorSaveError('CURRICULUM_UNAVAILABLE');

        const baseSnapshot = {
          scoringMode: base.scoringMode,
          totalScoreUnits: base.totalScoreUnits,
          sections: base.sections.map((section) => ({
            key: section.key,
            title: section.title,
            instructions: section.instructions,
            order: section.order,
            scoreUnits: section.scoreUnits,
            questions: section.questions.map((question) => ({
              logicalId: question.logicalId,
              key: question.key,
              type: question.type,
              prompt: question.prompt,
              instructions: question.instructions,
              order: question.order,
              scoreUnits: question.scoreUnits,
              answers: question.answers.map((answer) => ({
                key: answer.key,
                order: answer.order,
                text: answer.text,
                explanation: answer.explanation,
              })),
              rubrics: question.rubrics.map((rubric) => ({
                key: rubric.key,
                order: rubric.order,
                description: rubric.description,
                scoreUnits: rubric.scoreUnits,
              })),
              subQuestions: question.subQuestions.map((sub) => ({
                key: sub.key,
                prompt: sub.prompt,
                order: sub.order,
                scoreUnits: sub.scoreUnits,
                answers: sub.answers.map((answer) => ({
                  key: answer.key,
                  order: answer.order,
                  text: answer.text,
                  explanation: answer.explanation,
                })),
                rubrics: sub.rubrics.map((rubric) => ({
                  key: rubric.key,
                  order: rubric.order,
                  description: rubric.description,
                  scoreUnits: rubric.scoreUnits,
                })),
              })),
            })),
          })),
        };
        let prepared;
        try {
          prepared = prepareEditedSnapshot({
            assessmentType: assessment.type,
            base: baseSnapshot,
            sections: parsed.sections,
            allocateLogicalId: randomUUID,
          });
        } catch (error) {
          if (error instanceof EditorSnapshotError)
            throw new EditorSaveError('INVALID_EDITOR_SNAPSHOT');
          throw error;
        }

        const revision = await tx.assessmentRevision.create({
          data: {
            assessmentId: assessment.id,
            revisionNumber: latest.revisionNumber + 1,
            idempotencyKey: storageKey,
            requestFingerprint,
            curriculumVersionId: base.curriculumVersionId,
            scoringMode: base.scoringMode,
            totalScoreUnits: base.totalScoreUnits,
            state: 'BUILDING',
            baseRevisionId: base.id,
          },
        });
        if (nodeIds.length)
          await tx.assessmentRevisionNodeLink.createMany({
            data: nodeIds.map((curriculumNodeId) => ({
              revisionId: revision.id,
              curriculumNodeId,
            })),
          });

        const baseQuestions = new Map(
          base.sections
            .flatMap((section) => section.questions)
            .map((question) => [question.logicalId, question]),
        );
        const copiedQuestionIds = new Map<string, string>();
        for (const section of prepared.sections) {
          const savedSection = await tx.assessmentSection.create({
            data: {
              revisionId: revision.id,
              key: section.key,
              title: section.title,
              instructions: section.instructions ?? null,
              order: section.order,
              scoreUnits: section.scoreUnits,
            },
          });
          for (const question of section.questions) {
            const prior = baseQuestions.get(question.logicalId!);
            const savedQuestion = await tx.assessmentQuestion.create({
              data: {
                sectionId: savedSection.id,
                logicalId: question.logicalId!,
                key: question.key,
                type: question.type,
                prompt: question.prompt,
                instructions: question.instructions ?? null,
                difficulty: prior?.difficulty ?? null,
                order: question.order,
                scoreUnits: question.scoreUnits,
              },
            });
            if (prior) copiedQuestionIds.set(prior.id, savedQuestion.id);
            for (const answer of question.answers) {
              const priorAnswer = prior?.answers.find((item) => item.key === answer.key);
              await tx.answer.create({
                data: {
                  questionId: savedQuestion.id,
                  key: answer.key,
                  order: answer.order,
                  text: answer.text,
                  explanation: answer.explanation ?? null,
                  answerData: (priorAnswer?.answerData ?? {}) as Prisma.InputJsonValue,
                },
              });
            }
            for (const rubric of question.rubrics)
              await tx.rubricCriterion.create({
                data: {
                  questionId: savedQuestion.id,
                  key: rubric.key,
                  order: rubric.order,
                  description: rubric.description,
                  scoreUnits: rubric.scoreUnits,
                },
              });
            for (const sub of question.subQuestions) {
              const priorSub = prior?.subQuestions.find((item) => item.key === sub.key);
              const savedSub = await tx.assessmentSubQuestion.create({
                data: {
                  questionId: savedQuestion.id,
                  key: sub.key,
                  prompt: sub.prompt,
                  order: sub.order,
                  scoreUnits: sub.scoreUnits,
                },
              });
              for (const answer of sub.answers) {
                const priorAnswer = priorSub?.answers.find((item) => item.key === answer.key);
                await tx.answer.create({
                  data: {
                    subQuestionId: savedSub.id,
                    key: answer.key,
                    order: answer.order,
                    text: answer.text,
                    explanation: answer.explanation ?? null,
                    answerData: (priorAnswer?.answerData ?? {}) as Prisma.InputJsonValue,
                  },
                });
              }
              for (const rubric of sub.rubrics)
                await tx.rubricCriterion.create({
                  data: {
                    subQuestionId: savedSub.id,
                    key: rubric.key,
                    order: rubric.order,
                    description: rubric.description,
                    scoreUnits: rubric.scoreUnits,
                  },
                });
            }
          }
        }
        for (const prior of baseQuestions.values()) {
          const assessmentQuestionId = copiedQuestionIds.get(prior.id);
          if (!assessmentQuestionId) continue;
          for (const link of prior.questionSourceLinks)
            await tx.questionSourceLink.create({
              data: {
                assessmentQuestionId,
                generationRunId: null,
                copiedFromQuestionSourceLinkId: link.id,
                knowledgeItemId: link.knowledgeItemId,
                sourceVersionId: link.sourceVersionId,
                locator: link.locator,
                textHash: link.textHash,
                curriculumVersionId: link.curriculumVersionId,
                curriculumNodeId: link.curriculumNodeId,
                lineage: link.lineage,
                priorQuestionId: link.priorQuestionId,
              },
            });
        }
        await tx.assessmentRevision.update({
          where: { id: revision.id },
          data: { state: 'FINALIZED' },
        });
        const baseIds = new Set(baseQuestions.keys());
        const outputIds = new Set(
          prepared.sections.flatMap((s) => s.questions.map((q) => q.logicalId!)),
        );
        await tx.auditEvent.create({
          data: {
            actorUserId: context.principal.userId,
            organizationId: context.organizationId,
            eventType: 'assessment.revision.edited',
            targetType: 'assessment_revision',
            targetId: revision.id,
            metadata: {
              schemaVersion: parsed.version,
              assessmentId: assessment.id,
              baseRevisionId: base.id,
              revisionId: revision.id,
              sectionCount: prepared.sections.length,
              questionCount: outputIds.size,
              addedQuestionCount: [...outputIds].filter((id) => !baseIds.has(id)).length,
              deletedQuestionCount: [...baseIds].filter((id) => !outputIds.has(id)).length,
            },
          },
        });
        return editorSaveResultSchema.parse({
          version: '1.0.0',
          assessmentId: assessment.id,
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          baseRevisionId: base.id,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable editor transaction retry state');
}
