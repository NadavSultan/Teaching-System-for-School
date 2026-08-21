import { PrismaClient, type Prisma } from '@prisma/client';
import { normalizeEmail } from '@teach/domain';
import { AccessDeniedError, authorizeWorkspace, type AccessContext } from '@teach/domain';
import { createHash } from 'node:crypto';
import {
  assessmentCreationSchema,
  assessmentRevisionSchema,
  finalizedAssessmentRevisionSchema,
} from '@teach/contracts';
import { curriculumImportSchema, publishedCurriculumSchema } from '@teach/contracts';
import { validateCurriculumHierarchy, validateScoreTree } from '@teach/domain';

export const prisma = new PrismaClient();

/** Resolves the only trusted tenant context accepted by Assessment operations. */
export async function resolveAccessContext(
  principal: AccessContext['principal'],
  organizationId: string,
  client: PrismaClient = prisma,
): Promise<AccessContext> {
  const membership = await client.membership.findUnique({
    where: { userId_organizationId: { userId: principal.userId, organizationId } },
    include: { user: true, organization: true },
  });
  if (!membership) throw new AccessDeniedError();
  return {
    principal,
    organizationId: membership.organizationId,
    userStatus: membership.user.status,
    membershipStatus: membership.status,
    role: membership.role,
    organizationStatus: membership.organization.status,
    workspaceType: membership.organization.workspaceType,
  };
}

export async function databaseReady(client: PrismaClient = prisma): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function databaseReadyAt(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await databaseReady(client);
  } finally {
    await client.$disconnect();
  }
}

