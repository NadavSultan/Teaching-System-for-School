import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  approvalRequestSchema,
  approvalResultSchema,
  approvalStatusSchema,
  editorSaveRequestSchema,
  editorSaveResultSchema,
  studentSafePreviewSchema,
  teacherAssessmentListResponseSchema,
  teacherQuestionRegenerationRequestSchema,
  teacherWorkspaceSchema,
} from '@teach/contracts';
import {
  authorizeWorkspace,
  EditorSnapshotError,
  prepareEditedSnapshot,
  type AccessContext,
} from '@teach/domain';
import { prisma } from './index.js';
import { requestQuestionRegeneration } from './generation.js';
import {
  getRevisionValidationReadinessInTransaction,
  validationStatusFromRun,
} from './validation.js';

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

export class TeacherWorkspaceError extends Error {
  constructor(
    public readonly code:
      | 'RESOURCE_UNAVAILABLE'
      | 'STALE_REVISION'
      | 'IDEMPOTENCY_CONFLICT'
      | 'VALIDATION_REQUIRED'
      | 'APPROVAL_NOT_READY'
      | 'VALIDATION_PENDING'
      | 'VALIDATION_PROCESSING'
      | 'VALIDATION_FAILED'
      | 'DETERMINISTIC_BLOCKER'
      | 'SEMANTIC_BLOCKER'
      | 'WARNING_ACKNOWLEDGEMENT_REQUIRED'
      | 'VALIDATION_VERSION_STALE'
      | 'SOURCE_ELIGIBILITY_CHANGED',
  ) {
    super(code);
    this.name = 'TeacherWorkspaceError';
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

async function trustedContext(context: AccessContext, client: Db): Promise<AccessContext> {
  if (!context?.principal?.userId || !context.organizationId)
    throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  const membership = await client.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: context.principal.userId,
        organizationId: context.organizationId,
      },
    },
    include: { user: true, organization: true },
  });
  if (!membership) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  if (membership.user.platformAdmin) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  return {
    principal: context.principal,
    organizationId: membership.organizationId,
    userStatus: membership.user.status,
    membershipStatus: membership.status,
    role: membership.role,
    organizationStatus: membership.organization.status,
    workspaceType: membership.organization.workspaceType,
  };
}

function approvalResult(approval: {
  id: string;
  assessmentId: string;
  assessmentRevisionId: string;
  validationRunId: string;
  approvalSequence: number;
  createdAt: Date;
}) {
  return approvalResultSchema.parse({
    version: '1.0.0',
    approvalId: approval.id,
    assessmentId: approval.assessmentId,
    assessmentRevisionId: approval.assessmentRevisionId,
    validationRunId: approval.validationRunId,
    approvalSequence: approval.approvalSequence,
    createdAt: approval.createdAt.toISOString(),
  });
}

