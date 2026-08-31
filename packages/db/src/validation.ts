import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  validationAcknowledgementSchema,
  validationReadinessSchema,
  validationRequestSchema,
  validationResultSchema,
  validationStatusSchema,
} from '@teach/contracts';
import {
  authorizeWorkspace,
  evaluateDeterministicRules,
  type AccessContext,
  type ValidationReadiness,
} from '@teach/domain';
import { getGenerationModelConfiguration, getGenerationPromptTemplate } from '@teach/ai';
import {
  DeterministicFakeSemanticEvaluator,
  evaluateSemanticWithRetry,
  SemanticEvaluatorFailure,
  type SemanticEvaluator,
  semanticEvaluatorRegistry,
} from '@teach/ai';
import { IdempotencyConflictError, prisma } from './index.js';

const RULESET_VERSION = 'v1';
const EVALUATOR_VERSION = semanticEvaluatorRegistry.evaluatorVersion;
const RESPONSE_SCHEMA_HASH = createHash('sha256')
  .update('generated-draft-output.v1|generated-question-output.v1')
  .digest('hex');
type Db = PrismaClient | Prisma.TransactionClient;

async function reloadValidationContext(context: AccessContext, client: Db): Promise<AccessContext> {
  if (!context?.principal?.userId || !context.organizationId)
    throw new Error('Resource not found or unavailable');
  const membership = await client.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: context.principal.userId,
        organizationId: context.organizationId,
      },
    },
    include: { user: true, organization: true },
  });
  if (!membership) throw new Error('Resource not found or unavailable');
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

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function status(run: any) {
  return validationStatusSchema.parse({
    version: '1.0.0',
    id: run.id,
    assessmentId: run.assessmentId,
    assessmentRevisionId: run.assessmentRevisionId,
    revisionSequence: run.revisionSequence,
    rulesetVersion: run.rulesetVersion,
    evaluatorVersion: run.evaluatorVersion,
    state: run.state,
    attempts: run.attempts,
    failureCode: run.failureCode,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    deterministicPassCount: run.deterministicPassCount,
    deterministicFailCount: run.deterministicFailCount,
    semanticFindingCount: run.semanticFindingCount,
  });
}

function resultEvidence(value: unknown, identity: string, revisionId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Validation evidence integrity mismatch');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'identity,revisionId' ||
    record.identity !== identity ||
    record.revisionId !== revisionId
  )
    throw new Error('Validation evidence integrity mismatch');
  return { identity, revisionId };
}

async function ownedRun(context: AccessContext, runId: string, client: Db) {
  return client.validationRun.findFirst({
    where: { id: runId, organizationId: context.organizationId },
    include: {
      executions: {
        include: { ruleDefinition: true },
        orderBy: { ruleDefinition: { deterministicOrder: 'asc' } },
      },
      findings: {
        include: { acknowledgements: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ kind: 'asc' }, { path: 'asc' }, { code: 'asc' }, { id: 'asc' }],
      },
      semanticEvaluation: true,
    },
  });
}

/**
 * Converts persisted Phase 20/30/40 rows into the domain validator's strict
 * input.  The values used for source identity deliberately come from the
 * canonical knowledge-item/source-version rows, never from client-shaped
 * link metadata.
 */
