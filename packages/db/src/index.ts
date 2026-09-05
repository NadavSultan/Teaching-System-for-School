import { PrismaClient, type Prisma } from '@prisma/client';
import { normalizeEmail } from '@teach/domain';
import {
  AccessDeniedError,
  authorizeWorkspace,
  canTransitionSourceLifecycle,
  type AccessContext,
  type SourceLifecycleStatus,
} from '@teach/domain';
import { createHash } from 'node:crypto';
import {
  assessmentCreationSchema,
  assessmentRevisionSchema,
  finalizedAssessmentRevisionSchema,
} from '@teach/contracts';
import { curriculumImportSchema, publishedCurriculumSchema } from '@teach/contracts';
import { validateCurriculumHierarchy, validateScoreTree } from '@teach/domain';
import { normalizeSourceText, parsePlainTextSource } from '@teach/domain';
import {
  retrievalRequestSchema,
  sourceCreationSchema,
  sourceVersionRegistrationSchema,
  pedagogicalReviewDecisionSchema,
  usagePermissionDecisionContractSchema,
  ingestionRequestSchema,
  ingestionStatusSchema,
  eligibleKnowledgeItemSchema,
  retrievalResultSchema,
  sourceSummarySchema,
  sourceVersionSummarySchema,
  knowledgeItemProvenanceSchema,
} from '@teach/contracts';

export const prisma = new PrismaClient();

export * from './teacher-workspace.js';

export type PlatformAccessContext = {
  kind: 'PLATFORM';
  principal: AccessContext['principal'];
};

export async function resolvePlatformAccessContext(
  principal: AccessContext['principal'],
  client: PrismaClient = prisma,
): Promise<PlatformAccessContext> {
  const user = await client.user.findUnique({
    where: { id: principal.userId },
    select: { id: true, status: true, platformAdmin: true },
  });
  if (!user || user.status !== 'ACTIVE' || !user.platformAdmin) throw new AccessDeniedError();
  return { kind: 'PLATFORM', principal };
}

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
        organizationId: isPlatformContext(context) ? null : context.organizationId,
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
      return { ...existing };
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

async function assertSourceContext(
  context: AccessContext,
  organizationId: string,
  client: PrismaClient,
  write = false,
): Promise<void> {
  const membership = await client.membership.findUnique({
    where: { userId_organizationId: { userId: context.principal.userId, organizationId } },
    include: { user: true, organization: true },
  });
  if (
    !membership ||
    membership.user.status !== 'ACTIVE' ||
    membership.status !== 'ACTIVE' ||
    membership.organization.status !== 'ACTIVE' ||
    membership.role === 'PLATFORM_ADMIN' ||
    (write && !['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'].includes(membership.role)) ||
    context.organizationId !== organizationId
  )
    throw new AccessDeniedError();
}

async function requirePlatformCuration(
  context: PlatformAccessContext,
  client: PrismaClient,
): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: context.principal.userId },
    select: { status: true, platformAdmin: true },
  });
  if (!user || user.status !== 'ACTIVE' || !user.platformAdmin) throw new AccessDeniedError();
}

function isPlatformContext(
  context: AccessContext | PlatformAccessContext,
): context is PlatformAccessContext {
  return 'kind' in context && context.kind === 'PLATFORM';
}

async function requirePlatformContext(
  context: AccessContext | PlatformAccessContext,
  client: PrismaClient,
): Promise<PlatformAccessContext> {
  if (!isPlatformContext(context)) throw new AccessDeniedError();
  return resolvePlatformAccessContext(context.principal, client);
}

async function sourceReadAllowed(
  context: AccessContext | PlatformAccessContext,
  source: { visibility: string; organizationId: string | null },
  client: PrismaClient,
): Promise<void> {
  if (source.visibility === 'PLATFORM_SHARED') {
    if (isPlatformContext(context)) await requirePlatformCuration(context, client);
    else await assertSourceContext(context, context.organizationId, client, false);
    return;
  }
  if (isPlatformContext(context) || source.organizationId !== context.organizationId)
    throw new AccessDeniedError();
  await assertSourceContext(context, source.organizationId ?? '', client, false);
}