export async function listTeacherAssessments(
  context: AccessContext,
  cursor?: string,
  client: PrismaClient = prisma,
) {
  const trusted = await trustedContext(context, client);
  authorizeWorkspace(trusted, trusted.organizationId, 'READ_ASSESSMENT');
  let after: { updatedAt: Date; id: string } | undefined;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(parsed, 'updatedAt') ||
        !Object.prototype.hasOwnProperty.call(parsed, 'id') ||
        typeof (parsed as { updatedAt?: unknown }).updatedAt !== 'string' ||
        typeof (parsed as { id?: unknown }).id !== 'string'
      )
        throw new Error('invalid cursor');
      const updatedAt = new Date((parsed as { updatedAt: string }).updatedAt);
      if (Number.isNaN(updatedAt.getTime())) throw new Error('invalid cursor');
      after = { updatedAt, id: (parsed as { id: string }).id };
    } catch {
      throw new Error('Malformed request');
    }
  }
  const assessments = await client.assessment.findMany({
    where: {
      organizationId: trusted.organizationId,
      ...(after
        ? {
            OR: [
              { updatedAt: { lt: after.updatedAt } },
              { updatedAt: after.updatedAt, id: { gt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: 101,
    include: {
      revisions: {
        where: { state: 'FINALIZED' },
        orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
        take: 1,
      },
      approvals: { orderBy: [{ approvalSequence: 'desc' }, { id: 'desc' }], take: 1 },
    },
  });
  return teacherAssessmentListResponseSchema.parse({
    version: '1.0.0',
    items: assessments.slice(0, 100).map((assessment) => ({
      version: '1.0.0',
      id: assessment.id,
      type: assessment.type,
      title: assessment.title,
      latestRevisionNumber: assessment.revisions[0]?.revisionNumber ?? null,
      latestRevisionId: assessment.revisions[0]?.id ?? null,
      latestApprovalRevisionId: assessment.approvals[0]?.assessmentRevisionId ?? null,
      updatedAt: assessment.updatedAt.toISOString(),
    })),
    nextCursor:
      assessments.length > 100
        ? Buffer.from(
            JSON.stringify({
              updatedAt: assessments[99]!.updatedAt.toISOString(),
              id: assessments[99]!.id,
            }),
          ).toString('base64url')
        : null,
  });
}

export async function getApprovalHistory(
  context: AccessContext,
  assessmentId: string,
  client: PrismaClient = prisma,
) {
  const trusted = await trustedContext(context, client);
  authorizeWorkspace(trusted, trusted.organizationId, 'READ_ASSESSMENT');
  const assessment = await client.assessment.findFirst({
    where: { id: assessmentId, organizationId: trusted.organizationId },
    select: { id: true },
  });
  if (!assessment) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  const approvals = await client.assessmentApproval.findMany({
    where: { organizationId: trusted.organizationId, assessmentId },
    orderBy: [{ approvalSequence: 'asc' }, { id: 'asc' }],
  });
  return approvals.map((approval) => ({
    version: '1.0.0',
    approvalId: approval.id,
    assessmentId: approval.assessmentId,
    assessmentRevisionId: approval.assessmentRevisionId,
    validationRunId: approval.validationRunId,
    approvingUserId: approval.approvingUserId,
    approvalSequence: approval.approvalSequence,
    contractVersion: approval.contractVersion,
    validationRulesetVersion: approval.validationRulesetVersion,
    createdAt: approval.createdAt.toISOString(),
  }));
}

export async function approveAssessmentRevision(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = approvalRequestSchema.parse(input);
  const requestFingerprint = sha256(JSON.stringify(parsed));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx) => {
          const trusted = await trustedContext(context, tx);
          authorizeWorkspace(trusted, trusted.organizationId, 'APPROVE_ASSESSMENT_REVISION');
          const assessment = await tx.assessment.findFirst({
            where: { id: parsed.assessmentId, organizationId: trusted.organizationId },
          });
          if (!assessment) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${assessment.id}::text, 60))`;
          const existing = await tx.assessmentApproval.findUnique({
            where: {
              organizationId_approvingUserId_idempotencyKey: {
                organizationId: trusted.organizationId,
                approvingUserId: trusted.principal.userId,
                idempotencyKey: parsed.idempotencyKey,
              },
            },
          });
          if (existing) {
            if (
              existing.requestFingerprint !== requestFingerprint ||
              existing.assessmentId !== parsed.assessmentId ||
              existing.assessmentRevisionId !== parsed.assessmentRevisionId
            )
              throw new TeacherWorkspaceError('IDEMPOTENCY_CONFLICT');
            return approvalResult(existing);
          }
          const revision = await tx.assessmentRevision.findFirst({
            where: {
              id: parsed.assessmentRevisionId,
              assessmentId: assessment.id,
              state: 'FINALIZED',
            },
          });
          if (!revision) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
          const latest = await tx.assessmentRevision.findFirst({
            where: { assessmentId: assessment.id, state: 'FINALIZED' },
            orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
            select: { id: true },
          });
          if (!latest || latest.id !== revision.id)
            throw new TeacherWorkspaceError('STALE_REVISION');
          const readiness = await getRevisionValidationReadinessInTransaction(
            trusted,
            assessment.id,
            revision.id,
            tx,
            false,
          );
          if (readiness.status === 'BLOCKED' && readiness.reasonCode)
            throw new TeacherWorkspaceError(readiness.reasonCode);
          let validationRunId: string | undefined;
          try {
            const ready = await tx.$queryRaw<Array<{ assert_revision_approvable: string }>>`
              SELECT assert_revision_approvable(${trusted.organizationId}::uuid, ${revision.id}::uuid)
            `;
            validationRunId = ready[0]?.assert_revision_approvable;
          } catch (error) {
            const code = String(
              (error as { code?: unknown }).code === 'P2010'
                ? (error as { meta?: { code?: unknown } }).meta?.code
                : (error as { code?: unknown }).code,
            );
            if (code === 'P5030') throw new TeacherWorkspaceError('SOURCE_ELIGIBILITY_CHANGED');
            if (code === 'P5029') throw new TeacherWorkspaceError('VALIDATION_FAILED');
            throw error;
          }
          if (!validationRunId) throw new TeacherWorkspaceError('VALIDATION_FAILED');
          const preceding = await tx.assessmentApproval.count({
            where: { assessmentId: assessment.id },
          });
          const approval = await tx.assessmentApproval.create({
            data: {
              organizationId: trusted.organizationId,
              assessmentId: assessment.id,
              assessmentRevisionId: revision.id,
              validationRunId,
              approvingUserId: trusted.principal.userId,
              approvalSequence: preceding + 1,
              idempotencyKey: parsed.idempotencyKey,
              requestFingerprint,
              contractVersion: parsed.version,
              validationRulesetVersion: 'v1',
            },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: trusted.principal.userId,
              organizationId: trusted.organizationId,
              eventType: 'assessment.revision.approved',
              targetType: 'assessment_approval',
              targetId: approval.id,
              metadata: {
                operation: 'ASSESSMENT_REVISION_APPROVED',
                assessmentId: assessment.id,
                assessmentRevisionId: revision.id,
                validationRunId,
                approvalSequence: approval.approvalSequence,
                approvalCount: preceding + 1,
                contractVersion: parsed.version,
                validationRulesetVersion: 'v1',
              },
            },
          });
          return approvalResult(approval);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const code = (error as { code?: string })?.code;
      // A concurrent, identical approval can lose the unique insert after the
      // other transaction commits.  Retry so the idempotency lookup returns
      // that committed approval instead of leaking a storage-level conflict.
      if ((code !== 'P2034' && code !== 'P2002') || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable approval transaction retry state');
}

export async function getApprovalStatus(
  context: AccessContext,
  assessmentId: string,
  assessmentRevisionId: string,
  client: PrismaClient = prisma,
) {
  const trusted = await trustedContext(context, client);
  authorizeWorkspace(trusted, trusted.organizationId, 'READ_ASSESSMENT');
  const revision = await client.assessmentRevision.findFirst({
    where: {
      id: assessmentRevisionId,
      assessmentId,
      assessment: { organizationId: trusted.organizationId },
    },
    select: { id: true },
  });
  if (!revision) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  const approval = await client.assessmentApproval.findFirst({
    where: { assessmentId, assessmentRevisionId, organizationId: trusted.organizationId },
    orderBy: [{ approvalSequence: 'desc' }, { id: 'desc' }],
  });
  return approvalStatusSchema.parse({
    version: '1.0.0',
    assessmentRevisionId,
    approved: Boolean(approval),
    approvalId: approval?.id ?? null,
    approvalSequence: approval?.approvalSequence ?? null,
  });
}

const teacherGraphInclude = {
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
        },
      },
    },
  },
} as const;

function teacherRevision(revision: any) {
  return {
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
      instructions: section.instructions,
      order: section.order,
      scoreUnits: section.scoreUnits,
      questions: section.questions.map((question: any) => ({
        id: question.id,
        logicalId: question.logicalId,
        key: question.key,
        type: question.type,
        prompt: question.prompt,
        instructions: question.instructions,
        order: question.order,
        scoreUnits: question.scoreUnits,
        answers: question.answers.map((answer: any) => ({
          id: answer.id,
          key: answer.key,
          order: answer.order,
          text: answer.text,
          explanation: answer.explanation,
        })),
        rubrics: question.rubrics.map((rubric: any) => ({
          id: rubric.id,
          key: rubric.key,
          description: rubric.description,
          order: rubric.order,
          scoreUnits: rubric.scoreUnits,
        })),
        subQuestions: question.subQuestions.map((sub: any) => ({
          id: sub.id,
          key: sub.key,
          prompt: sub.prompt,
          order: sub.order,
          scoreUnits: sub.scoreUnits,
          answers: sub.answers.map((answer: any) => ({
            id: answer.id,
            key: answer.key,
            order: answer.order,
            text: answer.text,
            explanation: answer.explanation,
          })),
          rubrics: sub.rubrics.map((rubric: any) => ({
            id: rubric.id,
            key: rubric.key,
            description: rubric.description,
            order: rubric.order,
            scoreUnits: rubric.scoreUnits,
          })),
        })),
      })),
    })),
  };
}

export async function getTeacherWorkspace(
  context: AccessContext,
  assessmentId: string,
  revisionId: string | undefined,
  client: PrismaClient = prisma,
) {
  const trusted = await trustedContext(context, client);
  authorizeWorkspace(trusted, trusted.organizationId, 'READ_ASSESSMENT');
  return client.$transaction(
    async (tx) => {
      const assessment = await tx.assessment.findFirst({
        where: { id: assessmentId, organizationId: trusted.organizationId },
        include: {
          revisions: {
            where: { state: 'FINALIZED', ...(revisionId ? { id: revisionId } : {}) },
            orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
            take: 1,
            include: teacherGraphInclude,
          },
          approvals: { orderBy: [{ approvalSequence: 'desc' }, { id: 'desc' }] },
        },
      });
      const revision = assessment?.revisions[0];
      if (!assessment || !revision) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
      const latest = await tx.assessmentRevision.findFirst({
        where: { assessmentId: assessment.id, state: 'FINALIZED' },
        orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
      });
      const history = await tx.assessmentRevision.findMany({
        where: { assessmentId: assessment.id, state: 'FINALIZED' },
        orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
      });
      const validationRun = await tx.validationRun.findFirst({
        where: {
          organizationId: trusted.organizationId,
          assessmentId: assessment.id,
          assessmentRevisionId: revision.id,
        },
        orderBy: { revisionSequence: 'desc' },
        select: { id: true },
      });
      const validation = validationRun
        ? validationStatusFromRun(
            await tx.validationRun.findUnique({ where: { id: validationRun.id } }),
          )
        : null;
      const readiness = await getRevisionValidationReadinessInTransaction(
        trusted,
        assessment.id,
        revision.id,
        tx,
      );
      const approvalRow = await tx.assessmentApproval.findFirst({
        where: {
          assessmentId: assessment.id,
          assessmentRevisionId: revision.id,
          organizationId: trusted.organizationId,
        },
        orderBy: [{ approvalSequence: 'desc' }, { id: 'desc' }],
      });
      const approval = approvalStatusSchema.parse({
        version: '1.0.0',
        assessmentRevisionId: revision.id,
        approved: Boolean(approvalRow),
        approvalId: approvalRow?.id ?? null,
        approvalSequence: approvalRow?.approvalSequence ?? null,
      });
      return teacherWorkspaceSchema.parse({
        version: '1.0.0',
        assessment: {
          version: '1.0.0',
          id: assessment.id,
          type: assessment.type,
          title: assessment.title,
          latestRevisionNumber: latest?.revisionNumber ?? null,
          latestRevisionId: latest?.id ?? null,
          latestApprovalRevisionId: assessment.approvals[0]?.assessmentRevisionId ?? null,
          updatedAt: assessment.updatedAt.toISOString(),
        },
        revision: { ...teacherRevision(revision), baseRevisionId: revision.baseRevisionId },
        history: history.map((item) => {
          const approval = assessment.approvals.find(
            (entry) => entry.assessmentRevisionId === item.id,
          );
          return {
            id: item.id,
            assessmentId: item.assessmentId,
            revisionNumber: item.revisionNumber,
            baseRevisionId: item.baseRevisionId,
            createdAt: item.createdAt.toISOString(),
            approvedAt: approval?.createdAt.toISOString() ?? null,
            isLatest: latest?.id === item.id,
          };
        }),
        validation,
        readiness,
        approval,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getStudentSafePreview(
  context: AccessContext,
  assessmentId: string,
  revisionId: string,
  client: PrismaClient = prisma,
) {
  const workspace = await getTeacherWorkspace(context, assessmentId, revisionId, client);
  const trusted = await trustedContext(context, client);
  const approval = await client.assessmentApproval.findFirst({
    where: {
      organizationId: trusted.organizationId,
      assessmentId,
      assessmentRevisionId: workspace.revision.id,
    },
    select: { id: true },
  });
  if (!approval) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  return studentSafePreviewSchema.parse({
    version: '1.0.0',
    assessmentId,
    revisionId: workspace.revision.id,
    title: workspace.assessment.title,
    sections: workspace.revision.sections.map((section) => ({
      title: section.title,
      order: section.order,
      questions: section.questions.map((question) => ({
        logicalId: question.logicalId,
        prompt: question.prompt,
        instructions: question.instructions,
        order: question.order,
        scoreUnits: question.scoreUnits,
      })),
    })),
  });
}

export async function requestTeacherQuestionRegeneration(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const parsed = teacherQuestionRegenerationRequestSchema.parse(input);
  const trusted = await trustedContext(context, client);
  authorizeWorkspace(trusted, trusted.organizationId, 'CREATE_ASSESSMENT_REVISION');
  const revision = await client.assessmentRevision.findFirst({
    where: {
      id: parsed.baseRevisionId,
      assessmentId: parsed.assessmentId,
      state: 'FINALIZED',
      assessment: { organizationId: trusted.organizationId },
    },
    include: {
      sections: {
        include: { questions: { select: { id: true, logicalId: true, prompt: true } } },
      },
    },
  });
  const question = revision?.sections
    .flatMap((section) => section.questions)
    .find((item) => item.logicalId === parsed.logicalQuestionId);
  if (!revision || !question) throw new TeacherWorkspaceError('RESOURCE_UNAVAILABLE');
  return requestQuestionRegeneration(
    trusted,
    {
      version: '1.0.0',
      assessmentId: parsed.assessmentId,
      baseRevisionId: parsed.baseRevisionId,
      targetQuestionId: question.id,
      // Phase 60 intentionally exposes only the stable logical question ID.
      // Derive the internal Phase 40 retrieval query from its persisted prompt;
      // callers cannot inject hidden generation parameters through this boundary.
      query: question.prompt,
      instruction: 'Regenerate the selected question while preserving its assessment intent.',
      idempotencyKey: parsed.idempotencyKey,
    },
    client,
  );
}

export async function saveEditedRevision(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const resolved = await trustedContext(context, client);
  authorizeWorkspace(resolved, resolved.organizationId, 'CREATE_ASSESSMENT_REVISION');
  const parsed = editorSaveRequestSchema.parse(input);
  const storageKey = sha256(
    `phase60-editor\0${resolved.organizationId}\0${resolved.principal.userId}\0${parsed.idempotencyKey}`,
  );
  const requestFingerprint = sha256(JSON.stringify(parsed));

  const execute = () =>
    client.$transaction(
      async (tx) => {
        const trusted = await trustedContext(context, tx);
        authorizeWorkspace(trusted, trusted.organizationId, 'CREATE_ASSESSMENT_REVISION');
        const assessment = await tx.assessment.findFirst({
          where: { id: parsed.assessmentId, organizationId: trusted.organizationId },
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
          nodeIds.length === 0 ||
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
            actorUserId: trusted.principal.userId,
            organizationId: trusted.organizationId,
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