function toValidationSnapshot(revision: any) {
  const linkedRuns = revision.sections.flatMap((section: any) =>
    section.questions.flatMap((question: any) =>
      question.questionSourceLinks.map((link: any) => link.generationRunId),
    ),
  );
  const linkedRunIds = [...new Set(linkedRuns)];
  const validOutputRuns = (revision.outputGenerationRuns ?? []).filter(
    (run: any) =>
      run.state === 'SUCCEEDED' &&
      run.organizationId === revision.assessment.organizationId &&
      run.assessmentId === revision.assessmentId &&
      run.outputRevisionId === revision.id,
  );
  const outputRun =
    linkedRunIds.length === 1
      ? validOutputRuns.find((run: any) => run.id === linkedRunIds[0])
      : linkedRunIds.length === 0 && validOutputRuns.length === 1
        ? validOutputRuns[0]
        : undefined;
  const specification = outputRun?.frozenSpecification as any;
  const frozenPlan = specification?.sections
    ? {
        questions: specification.sections.flatMap((section: any) =>
          section.questions.map((question: any) => ({ key: question.key, order: question.order })),
        ),
      }
    : {
        questions: revision.sections.flatMap((section: any) =>
          section.questions.map((question: any) => ({ key: question.key, order: question.order })),
        ),
      };
  const nodeIds = revision.nodeLinks.map((link: any) => link.curriculumNodeId);
  const latest = (rows: any[], predicate: (row: any) => boolean) =>
    [...rows]
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || String(b.id).localeCompare(String(a.id)),
      )
      .find(predicate);
  const mapLink = (question: any, link: any) => {
    const sourceVersion = link.sourceVersion;
    const source = sourceVersion?.source;
    const run = link.generationRun;
    if (!sourceVersion || !source || !link.knowledgeItem || !run) {
      return {
        questionId: question.id,
        revisionId: revision.id,
        sourceVersionId: link.sourceVersionId ?? '',
        knowledgeItemId: link.knowledgeItemId ?? '',
        locator: link.locator ?? '',
        contentHash: link.textHash ?? '',
        sourceVersion: {
          id: sourceVersion?.id ?? link.sourceVersionId ?? '',
          sourceId: sourceVersion?.sourceId ?? '',
          sourceOrganizationId: source?.organizationId ?? '',
        },
        knowledgeItem: {
          id: link.knowledgeItem?.id ?? link.knowledgeItemId ?? '',
          sourceVersionId: link.knowledgeItem?.sourceVersionId ?? '',
          organizationId: link.knowledgeItem?.organizationId ?? '',
        },
        canonical: {
          relationComplete: false,
          runMatchesRevision: false,
          questionMatchesRevision: false,
          sourceParentMatches: false,
          contextMatches: false,
          locatorMatches: false,
          contentHashMatches: false,
          curriculumMatches: false,
          ownershipMatches: false,
          pinnedProvenanceMatches: false,
        },
        eligibility: {
          pedagogicalApproved: false,
          usageAllowed: false,
          sourceLifecycle: 'FAILED',
          itemLifecycle: 'SUSPENDED',
          visibilityPermitted: false,
          exactPublishedCurriculum: false,
        },
        provenance: {
          generationRunId: '',
          generationRunState: 'FAILED',
          operation: 'DRAFT',
          assessmentId: '',
          curriculumVersionId: '',
          outputRevisionId: '',
          promptTemplateVersion: '',
          promptTemplateHash: '',
          modelConfigurationVersion: '',
          modelConfigurationHash: '',
          responseSchemaVersion: '',
          responseSchemaHash: '',
          revisionId: '',
          questionId: '',
          sourceVersionId: '',
          knowledgeItemId: '',
        },
      };
    }
    const review = latest(sourceVersion.reviews ?? [], () => true);
    const permission = latest(sourceVersion.permissions ?? [], () => true);
    const authoritativeRun = outputRun?.id === run.id ? outputRun : undefined;
    return {
      questionId: question.id,
      revisionId: revision.id,
      sourceVersionId: link.sourceVersionId,
      knowledgeItemId: link.knowledgeItemId,
      // Link values are candidates; the nested canonical snapshot is the authority.
      locator: link.locator,
      contentHash: link.textHash,
      sourceVersion: {
        id: sourceVersion.id,
        contentHash: sourceVersion.contentHash,
        sourceId: sourceVersion.sourceId,
        sourceOrganizationId: source.organizationId,
      },
      knowledgeItem: {
        id: link.knowledgeItem.id,
        locator: link.knowledgeItem.locator,
        textHash: link.knowledgeItem.textHash,
        sourceVersionId: link.knowledgeItem.sourceVersionId,
        organizationId: link.knowledgeItem.organizationId,
      },
      canonical: {
        relationComplete: true,
        runMatchesRevision:
          outputRun?.id === run.id &&
          run.state === 'SUCCEEDED' &&
          run.organizationId === revision.assessment.organizationId &&
          run.assessmentId === revision.assessmentId &&
          run.outputRevisionId === revision.id,
        questionMatchesRevision: question.questionSourceLinks.some(
          (candidate: any) => candidate.id === link.id,
        ),
        sourceParentMatches: link.knowledgeItem.sourceVersionId === sourceVersion.id,
        contextMatches: (authoritativeRun?.contextItems ?? []).some(
          (context: any) =>
            context.generationRunId === run.id &&
            context.knowledgeItemId === link.knowledgeItem.id &&
            context.sourceVersionId === sourceVersion.id &&
            context.locator === link.knowledgeItem.locator &&
            context.textHash === link.knowledgeItem.textHash &&
            context.curriculumVersionId === link.curriculumVersionId &&
            context.curriculumNodeId === link.curriculumNodeId,
        ),
        locatorMatches: link.locator === link.knowledgeItem.locator,
        contentHashMatches: link.textHash === link.knowledgeItem.textHash,
        curriculumMatches:
          link.curriculumVersionId === revision.curriculumVersionId &&
          nodeIds.includes(link.curriculumNodeId),
        ownershipMatches:
          source.visibility === 'PLATFORM_SHARED' ||
          source.organizationId === revision.assessment.organizationId,
        pinnedProvenanceMatches:
          run.promptTemplateVersion === getGenerationPromptTemplate(run.operation).version &&
          run.promptTemplateHash === getGenerationPromptTemplate(run.operation).hash &&
          run.modelConfigurationVersion === getGenerationModelConfiguration().version &&
          run.modelConfigurationHash === getGenerationModelConfiguration().hash &&
          run.responseSchemaVersion === '1.0.0' &&
          run.responseSchemaHash === RESPONSE_SCHEMA_HASH,
      },
      eligibility: {
        pedagogicalApproved: review?.decision === 'APPROVED',
        usageAllowed:
          permission?.decision === 'ALLOWED' &&
          (permission.validUntil === null || permission.validUntil > new Date()),
        sourceLifecycle: source.lifecycleEvents?.[0]?.toStatus ?? sourceVersion.lifecycle,
        itemLifecycle: link.knowledgeItem.status,
        visibilityPermitted:
          link.knowledgeItem.visibility === 'PLATFORM_SHARED' ||
          link.knowledgeItem.organizationId === revision.assessment.organizationId,
        exactPublishedCurriculum:
          link.curriculumVersionId === revision.curriculumVersionId &&
          nodeIds.includes(link.curriculumNodeId) &&
          revision.curriculumVersion.status === 'PUBLISHED',
      },
      provenance: {
        generationRunId: run.id,
        generationRunState: run.state,
        operation: run.operation,
        assessmentId: run.assessmentId,
        curriculumVersionId: link.curriculumVersionId,
        outputRevisionId: run.outputRevisionId,
        promptTemplateVersion: run.promptTemplateVersion,
        promptTemplateHash: run.promptTemplateHash,
        modelConfigurationVersion: run.modelConfigurationVersion,
        modelConfigurationHash: run.modelConfigurationHash,
        responseSchemaVersion: run.responseSchemaVersion,
        responseSchemaHash: run.responseSchemaHash,
        revisionId: revision.id,
        questionId: question.id,
        sourceVersionId: sourceVersion.id,
        knowledgeItemId: link.knowledgeItem.id,
      },
    };
  };
  const mapQuestion = (question: any, links: any[]) => ({
    id: question.id,
    key: question.key,
    prompt: question.prompt,
    instructions: question.instructions ?? '',
    order: question.order,
    scoreUnits: question.scoreUnits,
    answers: question.answers.map((answer: any) => ({
      ownerType: 'QUESTION',
      ownerId: question.id,
      text: answer.text,
    })),
    rubrics: question.rubrics.map((rubric: any) => ({
      ownerType: 'QUESTION',
      ownerId: question.id,
      scoreUnits: rubric.scoreUnits,
    })),
    subQuestions: question.subQuestions.map((sub: any) => ({
      id: sub.id,
      key: sub.key,
      prompt: sub.prompt,
      instructions: '',
      order: sub.order,
      scoreUnits: sub.scoreUnits,
      answers: sub.answers.map((answer: any) => ({
        ownerType: 'SUBQUESTION',
        ownerId: sub.id,
        text: answer.text,
      })),
      rubrics: sub.rubrics.map((rubric: any) => ({
        ownerType: 'SUBQUESTION',
        ownerId: sub.id,
        scoreUnits: rubric.scoreUnits,
      })),
      subQuestions: [],
      questionSourceLinks: [],
    })),
    questionSourceLinks: links.map((link) => mapLink(question, link)),
  });
  return {
    id: revision.id,
    generationRunId: outputRun?.id ?? '',
    generationOperation: outputRun?.operation ?? 'DRAFT',
    promptTemplateVersion: outputRun?.promptTemplateVersion ?? '',
    promptTemplateHash: outputRun?.promptTemplateHash ?? '',
    modelConfigurationVersion: outputRun?.modelConfigurationVersion ?? '',
    modelConfigurationHash: outputRun?.modelConfigurationHash ?? '',
    responseSchemaVersion: outputRun?.responseSchemaVersion ?? '',
    responseSchemaHash: outputRun?.responseSchemaHash ?? '',
    assessmentId: revision.assessmentId,
    organizationId: revision.assessment.organizationId,
    ownerOrganizationId: revision.assessment.organizationId,
    state: revision.state,
    assessmentType: revision.assessment.type,
    scoringMode: revision.scoringMode,
    totalScoreUnits: revision.totalScoreUnits,
    curriculumVersion: {
      id: revision.curriculumVersion.id,
      status: revision.curriculumVersion.status,
      nodeIds,
    },
    curriculumNodeIds: nodeIds,
    frozenPlan,
    sections: revision.sections.map((section: any) => ({
      key: section.key,
      order: section.order,
      scoreUnits: section.scoreUnits,
      questions: section.questions.map((question: any) =>
        mapQuestion(question, question.questionSourceLinks),
      ),
    })),
  };
}