async function authorizeSourceMutation(
  context: AccessContext | PlatformAccessContext,
  source: { visibility: string; organizationId: string | null },
  client: PrismaClient,
): Promise<void> {
  if (source.visibility === 'PLATFORM_SHARED') {
    await requirePlatformContext(context, client);
    return;
  }
  if (isPlatformContext(context)) throw new AccessDeniedError();
  return assertSourceContext(context, source.organizationId ?? '', client, true);
}

function mapSourceSummary(source: {
  id: string;
  title: string;
  visibility: 'PLATFORM_SHARED' | 'ORGANIZATION_PRIVATE';
  organizationId: string | null;
  versions?: Array<{ lifecycleEvents?: Array<{ toStatus: any }> }>;
}) {
  return sourceSummarySchema.parse({
    version: '1.0.0',
    id: source.id,
    title: source.title,
    visibility: source.visibility,
    organizationId: source.organizationId,
    lifecycle: source.versions?.[0]?.lifecycleEvents?.[0]?.toStatus ?? 'DRAFT',
  });
}

function mapSourceVersionSummary(version: {
  id: string;
  sourceId: string;
  versionNumber: number;
  contentHash: string;
  lifecycleEvents: Array<{ toStatus: any }>;
}) {
  return sourceVersionSummarySchema.parse({
    version: '1.0.0',
    id: version.id,
    sourceId: version.sourceId,
    versionNumber: version.versionNumber,
    contentHash: version.contentHash,
    lifecycle: version.lifecycleEvents[0]?.toStatus,
  });
}

function mapIngestionStatus(run: {
  id: string;
  sourceVersionId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  failureClass: string | null;
}) {
  return ingestionStatusSchema.parse({
    version: '1.0.0',
    id: run.id,
    sourceVersionId: run.sourceVersionId,
    status: run.status,
    attempts: run.attempts,
    failureClass: run.failureClass,
  });
}

export async function createKnowledgeSource(
  context: AccessContext | PlatformAccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = sourceCreationSchema.parse(input);
  if (parsed.visibility === 'PLATFORM_SHARED') await requirePlatformContext(context, client);
  else {
    if (isPlatformContext(context)) throw new AccessDeniedError();
    await assertSourceContext(context, context.organizationId, client, true);
  }
  const source = await client.knowledgeSource.create({
    data: {
      organizationId:
        parsed.visibility === 'ORGANIZATION_PRIVATE' && !isPlatformContext(context)
          ? context.organizationId
          : null,
      visibility: parsed.visibility,
      title: parsed.title,
      origin: parsed.origin,
      metadata: parsed.metadata,
    },
  });
  await client.auditEvent.create({
    data: {
      actorUserId: context.principal.userId,
      organizationId: isPlatformContext(context) ? null : context.organizationId,
      eventType: 'source.created',
      targetType: 'knowledge_source',
      targetId: source.id,
      metadata: { visibility: source.visibility },
    },
  });
  return mapSourceSummary(source);
}