export async function createPersonalWorkspace(
  input: { email: string; displayName?: string; workspaceName: string },
  client: PrismaClient = prisma,
) {
  const normalizedEmail = normalizeEmail(input.email);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedEmail}, 0))`;
          const user = await tx.user.upsert({
            where: { normalizedEmail },
            update: input.displayName ? { displayName: input.displayName } : {},
            create: {
              normalizedEmail,
              ...(input.displayName ? { displayName: input.displayName } : {}),
            },
          });
          const existing = await tx.membership.findFirst({
            where: { userId: user.id, organization: { workspaceType: 'PERSONAL' } },
            include: { organization: true },
          });
          if (existing) return { user, organization: existing.organization, membership: existing };
          const organization = await tx.organization.create({
            data: { name: input.workspaceName, workspaceType: 'PERSONAL' },
          });
          const membership = await tx.membership.create({
            data: { userId: user.id, organizationId: organization.id, role: 'TEACHER' },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: user.id,
              organizationId: organization.id,
              eventType: 'workspace.created',
              targetType: 'organization',
              targetId: organization.id,
              metadata: { source: 'phase10' },
            },
          });
          return { user, organization, membership };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
      if (code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('Personal workspace transaction retry exhausted');
}

export async function claimOutbox(client: PrismaClient = prisma, leaseMs = 5_000) {
  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM outbox_events WHERE ((status IN ('PENDING','FAILED') AND available_at <= NOW()) OR (status = 'PROCESSING' AND lease_expires_at <= NOW())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return tx.outboxEvent.update({
      where: { id: row.id },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + leaseMs),
      },
    });
  });
}

export async function finishOutbox(id: string, error?: unknown, client: PrismaClient = prisma) {
  if (error)
    return client.outboxEvent.update({
      where: { id },
      data: {
        status: 'FAILED',
        lastError: error instanceof Error ? error.name.slice(0, 500) : 'UnknownError',
        availableAt: new Date(Date.now() + 1000),
        lockedAt: null,
        leaseExpiresAt: null,
      },
    });
  return client.outboxEvent.update({
    where: { id },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      lastError: null,
      lockedAt: null,
      leaseExpiresAt: null,
    },
  });
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with different content');
  }
}

export async function createCurriculumWithDraft(input: unknown, client: PrismaClient = prisma) {
  const parsed = curriculumImportSchema.parse(input);
  const errors = validateCurriculumHierarchy(parsed.nodes);
  if (errors.length) throw new Error(errors.join('; '));
  return client.$transaction(async (tx) => {
    const curriculum = await tx.curriculum.upsert({
      where: { code: parsed.code },
      update: { displayName: parsed.displayName },
      create: {
        code: parsed.code,
        educationSystemCode: parsed.educationSystemCode,
        subjectCode: parsed.subjectCode,
        displayName: parsed.displayName,
      },
    });
    const version = await tx.curriculumVersion.create({
      data: {
        curriculumId: curriculum.id,
        versionNumber: parsed.versionNumber,
        humanLabel: parsed.humanLabel ?? null,
      },
    });
    return { curriculum, version };
  });
}

export async function importCurriculumDraft(input: unknown, client: PrismaClient = prisma) {
  const parsed = curriculumImportSchema.parse(input);
  const errors = validateCurriculumHierarchy(parsed.nodes);
  if (errors.length) throw new Error(errors.join('; '));
  return client.$transaction(async (tx) => {
    const curriculum = await tx.curriculum.upsert({
      where: { code: parsed.code },
      update: { displayName: parsed.displayName },
      create: {
        code: parsed.code,
        educationSystemCode: parsed.educationSystemCode,
        subjectCode: parsed.subjectCode,
        displayName: parsed.displayName,
      },
    });
    const version = await tx.curriculumVersion.create({
      data: {
        curriculumId: curriculum.id,
        versionNumber: parsed.versionNumber,
        humanLabel: parsed.humanLabel ?? null,
      },
    });
    const insert = async (nodes: typeof parsed.nodes, parentId?: string): Promise<void> => {
      for (const node of nodes) {
        const saved = await tx.curriculumNode.create({
          data: {
            versionId: version.id,
            parentId: parentId ?? null,
            type: node.type,
            code: node.code,
            label: node.label,
            description: node.description ?? null,
            sortOrder: node.sortOrder,
          },
        });
        if (node.difficulties?.length)
          await tx.curriculumSkillDifficulty.createMany({
            data: node.difficulties.map((band) => ({ nodeId: saved.id, band })),
          });
        if (node.children?.length) await insert(node.children, saved.id);
      }
    };
    await insert(parsed.nodes);
    return { curriculum, version };
  });
}

export async function publishCurriculumVersion(
  versionId: string,
  actorUserId?: string,
  client: PrismaClient = prisma,
) {
  return client.$transaction(async (tx) => {
    const version = await tx.curriculumVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { nodes: true },
    });
    if (version.status !== 'DRAFT' || !version.nodes.length)
      throw new Error('Curriculum draft is not publishable');
    const published = await tx.curriculumVersion.update({
      where: { id: versionId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: actorUserId ?? null,
        eventType: 'curriculum.published',
        targetType: 'curriculum_version',
        targetId: versionId,
        metadata: { versionNumber: version.versionNumber },
      },
    });
    return published;
  });
}

export async function deprecateCurriculumVersion(
  versionId: string,
  actorUserId?: string,
  client: PrismaClient = prisma,
) {
  return client.$transaction(async (tx) => {
    const version = await tx.curriculumVersion.update({
      where: { id: versionId },
      data: { status: 'DEPRECATED', deprecatedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: actorUserId ?? null,
        eventType: 'curriculum.deprecated',
        targetType: 'curriculum_version',
        targetId: versionId,
        metadata: { versionNumber: version.versionNumber },
      },
    });
    return version;
  });
}

export async function getPublishedCurriculum(versionId: string, client: PrismaClient = prisma) {
  const version = await client.curriculumVersion.findFirst({
    where: { id: versionId, status: 'PUBLISHED' },
    include: {
      nodes: { include: { difficulties: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] },
    },
  });
  if (!version) return null;
  const byParent = new Map<string | null, Array<(typeof version.nodes)[number]>>();
  for (const node of version.nodes)
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const mapNode = (node: (typeof version.nodes)[number]): unknown => ({
    id: node.id,
    code: node.code,
    type: node.type,
    label: node.label,
    ...(node.description ? { description: node.description } : {}),
    sortOrder: node.sortOrder,
    ...(node.difficulties.length
      ? { difficulties: node.difficulties.map((difficulty) => difficulty.band) }
      : {}),
    ...(byParent.get(node.id)?.length ? { children: byParent.get(node.id)!.map(mapNode) } : {}),
  });
  return publishedCurriculumSchema.parse({
    version: '1.0.0',
    id: version.id,
    curriculumId: version.curriculumId,
    versionNumber: version.versionNumber,
    status: 'PUBLISHED',
    nodes: (byParent.get(null) ?? []).map(mapNode),
  });
}

export function mapFinalizedAssessmentRevision(revision: any) {
  const answer = (item: any) => ({
    id: item.id,
    key: item.key,
    order: item.order,
    text: item.text,
    ...(item.answerData && typeof item.answerData === 'object' && !Array.isArray(item.answerData)
      ? { data: item.answerData }
      : {}),
    ...(item.explanation ? { explanation: item.explanation } : {}),
  });
  const rubric = (item: any) => ({
    id: item.id,
    key: item.key,
    description: item.description,
    order: item.order,
    scoreUnits: item.scoreUnits,
  });
  const question = (item: any) => ({
    id: item.id,
    key: item.key,
    type: item.type,
    prompt: item.prompt,
    ...(item.instructions ? { instructions: item.instructions } : {}),
    order: item.order,
    ...(item.difficulty ? { difficulty: item.difficulty } : {}),
    scoreUnits: item.scoreUnits,
    answers: item.answers.map(answer),
    rubrics: item.rubrics.map(rubric),
    subQuestions: item.subQuestions.map((sub: any) => ({
      id: sub.id,
      key: sub.key,
      prompt: sub.prompt,
      order: sub.order,
      scoreUnits: sub.scoreUnits,
      answers: sub.answers.map(answer),
      rubrics: sub.rubrics.map(rubric),
    })),
  });
  return finalizedAssessmentRevisionSchema.parse({
    version: '1.0.0',
    id: revision.id,
    assessmentId: revision.assessmentId,
    revisionNumber: revision.revisionNumber,
    curriculumVersionId: revision.curriculumVersionId,
    scoringMode: revision.scoringMode,
    totalScoreUnits: revision.totalScoreUnits,
    finalized: true,
    curriculumNodeIds: revision.nodeLinks.map((link: any) => link.curriculumNodeId),
    sections: revision.sections.map((section: any) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      ...(section.instructions ? { instructions: section.instructions } : {}),
      order: section.order,
      scoreUnits: section.scoreUnits,
      questions: section.questions.map(question),
    })),
  });
}

export async function createAssessment(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  authorizeWorkspace(context, context.organizationId, 'CREATE_ASSESSMENT');
  const parsed = assessmentCreationSchema.parse(input);
  return client.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        organizationId: context.organizationId,
        type: parsed.type,
        title: parsed.title,
        createdByUserId: context.principal.userId,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: context.principal.userId,
        organizationId: context.organizationId,
        eventType: 'assessment.created',
        targetType: 'assessment',
        targetId: assessment.id,
        metadata: { schemaVersion: parsed.version },
      },
    });
    return assessment;
  });
}

export async function getAssessmentRevision(
  context: AccessContext,
  assessmentId: string,
  revisionNumber: number,
  client: PrismaClient = prisma,
) {
  authorizeWorkspace(context, context.organizationId, 'READ_ASSESSMENT');
  const revision = await client.assessmentRevision.findFirst({
    where: {
      assessmentId,
      revisionNumber,
      state: 'FINALIZED',
      assessment: { organizationId: context.organizationId },
    },
    include: {
      nodeLinks: true,
      sections: {
        orderBy: { order: 'asc' },
        include: {
          questions: {
            orderBy: { order: 'asc' },
            include: {
              subQuestions: {
                orderBy: { order: 'asc' },
                include: {
                  answers: { orderBy: { order: 'asc' } },
                  rubrics: { orderBy: { order: 'asc' } },
                },
              },
              answers: { orderBy: { order: 'asc' } },
              rubrics: { orderBy: { order: 'asc' } },
            },
          },
        },
      },
    },
  });
  return revision ? mapFinalizedAssessmentRevision(revision) : null;
}

export async function createAssessmentRevision(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  authorizeWorkspace(context, context.organizationId, 'CREATE_ASSESSMENT_REVISION');
  const parsed = assessmentRevisionSchema.parse(input);
  return client.$transaction(async (tx) => {
    const assessment = await tx.assessment.findFirst({
      where: { id: parsed.assessmentId, organizationId: context.organizationId },
    });
    if (!assessment) throw new Error('Resource not found or unavailable');
    const totalScoreUnits =
      parsed.totalScoreUnits === undefined && assessment.type === 'TEST'
        ? 10_000
        : (parsed.totalScoreUnits ?? null);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...parsed, totalScoreUnits }))
      .digest('hex');
    const scoreErrors = validateScoreTree(
      parsed.scoringMode,
      assessment.type,
      totalScoreUnits,
      parsed.sections.map((section) => ({
        scoreUnits: section.scoreUnits ?? null,
        questions: section.questions.map((question) => ({
          scoreUnits: question.scoreUnits ?? null,
          rubricScores: question.rubrics.map((rubric) => rubric.scoreUnits ?? null),
          subQuestions: question.subQuestions.map((subQuestion) => ({
            scoreUnits: subQuestion.scoreUnits ?? null,
            rubricScores: subQuestion.rubrics.map((rubric) => rubric.scoreUnits ?? null),
          })),
        })),
      })),
    );
    if (scoreErrors.length) throw new Error(scoreErrors.map((error) => error.code).join(','));
    await tx.$queryRaw`SELECT id FROM assessments WHERE id = ${assessment.id}::uuid FOR UPDATE`;
    const existing = await tx.assessmentRevision.findUnique({
      where: {
        assessmentId_idempotencyKey: {
          assessmentId: assessment.id,
          idempotencyKey: parsed.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new IdempotencyConflictError();
      return existing;
    }
    const curriculum = await tx.curriculumVersion.findFirst({
      where: { id: parsed.curriculumVersionId, status: 'PUBLISHED' },
    });
    if (!curriculum) throw new Error('Curriculum version is unavailable');
    const count = await tx.assessmentRevision.count({ where: { assessmentId: assessment.id } });
    const linkedNodes = await tx.curriculumNode.findMany({
      where: { id: { in: parsed.curriculumNodeIds }, versionId: curriculum.id },
      select: { id: true },
    });
    if (linkedNodes.length !== parsed.curriculumNodeIds.length)
      throw new Error('Curriculum nodes are unavailable');
    const revision = await tx.assessmentRevision.create({
      data: {
        assessmentId: assessment.id,
        revisionNumber: count + 1,
        idempotencyKey: parsed.idempotencyKey,
        requestFingerprint: fingerprint,
        curriculumVersionId: curriculum.id,
        scoringMode: parsed.scoringMode,
        totalScoreUnits,
        state: 'BUILDING',
      },
    });
    if (linkedNodes.length)
      await tx.assessmentRevisionNodeLink.createMany({
        data: linkedNodes.map((node) => ({ revisionId: revision.id, curriculumNodeId: node.id })),
      });
    for (const section of parsed.sections) {
      const savedSection = await tx.assessmentSection.create({
        data: {
          revisionId: revision.id,
          key: section.key,
          title: section.title,
          instructions: section.instructions ?? null,
          order: section.order,
          scoreUnits: section.scoreUnits ?? null,
        },
      });
      for (const question of section.questions) {
        const savedQuestion = await tx.assessmentQuestion.create({
          data: {
            sectionId: savedSection.id,
            key: question.key,
            type: question.type,
            prompt: question.prompt,
            instructions: question.instructions ?? null,
            difficulty: question.difficulty ?? null,
            order: question.order,
            scoreUnits: question.scoreUnits ?? null,
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
              scoreUnits: rubric.scoreUnits ?? null,
            },
          });
        for (const subQuestion of question.subQuestions) {
          const savedSubQuestion = await tx.assessmentSubQuestion.create({
            data: {
              questionId: savedQuestion.id,
              key: subQuestion.key,
              prompt: subQuestion.prompt,
              order: subQuestion.order,
              scoreUnits: subQuestion.scoreUnits ?? null,
            },
          });
          for (const answer of subQuestion.answers)
            await tx.answer.create({
              data: {
                subQuestionId: savedSubQuestion.id,
                answerData: JSON.parse(JSON.stringify(answer.data ?? {})) as Prisma.InputJsonValue,
                key: answer.key,
                order: answer.order,
                text: answer.text,
                explanation: answer.explanation ?? null,
              },
            });
          for (const rubric of subQuestion.rubrics)
            await tx.rubricCriterion.create({
              data: {
                subQuestionId: savedSubQuestion.id,
                key: rubric.key,
                description: rubric.description,
                order: rubric.order,
                scoreUnits: rubric.scoreUnits ?? null,
              },
            });
        }
      }
    }
    await tx.assessmentRevision.update({
      where: { id: revision.id },
      data: { state: 'FINALIZED' },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: context.principal.userId,
        organizationId: context.organizationId,
        eventType: 'assessment.revision.finalized',
        targetType: 'assessment_revision',
        targetId: revision.id,
        metadata: { revisionNumber: revision.revisionNumber },
      },
    });
    return { ...revision, state: 'FINALIZED' as const };
  });
}