export async function requestRevisionValidation(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const trustedContext = await reloadValidationContext(context, client);
  authorizeWorkspace(trustedContext, trustedContext.organizationId, 'CREATE_ASSESSMENT_REVISION');
  const parsed = validationRequestSchema.parse(input);
  const requestFingerprint = fingerprint({
    assessmentId: parsed.assessmentId,
    assessmentRevisionId: parsed.assessmentRevisionId,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx) => {
          const revisionRows = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT r.id FROM assessment_revisions r JOIN assessments a ON a.id = r.assessment_id WHERE r.id = ${parsed.assessmentRevisionId}::uuid AND r.assessment_id = ${parsed.assessmentId}::uuid AND a.organization_id = ${trustedContext.organizationId}::uuid AND r.state = 'FINALIZED' FOR UPDATE`;
          if (!revisionRows[0]) throw new Error('Resource not found or unavailable');
          const reusedKey = await tx.validationRun.findFirst({
            where: {
              organizationId: trustedContext.organizationId,
              requestingUserId: trustedContext.principal.userId,
              idempotencyKey: parsed.idempotencyKey,
            },
          });
          if (reusedKey && reusedKey.requestFingerprint !== requestFingerprint)
            throw new IdempotencyConflictError();
          const existing = await tx.validationRun.findUnique({
            where: {
              organizationId_assessmentRevisionId_idempotencyKey: {
                organizationId: trustedContext.organizationId,
                assessmentRevisionId: parsed.assessmentRevisionId,
                idempotencyKey: parsed.idempotencyKey,
              },
            },
          });
          if (existing) {
            if (existing.requestFingerprint !== requestFingerprint)
              throw new IdempotencyConflictError();
            return status(existing);
          }
          const sequence =
            (
              await tx.validationRun.aggregate({
                where: {
                  organizationId: trustedContext.organizationId,
                  assessmentRevisionId: parsed.assessmentRevisionId,
                },
                _max: { revisionSequence: true },
              })
            )._max.revisionSequence ?? 0;
          const run = await tx.validationRun.create({
            data: {
              organizationId: trustedContext.organizationId,
              assessmentId: parsed.assessmentId,
              assessmentRevisionId: parsed.assessmentRevisionId,
              requestingUserId: trustedContext.principal.userId,
              rulesetVersion: RULESET_VERSION,
              evaluatorVersion: EVALUATOR_VERSION,
              revisionSequence: sequence + 1,
              idempotencyKey: parsed.idempotencyKey,
              requestFingerprint,
            },
          });
          await tx.outboxEvent.create({
            data: {
              organizationId: trustedContext.organizationId,
              eventType: 'validation.requested',
              payload: { validationRunId: run.id },
              idempotencyKey: `validation:${run.id}`,
            },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: trustedContext.principal.userId,
              organizationId: trustedContext.organizationId,
              eventType: 'validation.requested',
              targetType: 'validation_run',
              targetId: run.id,
              metadata: { rulesetVersion: RULESET_VERSION, evaluatorVersion: EVALUATOR_VERSION },
            },
          });
          return status(run);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('Validation request transaction retry exhausted');
}

export async function getValidationStatus(
  context: AccessContext,
  runId: string,
  client: PrismaClient = prisma,
) {
  const trustedContext = await reloadValidationContext(context, client);
  authorizeWorkspace(trustedContext, trustedContext.organizationId, 'READ_ASSESSMENT');
  const run = await client.validationRun.findFirst({
    where: { id: runId, organizationId: trustedContext.organizationId },
  });
  return run ? status(run) : null;
}

export async function getValidationResult(
  context: AccessContext,
  runId: string,
  client: PrismaClient = prisma,
) {
  const trustedContext = await reloadValidationContext(context, client);
  authorizeWorkspace(trustedContext, trustedContext.organizationId, 'READ_ASSESSMENT');
  const run = await ownedRun(trustedContext, runId, client);
  if (!run) return null;
  return validationResultSchema.parse({
    version: '1.0.0',
    status: status(run),
    executions: run.executions.map((row) => ({
      ruleId: row.ruleDefinition.ruleId,
      ruleVersion: row.ruleDefinition.ruleVersion,
      outcome: row.outcome,
      evidence: resultEvidence(row.evidence, row.ruleDefinition.ruleId, run.assessmentRevisionId),
    })),
    findings: run.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      code: finding.code,
      category: finding.category,
      severity: finding.severity,
      path: finding.path,
      messageKey: finding.messageKey,
      evidence: resultEvidence(finding.evidence, finding.code, run.assessmentRevisionId),
      confidenceBasisPoints: finding.confidenceBasisPoints,
      ruleVersion: finding.ruleVersion,
      evaluatorVersion: finding.evaluatorVersion,
      schemaVersion: finding.kind === 'SEMANTIC' ? run.semanticEvaluation?.schemaVersion : null,
    })),
    semanticEvaluation: run.semanticEvaluation
      ? {
          state: run.semanticEvaluation.state,
          evaluatorVersion: run.semanticEvaluation.evaluatorVersion,
          promptVersion: run.semanticEvaluation.promptVersion,
          modelConfigurationVersion: run.semanticEvaluation.modelConfigurationVersion,
          schemaVersion: run.semanticEvaluation.schemaVersion,
          failureCode: run.semanticEvaluation.failureCode,
          latencyMs: run.semanticEvaluation.latencyMs ?? 0,
          findingCount: run.findings.filter((finding) => finding.kind === 'SEMANTIC').length,
        }
      : null,
  });
}

export async function acknowledgeSemanticWarning(
  context: AccessContext,
  input: unknown,
  client: PrismaClient = prisma,
) {
  const trustedContext = await reloadValidationContext(context, client);
  authorizeWorkspace(trustedContext, trustedContext.organizationId, 'CREATE_ASSESSMENT_REVISION');
  const parsed = validationAcknowledgementSchema.parse(input);
  const reasonHash = createHash('sha256').update(parsed.reason).digest('hex');
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${trustedContext.organizationId}:${trustedContext.principal.userId}:${parsed.idempotencyKey}`}, 0))`;
    const finding = await tx.validationFinding.findFirst({
      where: { id: parsed.findingId, organizationId: trustedContext.organizationId },
      include: { validationRun: true },
    });
    if (!finding) throw new Error('Resource not found or unavailable');
    if (finding.kind !== 'SEMANTIC' || finding.severity !== 'WARNING')
      throw new Error('Validation finding is not acknowledgeable');
    const existing = await tx.validationFindingAcknowledgement.findUnique({
      where: {
        organizationId_findingId_idempotencyKey: {
          organizationId: trustedContext.organizationId,
          findingId: finding.id,
          idempotencyKey: parsed.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.reasonHash !== reasonHash) throw new IdempotencyConflictError();
      return existing;
    }
    const reusedKey = await tx.validationFindingAcknowledgement.findFirst({
      where: {
        organizationId: trustedContext.organizationId,
        actorUserId: trustedContext.principal.userId,
        idempotencyKey: parsed.idempotencyKey,
      },
    });
    if (reusedKey) throw new IdempotencyConflictError();
    const acknowledgement = await tx.validationFindingAcknowledgement.create({
      data: {
        organizationId: trustedContext.organizationId,
        findingId: finding.id,
        actorUserId: trustedContext.principal.userId,
        idempotencyKey: parsed.idempotencyKey,
        reason: parsed.reason,
        reasonHash,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: trustedContext.principal.userId,
        organizationId: trustedContext.organizationId,
        eventType: 'validation.warning_acknowledged',
        targetType: 'validation_finding',
        targetId: finding.id,
        metadata: {
          validationRunId: finding.validationRunId,
          findingId: finding.id,
          reasonHash: reasonHash.slice(0, 64),
          reasonClass: 'ACKNOWLEDGEMENT',
        },
      },
    });
    return acknowledgement;
  });
}

export async function getRevisionValidationReadiness(
  context: AccessContext,
  assessmentId: string,
  assessmentRevisionId: string,
  client: PrismaClient = prisma,
): Promise<ValidationReadiness> {
  return client.$transaction(async (tx) => {
    const trustedContext = await reloadValidationContext(context, tx);
    authorizeWorkspace(trustedContext, trustedContext.organizationId, 'READ_ASSESSMENT');
    const revision = await tx.assessmentRevision.findFirst({
      where: {
        id: assessmentRevisionId,
        assessmentId,
        assessment: { organizationId: trustedContext.organizationId },
      },
    });
    if (!revision)
      return validationReadinessSchema.parse({
        version: '1.0.0',
        status: 'BLOCKED',
        reasonCode: 'VALIDATION_REQUIRED',
        validationRunId: null,
      });
    const run = await tx.validationRun.findFirst({
      where: { organizationId: trustedContext.organizationId, assessmentId, assessmentRevisionId },
      orderBy: { revisionSequence: 'desc' },
      include: {
        findings: { include: { acknowledgements: true } },
        executions: true,
        semanticEvaluation: true,
      },
    });
    let reasonCode: string | null = null;
    if (!run) reasonCode = 'VALIDATION_REQUIRED';
    else if (run.state !== 'SUCCEEDED')
      reasonCode =
        run.state === 'FAILED'
          ? 'VALIDATION_FAILED'
          : run.state === 'PENDING'
            ? 'VALIDATION_PENDING'
            : 'VALIDATION_PROCESSING';
    else if (run.rulesetVersion !== RULESET_VERSION || run.evaluatorVersion !== EVALUATOR_VERSION)
      reasonCode = 'VALIDATION_VERSION_STALE';
    else if (
      run.findings.some(
        (finding) =>
          finding.severity === 'BLOCKING' ||
          (finding.severity === 'WARNING' && finding.acknowledgements.length === 0),
      )
    )
      reasonCode = run.findings.some((finding) => finding.kind === 'DETERMINISTIC')
        ? 'DETERMINISTIC_BLOCKER'
        : run.findings.some((finding) => finding.severity === 'BLOCKING')
          ? 'SEMANTIC_BLOCKER'
          : 'WARNING_ACKNOWLEDGEMENT_REQUIRED';
    else if (
      run.executions.length !== 11 ||
      !run.semanticEvaluation ||
      run.semanticEvaluation.state !== 'SUCCEEDED'
    )
      reasonCode = 'VALIDATION_FAILED';
    if (!reasonCode && run) {
      try {
        const rows = await tx.$queryRaw<
          Array<{ assert_revision_approvable: string }>
        >`SELECT assert_revision_approvable(${trustedContext.organizationId}::uuid, ${assessmentRevisionId}::uuid)`;
        if (rows[0]?.assert_revision_approvable !== run.id) reasonCode = 'VALIDATION_FAILED';
      } catch (error) {
        const dbCode =
          error && typeof error === 'object'
            ? String(
                (error as { code?: unknown }).code === 'P2010'
                  ? (error as { meta?: { code?: unknown } }).meta?.code
                  : (error as { code?: unknown }).code,
              )
            : '';
        reasonCode = dbCode === 'P5030' ? 'SOURCE_ELIGIBILITY_CHANGED' : 'VALIDATION_FAILED';
      }
    }
    return validationReadinessSchema.parse({
      version: '1.0.0',
      status: reasonCode ? 'BLOCKED' : 'READY',
      reasonCode,
      validationRunId: run?.id ?? null,
    });
  });
}

export async function assertRevisionApprovable(
  organizationId: string,
  assessmentRevisionId: string,
  client: PrismaClient = prisma,
) {
  const rows = await client.$queryRaw<
    Array<{ assert_revision_approvable: string }>
  >`SELECT assert_revision_approvable(${organizationId}::uuid, ${assessmentRevisionId}::uuid)`;
  return rows[0]?.assert_revision_approvable;
}

export async function processValidationRun(
  validationRunId: string,
  client: PrismaClient = prisma,
  evaluator: SemanticEvaluator = new DeterministicFakeSemanticEvaluator(),
) {
  return client.$transaction(async (tx) => {
    const run = await tx.validationRun.findUnique({ where: { id: validationRunId } });
    if (!run || run.state === 'SUCCEEDED' || run.state === 'FAILED')
      return run ? status(run) : null;
    const now = new Date();
    if (run.state === 'PROCESSING') {
      if (!run.leaseExpiresAt || run.leaseExpiresAt >= now) return status(run);
      await tx.validationRun.update({
        where: { id: run.id },
        data: {
          state: 'PENDING',
          processingStartedAt: null,
          leaseExpiresAt: null,
        },
      });
    }
    const claimedRows = await tx.validationRun.updateMany({
      where: {
        id: run.id,
        state: 'PENDING',
      },
      data: {
        state: 'PROCESSING',
        attempts: { increment: 1 },
        processingStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 30_000),
      },
    });
    if (claimedRows.count !== 1) {
      const current = await tx.validationRun.findUnique({ where: { id: run.id } });
      return current ? status(current) : null;
    }
    const claimed = await tx.validationRun.findUniqueOrThrow({ where: { id: run.id } });
    const rules = await tx.validationRuleDefinition.findMany({
      where: { rulesetVersion: claimed.rulesetVersion },
      orderBy: { deterministicOrder: 'asc' },
    });
    if (rules.length !== 11)
      return status(
        await tx.validationRun.update({
          where: { id: claimed.id },
          data: {
            state: 'FAILED',
            failureCode: 'RULESET_INTEGRITY',
            completedAt: new Date(),
            leaseExpiresAt: null,
          },
        }),
      );
    let revision: any = null;
    try {
      revision = await tx.assessmentRevision.findUnique({
        where: { id: claimed.assessmentRevisionId },
        include: {
          assessment: true,
          curriculumVersion: true,
          nodeLinks: true,
          outputGenerationRuns: { include: { contextItems: true } },
          sections: {
            include: {
              questions: {
                include: {
                  answers: true,
                  rubrics: true,
                  subQuestions: { include: { answers: true, rubrics: true } },
                  questionSourceLinks: {
                    include: {
                      knowledgeItem: { include: { sourceVersion: { include: { source: true } } } },
                      generationRun: true,
                      sourceVersion: {
                        include: {
                          source: {
                            include: {
                              lifecycleEvents: {
                                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                                take: 1,
                              },
                            },
                          },
                          reviews: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
                          permissions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
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
    } catch {
      // A deliberately orphaned persisted relation cannot be materialized by Prisma.
      // Preserve a terminal, evidence-bearing fail-closed validation result instead.
      revision = null;
    }
    const results = evaluateDeterministicRules(revision ? toValidationSnapshot(revision) : {});
    const byRule = new Map(results.map((result) => [result.ruleId, result]));
    const executions = await Promise.all(
      rules.map((rule) =>
        tx.validationRuleExecution.create({
          data: {
            validationRunId: claimed.id,
            ruleDefinitionId: rule.id,
            outcome: byRule.get(rule.ruleId as never)?.outcome ?? 'FAIL',
            evidence: {
              identity: rule.ruleId,
              revisionId: claimed.assessmentRevisionId,
            },
          },
        }),
      ),
    );
    await Promise.all(
      executions.flatMap((execution) => {
        const rule = rules.find((definition) => definition.id === execution.ruleDefinitionId)!;
        const result = byRule.get(rule.ruleId as never);
        return result?.outcome === 'FAIL'
          ? [
              tx.validationFinding.create({
                data: {
                  organizationId: claimed.organizationId,
                  validationRunId: claimed.id,
                  assessmentRevisionId: claimed.assessmentRevisionId,
                  executionId: execution.id,
                  kind: 'DETERMINISTIC',
                  code: rule.ruleId,
                  category: rule.category,
                  severity: 'BLOCKING',
                  path: result.path,
                  messageKey: result.messageKey!,
                  evidence: {
                    identity: rule.ruleId,
                    revisionId: claimed.assessmentRevisionId,
                  },
                  ruleVersion: rule.ruleVersion,
                },
              }),
            ]
          : [];
      }),
    );
    try {
      const semantic = await evaluateSemanticWithRetry(evaluator, {
        revisionId: claimed.assessmentRevisionId,
        operationId: claimed.id,
      });
      const evaluation = await tx.semanticEvaluation.create({
        data: {
          validationRunId: claimed.id,
          evaluatorVersion: semantic.evaluatorVersion,
          promptVersion: semantic.promptVersion,
          modelConfigurationVersion: semantic.modelConfigurationVersion,
          schemaVersion: semantic.schemaVersion,
          state: 'SUCCEEDED',
        },
      });
      await Promise.all(
        semantic.findings.map((finding) =>
          tx.validationFinding.create({
            data: {
              organizationId: claimed.organizationId,
              validationRunId: claimed.id,
              assessmentRevisionId: claimed.assessmentRevisionId,
              semanticEvaluationId: evaluation.id,
              kind: 'SEMANTIC',
              code: finding.code,
              category: finding.category,
              severity: finding.severity,
              path: finding.path,
              messageKey: finding.messageKey,
              evidence: finding.evidence as Prisma.InputJsonValue,
              confidenceBasisPoints: finding.confidenceBasisPoints ?? null,
              evaluatorVersion: semantic.evaluatorVersion,
            },
          }),
        ),
      );
    } catch (error) {
      const failureCode =
        error instanceof SemanticEvaluatorFailure ? error.code : 'PERMANENT_EVALUATOR_ERROR';
      await tx.semanticEvaluation.create({
        data: {
          validationRunId: claimed.id,
          evaluatorVersion: semanticEvaluatorRegistry.evaluatorVersion,
          promptVersion: semanticEvaluatorRegistry.promptVersion,
          modelConfigurationVersion: semanticEvaluatorRegistry.modelConfigurationVersion,
          schemaVersion: semanticEvaluatorRegistry.schemaVersion,
          state: 'FAILED',
          failureCode,
        },
      });
      const failedRun = await tx.validationRun.update({
        where: { id: claimed.id },
        data: {
          state: 'FAILED',
          failureCode,
          deterministicPassCount:
            rules.length - results.filter((result) => result.outcome === 'FAIL').length,
          deterministicFailCount: results.filter((result) => result.outcome === 'FAIL').length,
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: claimed.requestingUserId,
          organizationId: claimed.organizationId,
          eventType: 'validation.failed',
          targetType: 'validation_run',
          targetId: claimed.id,
          metadata: { failureCode, deterministicFailCount: failedRun.deterministicFailCount },
        },
      });
      return status(failedRun);
    }
    const failed = results.filter((result) => result.outcome === 'FAIL').length;
    const complete = await tx.validationRun.update({
      where: { id: claimed.id },
      data: {
        state: 'SUCCEEDED',
        failureCode: null,
        deterministicPassCount: rules.length - failed,
        deterministicFailCount: failed,
        semanticFindingCount: await tx.validationFinding.count({
          where: { validationRunId: claimed.id, kind: 'SEMANTIC' },
        }),
        completedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: claimed.requestingUserId,
        organizationId: claimed.organizationId,
        eventType: 'validation.succeeded',
        targetType: 'validation_run',
        targetId: claimed.id,
        metadata: {
          deterministicFailCount: failed,
          semanticFindingCount: complete.semanticFindingCount,
        },
      },
    });
    return status(complete);
  });
}