export async function registerSourceVersion(
  context: AccessContext | PlatformAccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = sourceVersionRegistrationSchema.parse(input);
  const source = await client.knowledgeSource.findFirst({
    where: {
      id: parsed.sourceId,
      ...(isPlatformContext(context)
        ? { visibility: 'PLATFORM_SHARED', organizationId: null }
        : {
            OR: [
              { organizationId: context.organizationId },
              { visibility: 'PLATFORM_SHARED', organizationId: null },
            ],
          }),
    },
  });
  if (!source) throw new AccessDeniedError();
  await authorizeSourceMutation(context, source, client);
  if (/^https?:\/\//i.test(parsed.contentReference))
    throw new Error('RemoteContentReferenceNotAllowed');
  const contentHash = createHash('sha256').update(parsed.content, 'utf8').digest('hex');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ ...parsed, content: undefined, contentHash }))
    .digest('hex');
  return client.$transaction(async (tx) => {
    const lockedSource = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM knowledge_sources WHERE id = ${source.id}::uuid FOR UPDATE
    `;
    if (!lockedSource[0]) throw new AccessDeniedError();
    const existing = await tx.sourceVersion.findUnique({
      where: {
        sourceId_idempotencyKey: { sourceId: source.id, idempotencyKey: parsed.idempotencyKey },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new IdempotencyConflictError();
      const existingWithEvidence = await tx.sourceVersion.findUniqueOrThrow({
        where: { id: existing.id },
        include: { lifecycleEvents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
      });
      return mapSourceVersionSummary(existingWithEvidence);
    }
    const curriculum = await tx.curriculumVersion.findFirst({
      where: { id: parsed.curriculumVersionId, status: 'PUBLISHED' },
    });
    if (!curriculum) throw new Error('Curriculum version is unavailable');
    const nodes = await tx.curriculumNode.findMany({
      where: { id: { in: parsed.curriculumNodeIds }, versionId: curriculum.id },
      select: { id: true },
    });
    if (nodes.length !== parsed.curriculumNodeIds.length)
      throw new Error('Curriculum nodes are unavailable');
    const count = await tx.sourceVersion.count({ where: { sourceId: source.id } });
    const version = await tx.sourceVersion.create({
      data: {
        sourceId: source.id,
        versionNumber: count + 1,
        contentHash,
        contentReference: parsed.contentReference,
        contentMimeType: parsed.contentMimeType,
        metadata: parsed.metadata,
        requestFingerprint: fingerprint,
        idempotencyKey: parsed.idempotencyKey,
        curriculumLinks: {
          create: parsed.curriculumNodeIds.map((curriculumNodeId) => ({
            curriculumNodeId,
            curriculumVersionId: curriculum.id,
          })),
        },
      },
    });
    await tx.sourceVersionContent.create({
      data: { sourceVersionId: version.id, contentHash, content: parsed.content },
    });
    await tx.sourceLifecycleEvent.create({
      data: {
        sourceVersionId: version.id,
        sourceId: version.sourceId,
        organizationId: source.organizationId,
        actorUserId: context.principal.userId,
        fromStatus: null,
        toStatus: 'DRAFT',
        reason: 'Source version registered',
        safeMetadata: {},
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: context.principal.userId,
        organizationId: isPlatformContext(context) ? null : context.organizationId,
        eventType: 'source.version.registered',
        targetType: 'source_version',
        targetId: version.id,
        metadata: { versionNumber: version.versionNumber, contentHash },
      },
    });
    const withEvidence = await tx.sourceVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: { lifecycleEvents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    return mapSourceVersionSummary(withEvidence);
  });
}

async function findSourceVersionForContext(
  context: AccessContext | PlatformAccessContext,
  sourceVersionId: string,
  client: PrismaClient,
) {
  const version = await client.sourceVersion.findUnique({
    where: { id: sourceVersionId },
    include: { source: true },
  });
  if (!version) throw new AccessDeniedError();
  await sourceReadAllowed(context, version.source, client);
  return version;
}

export async function recordPedagogicalReview(
  context: AccessContext | PlatformAccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = pedagogicalReviewDecisionSchema.parse(input);
  const version = await findSourceVersionForContext(context, parsed.sourceVersionId, client);
  await authorizeSourceMutation(context, version.source, client);
  const row = await client.pedagogicalReview.create({
    data: {
      sourceVersionId: version.id,
      reviewerUserId: context.principal.userId,
      decision: parsed.decision,
      reason: parsed.reason,
      evidenceMetadata: parsed.evidenceMetadata,
    },
  });
  await client.auditEvent.create({
    data: {
      actorUserId: context.principal.userId,
      organizationId: isPlatformContext(context) ? null : context.organizationId,
      eventType: 'source.review.recorded',
      targetType: 'source_version',
      targetId: version.id,
      metadata: { decision: row.decision },
    },
  });
  return pedagogicalReviewDecisionSchema.parse({
    version: '1.0.0',
    sourceVersionId: row.sourceVersionId,
    decision: row.decision,
    reason: row.reason,
    evidenceMetadata: row.evidenceMetadata,
  });
}

export async function recordUsagePermission(
  context: AccessContext | PlatformAccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = usagePermissionDecisionContractSchema.parse(input);
  const version = await findSourceVersionForContext(context, parsed.sourceVersionId, client);
  await authorizeSourceMutation(context, version.source, client);
  const row = await client.usagePermission.create({
    data: {
      sourceVersionId: version.id,
      reviewerUserId: context.principal.userId,
      decision: parsed.decision,
      evidenceReference: parsed.evidenceReference,
      scope: parsed.scope,
      validUntil: parsed.validUntil ? new Date(parsed.validUntil) : null,
    },
  });
  await client.auditEvent.create({
    data: {
      actorUserId: context.principal.userId,
      organizationId: isPlatformContext(context) ? null : context.organizationId,
      eventType: 'source.permission.recorded',
      targetType: 'source_version',
      targetId: version.id,
      metadata: { decision: row.decision, scope: row.scope },
    },
  });
  return usagePermissionDecisionContractSchema.parse({
    version: '1.0.0',
    sourceVersionId: row.sourceVersionId,
    decision: row.decision,
    evidenceReference: row.evidenceReference,
    scope: row.scope,
    validUntil: row.validUntil?.toISOString() ?? null,
  });
}

export async function setSourceLifecycle(
  context: AccessContext | PlatformAccessContext,
  sourceVersionId: string,
  toStatus: 'ACTIVE' | 'SUSPENDED' | 'DEPRECATED' | 'FAILED' | 'NEEDS_RE_REVIEW',
  reason: string,
  client: PrismaClient = prisma,
) {
  const version = await findSourceVersionForContext(context, sourceVersionId, client);
  await authorizeSourceMutation(context, version.source, client);
  if (reason.length < 1 || reason.length > 1000) throw new Error('InvalidLifecycleReason');
  return client.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<
      Array<{ id: string; sourceId: string; versionNumber: number; contentHash: string }>
    >`SELECT id, source_id AS "sourceId", version_number AS "versionNumber", content_hash AS "contentHash" FROM source_versions WHERE id = ${sourceVersionId}::uuid FOR UPDATE`;
    const locked = lockedRows[0];
    if (!locked) throw new AccessDeniedError();
    const latest = await tx.sourceLifecycleEvent.findFirst({
      where: { sourceVersionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!latest) throw new Error('Lifecycle evidence is inconsistent');
    if (!canTransitionSourceLifecycle(latest.toStatus as SourceLifecycleStatus, toStatus))
      throw new Error('Source lifecycle transition is not allowed');
    await tx.sourceLifecycleEvent.create({
      data: {
        sourceVersionId,
        sourceId: locked.sourceId,
        organizationId: version.source.organizationId,
        actorUserId: context.principal.userId,
        fromStatus: latest.toStatus,
        toStatus,
        reason,
        safeMetadata: {},
      },
    });
    return mapSourceVersionSummary({
      id: locked.id,
      sourceId: locked.sourceId,
      versionNumber: locked.versionNumber,
      contentHash: locked.contentHash,
      lifecycleEvents: [{ toStatus }],
    });
  });
}

export async function requestIngestion(
  context: AccessContext | PlatformAccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = ingestionRequestSchema.parse(input);
  const version = await findSourceVersionForContext(context, parsed.sourceVersionId, client);
  await authorizeSourceMutation(context, version.source, client);
  const run = await client.ingestionRun.upsert({
    where: {
      sourceVersionId_contentHash_pipelineVersion: {
        sourceVersionId: version.id,
        contentHash: version.contentHash,
        pipelineVersion: parsed.pipelineVersion,
      },
    },
    update: {},
    create: {
      sourceVersionId: version.id,
      contentHash: version.contentHash,
      pipelineVersion: parsed.pipelineVersion,
      parserVersion: 'plain-text-v1',
    },
  });
  await client.outboxEvent.upsert({
    where: { idempotencyKey: `ingest:${run.id}` },
    update: {},
    create: {
      organizationId: version.source.organizationId,
      eventType: 'source.ingest.requested',
      payload: { ingestionRunId: run.id },
      idempotencyKey: `ingest:${run.id}`,
    },
  });
  return mapIngestionStatus(run);
}

export async function runIngestion(ingestionRunId: string, client: PrismaClient = prisma) {
  const run = await client.ingestionRun.findUniqueOrThrow({
    where: { id: ingestionRunId },
    include: { sourceVersion: { include: { source: true, curriculumLinks: true, content: true } } },
  });
  if (run.status === 'SUCCEEDED') return mapIngestionStatus(run);
  const updated = await client.ingestionRun.update({
    where: { id: run.id },
    data: {
      status: 'PROCESSING',
      attempts: { increment: 1 },
      startedAt: new Date(),
      failureClass: null,
    },
  });
  try {
    const content = run.sourceVersion.content;
    if (
      !content ||
      content.contentHash !== run.sourceVersion.contentHash ||
      createHash('sha256').update(content.content, 'utf8').digest('hex') !==
        run.sourceVersion.contentHash
    )
      throw new Error('SourceContentHashMismatch');
    const items = parsePlainTextSource(normalizeSourceText(content.content), 1000);
    if (!items.length) throw new Error('EmptySource');
    const result = await client.$transaction(async (tx) => {
      for (const item of items) {
        const hash = createHash('sha256').update(item.text).digest('hex');
        const saved = await tx.knowledgeItem.upsert({
          where: {
            sourceVersionId_locator_textHash: {
              sourceVersionId: run.sourceVersionId,
              locator: item.locator,
              textHash: hash,
            },
          },
          update: {},
          create: {
            sourceVersionId: run.sourceVersionId,
            ingestionRunId: run.id,
            organizationId: run.sourceVersion.source.organizationId,
            visibility: run.sourceVersion.source.visibility,
            locator: item.locator,
            normalizedText: item.text,
            textHash: hash,
            metadata: {},
            pipelineVersion: run.pipelineVersion,
            parserVersion: run.parserVersion,
            status: 'ACTIVE',
          },
        });
        await tx.knowledgeItemCurriculumNodeLink.createMany({
          data: run.sourceVersion.curriculumLinks.map((link) => ({
            knowledgeItemId: saved.id,
            curriculumVersionId: link.curriculumVersionId,
            curriculumNodeId: link.curriculumNodeId,
          })),
          skipDuplicates: true,
        });
      }
      return tx.ingestionRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      });
    });
    return mapIngestionStatus(result);
  } catch (error) {
    await client.ingestionRun.update({
      where: { id: updated.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        failureClass: error instanceof Error ? error.name.slice(0, 120) : 'UnknownError',
      },
    });
    throw error;
  }
}

export async function retrieveEligibleKnowledge(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = retrievalRequestSchema.parse(input);
  await assertSourceContext(context, parsed.organizationId, client);
  const query = parsed.query.trim();
  const rows = await client.$queryRaw<
    Array<any>
  >`SELECT ki.id, ki.source_version_id AS "sourceVersionId", ki.locator, ki.text_hash AS "textHash", ki.metadata, ki.visibility, link.curriculum_version_id AS "curriculumVersionId", link.curriculum_node_id AS "curriculumNodeId", ts_rank(ki.search_vector, plainto_tsquery('simple', ${query})) AS score FROM knowledge_items ki JOIN knowledge_item_curriculum_node_links link ON link.knowledge_item_id = ki.id JOIN source_versions sv ON sv.id = ki.source_version_id JOIN knowledge_sources ks ON ks.id = sv.source_id JOIN LATERAL (SELECT to_status FROM source_lifecycle_events WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) sl ON true JOIN LATERAL (SELECT decision FROM pedagogical_reviews WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) pr ON true JOIN LATERAL (SELECT decision, valid_until FROM usage_permissions WHERE source_version_id = sv.id ORDER BY created_at DESC, id DESC LIMIT 1) up ON true JOIN curriculum_versions cv ON cv.id = link.curriculum_version_id WHERE ki.status = 'ACTIVE' AND sl.to_status = 'ACTIVE' AND pr.decision = 'APPROVED' AND up.decision = 'ALLOWED' AND (up.valid_until IS NULL OR up.valid_until > NOW()) AND cv.status = 'PUBLISHED' AND link.curriculum_version_id = ${parsed.curriculumVersionId}::uuid AND link.curriculum_node_id = ANY(${parsed.curriculumNodeIds}::uuid[]) AND (ks.visibility = 'PLATFORM_SHARED' OR ks.organization_id = ${context.organizationId}::uuid) AND (${query} = '' OR ki.search_vector @@ plainto_tsquery('simple', ${query})) ORDER BY score DESC, ki.id ASC, link.curriculum_version_id ASC, link.curriculum_node_id ASC LIMIT ${parsed.limit}`;
  const items = rows.map((row, index) =>
    eligibleKnowledgeItemSchema.parse({
      version: '1.0.0',
      id: row.id,
      sourceVersionId: row.sourceVersionId,
      locator: row.locator,
      textHash: row.textHash,
      metadata: row.metadata ?? {},
      score: Number(row.score),
      rank: index + 1,
      curriculumVersionId: row.curriculumVersionId,
      curriculumNodeId: row.curriculumNodeId,
      visibility: row.visibility,
    }),
  );
  return retrievalResultSchema.parse({ version: '1.0.0', items });
}

export async function getKnowledgeSource(
  context: AccessContext | PlatformAccessContext,
  sourceId: string,
  client: PrismaClient = prisma,
) {
  try {
    if (isPlatformContext(context)) await requirePlatformCuration(context, client);
    else await assertSourceContext(context, context.organizationId, client);
  } catch {
    return null;
  }
  const source = await client.knowledgeSource.findFirst({
    where: {
      id: sourceId,
      ...(isPlatformContext(context)
        ? { visibility: 'PLATFORM_SHARED', organizationId: null }
        : {
            OR: [
              { organizationId: context.organizationId },
              { visibility: 'PLATFORM_SHARED', organizationId: null },
            ],
          }),
    },
    include: {
      versions: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        include: { lifecycleEvents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
      },
    },
  });
  return source ? mapSourceSummary(source) : null;
}

export async function getSourceVersion(
  context: AccessContext | PlatformAccessContext,
  sourceVersionId: string,
  client: PrismaClient = prisma,
) {
  try {
    if (isPlatformContext(context)) await requirePlatformCuration(context, client);
    else await assertSourceContext(context, context.organizationId, client);
  } catch {
    return null;
  }
  const version = await client.sourceVersion.findFirst({
    where: {
      id: sourceVersionId,
      source: {
        ...(isPlatformContext(context)
          ? { visibility: 'PLATFORM_SHARED', organizationId: null }
          : {
              OR: [
                { organizationId: context.organizationId },
                { visibility: 'PLATFORM_SHARED', organizationId: null },
              ],
            }),
      },
    },
    include: { lifecycleEvents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
  });
  if (!version) return null;
  return mapSourceVersionSummary(version);
}

export async function getKnowledgeItem(
  context: AccessContext | PlatformAccessContext,
  itemId: string,
  client: PrismaClient = prisma,
) {
  try {
    if (isPlatformContext(context)) await requirePlatformCuration(context, client);
    else await assertSourceContext(context, context.organizationId, client);
  } catch {
    return null;
  }
  const item = await client.knowledgeItem.findFirst({
    where: {
      id: itemId,
      sourceVersion: {
        source: {
          ...(isPlatformContext(context)
            ? { visibility: 'PLATFORM_SHARED', organizationId: null }
            : {
                OR: [
                  { organizationId: context.organizationId },
                  { visibility: 'PLATFORM_SHARED', organizationId: null },
                ],
              }),
        },
      },
    },
    include: { curriculumLinks: true },
  });
  if (!item || item.curriculumLinks.length === 0) return null;
  return knowledgeItemProvenanceSchema.parse({
    version: '1.0.0',
    id: item.id,
    sourceVersionId: item.sourceVersionId,
    locator: item.locator,
    textHash: item.textHash,
    metadata: item.metadata,
    pipelineVersion: item.pipelineVersion,
    parserVersion: item.parserVersion,
    visibility: item.visibility,
    curriculumLineage: item.curriculumLinks
      .sort(
        (a, b) =>
          a.curriculumVersionId.localeCompare(b.curriculumVersionId) ||
          a.curriculumNodeId.localeCompare(b.curriculumNodeId),
      )
      .map((link) => ({
        curriculumVersionId: link.curriculumVersionId,
        curriculumNodeId: link.curriculumNodeId,
      })),
  });
}

export async function getIngestionStatus(
  context: AccessContext | PlatformAccessContext,
  ingestionRunId: string,
  client: PrismaClient = prisma,
) {
  try {
    if (isPlatformContext(context)) await requirePlatformCuration(context, client);
    else await assertSourceContext(context, context.organizationId, client);
  } catch {
    return null;
  }
  const run = await client.ingestionRun.findFirst({
    where: {
      id: ingestionRunId,
      sourceVersion: {
        source: {
          ...(isPlatformContext(context)
            ? { visibility: 'PLATFORM_SHARED', organizationId: null }
            : {
                OR: [
                  { organizationId: context.organizationId },
                  { visibility: 'PLATFORM_SHARED', organizationId: null },
                ],
              }),
        },
      },
    },
  });
  return run ? mapIngestionStatus(run) : null;
}

export * from './generation.js';
export * from './validation.js';
