import { z } from 'zod';
export const VALIDATION_SCHEMA_VERSION = '1.0.0' as const;
export const validationRunStateSchema = z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED']);
export const validationSeveritySchema = z.enum(['BLOCKING', 'WARNING', 'INFO']);
export const validationFindingKindSchema = z.enum(['DETERMINISTIC', 'SEMANTIC']);
export const validationFailureCodeSchema = z.enum([
  'RULESET_INTEGRITY',
  'DETERMINISTIC_RULE_FAILED',
  'TIMEOUT',
  'TRANSIENT_EXHAUSTED',
  'PERMANENT_EVALUATOR_ERROR',
  'OUTPUT_INVALID',
]);
export const validationReadinessReasonCodeSchema = z.enum([
  'VALIDATION_REQUIRED',
  'VALIDATION_PENDING',
  'VALIDATION_PROCESSING',
  'VALIDATION_FAILED',
  'DETERMINISTIC_BLOCKER',
  'SEMANTIC_BLOCKER',
  'WARNING_ACKNOWLEDGEMENT_REQUIRED',
  'VALIDATION_VERSION_STALE',
  'SOURCE_ELIGIBILITY_CHANGED',
]);
export const semanticCategorySchema = z.enum([
  'HEBREW_CORRECTNESS',
  'AMBIGUITY',
  'ANSWER_VALIDITY',
  'DIFFICULTY_FIT',
  'CURRICULUM_FIT',
  'DUPLICATION',
  'ANSWER_LEAKAGE',
]);
export const validationRuleIdSchema = z.enum([
  'REVISION_FINALIZED_AND_OWNED',
  'STRICT_REVISION_CONTRACT',
  'PLAN_COUNT_KEY_ORDER',
  'CURRICULUM_SCOPE_PUBLISHED',
  'ANSWER_COMPLETENESS_AND_TARGETS',
  'EXACT_SCORE_TREE',
  'STABLE_ID_AND_EXACT_DUPLICATE',
  'DETERMINISTIC_ANSWER_LEAKAGE',
  'SOURCE_LINK_COMPLETENESS_AND_IDENTITY',
  'CURRENT_SOURCE_ELIGIBILITY',
  'GENERATION_REVISION_PROVENANCE',
]);
const detCategory = z.enum([
  'REVISION',
  'CONTRACT',
  'PLAN',
  'CURRICULUM',
  'ANSWER',
  'SCORING',
  'IDENTITY',
  'LEAKAGE',
  'SOURCE',
  'PROVENANCE',
]);
const evidence = z.object({ identity: z.string().min(1), revisionId: z.string().uuid() }).strict();
export const validationRequestSchema = z
  .object({
    version: z.literal(VALIDATION_SCHEMA_VERSION),
    assessmentId: z.string().uuid(),
    assessmentRevisionId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();
const det = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('DETERMINISTIC'),
    code: z.string().min(1),
    category: detCategory,
    severity: z.literal('BLOCKING'),
    path: z.string(),
    messageKey: z.string().min(1),
    evidence,
    confidenceBasisPoints: z.null(),
    ruleVersion: z.string().min(1),
    evaluatorVersion: z.null(),
    schemaVersion: z.null(),
  })
  .strict();
const sem = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('SEMANTIC'),
    code: z.string().min(1),
    category: semanticCategorySchema,
    severity: validationSeveritySchema,
    path: z.string(),
    messageKey: z.string().min(1),
    evidence,
    confidenceBasisPoints: z.number().int().min(0).max(10000).nullable(),
    ruleVersion: z.null(),
    evaluatorVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
  })
  .strict();
export const validationFindingSchema = z.discriminatedUnion('kind', [det, sem]);
const base = z.object({
  version: z.literal(VALIDATION_SCHEMA_VERSION),
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  assessmentRevisionId: z.string().uuid(),
  revisionSequence: z.number().int().positive(),
  rulesetVersion: z.string().min(1),
  evaluatorVersion: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  deterministicPassCount: z.number().int().nonnegative(),
  deterministicFailCount: z.number().int().nonnegative(),
  semanticFindingCount: z.number().int().nonnegative(),
});
export const validationStatusSchema = z.discriminatedUnion('state', [
  base
    .extend({ state: z.literal('PENDING'), failureCode: z.null(), completedAt: z.null() })
    .strict(),
  base
    .extend({ state: z.literal('PROCESSING'), failureCode: z.null(), completedAt: z.null() })
    .strict(),
  base
    .extend({
      state: z.literal('SUCCEEDED'),
      failureCode: z.null(),
      completedAt: z.string().datetime(),
    })
    .strict(),
  base
    .extend({
      state: z.literal('FAILED'),
      failureCode: validationFailureCodeSchema,
      completedAt: z.string().datetime(),
    })
    .strict(),
]);
const evaluation = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('SUCCEEDED'),
      evaluatorVersion: z.string().min(1),
      promptVersion: z.string().min(1),
      modelConfigurationVersion: z.string().min(1),
      schemaVersion: z.string().min(1),
      failureCode: z.null(),
      latencyMs: z.number().int().nonnegative(),
      findingCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      state: z.literal('FAILED'),
      evaluatorVersion: z.string().min(1),
      promptVersion: z.string().min(1),
      modelConfigurationVersion: z.string().min(1),
      schemaVersion: z.string().min(1),
      failureCode: validationFailureCodeSchema,
      latencyMs: z.number().int().nonnegative(),
      findingCount: z.number().int().nonnegative(),
    })
    .strict(),
]);
export const validationResultSchema = z
  .object({
    version: z.literal(VALIDATION_SCHEMA_VERSION),
    status: validationStatusSchema,
    executions: z.array(
      z
        .object({
          ruleId: validationRuleIdSchema,
          ruleVersion: z.string().min(1),
          outcome: z.enum(['PASS', 'FAIL']),
          evidence,
        })
        .strict(),
    ),
    findings: z.array(validationFindingSchema),
    semanticEvaluation: evaluation.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    for (const execution of v.executions)
      if (
        execution.evidence.identity !== execution.ruleId ||
        execution.evidence.revisionId !== v.status.assessmentRevisionId
      )
        c.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'execution evidence identity mismatch',
        });
    for (const finding of v.findings)
      if (
        finding.evidence.identity !== finding.code ||
        finding.evidence.revisionId !== v.status.assessmentRevisionId
      )
        c.addIssue({ code: z.ZodIssueCode.custom, message: 'finding evidence identity mismatch' });
    if (v.status.state !== 'SUCCEEDED') return;
    const p = v.executions.filter((x) => x.outcome === 'PASS').length,
      s = v.findings.filter((x) => x.kind === 'SEMANTIC').length;
    if (
      v.executions.length !== 11 ||
      JSON.stringify(v.executions.map((x) => x.ruleId)) !==
        JSON.stringify(validationRuleIdSchema.options) ||
      v.status.deterministicPassCount !== p ||
      v.status.deterministicFailCount !== 11 - p ||
      !v.semanticEvaluation ||
      v.semanticEvaluation.state !== 'SUCCEEDED' ||
      v.semanticEvaluation.findingCount !== s ||
      v.status.semanticFindingCount !== s
    )
      c.addIssue({ code: z.ZodIssueCode.custom, message: 'succeeded result identity mismatch' });
  });
export const validationReadinessSchema = z.discriminatedUnion('status', [
  z
    .object({
      version: z.literal(VALIDATION_SCHEMA_VERSION),
      status: z.literal('READY'),
      reasonCode: z.null(),
      validationRunId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      version: z.literal(VALIDATION_SCHEMA_VERSION),
      status: z.literal('BLOCKED'),
      reasonCode: validationReadinessReasonCodeSchema,
      validationRunId: z.string().uuid().nullable(),
    })
    .strict(),
]);
export const validationAcknowledgementSchema = z
  .object({
    version: z.literal(VALIDATION_SCHEMA_VERSION),
    findingId: z.string().uuid(),
    reason: z.string().min(1).max(1000),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();
export const validationAcknowledgementResultSchema = z
  .object({
    version: z.literal(VALIDATION_SCHEMA_VERSION),
    acknowledgementId: z.string().uuid(),
    findingId: z.string().uuid(),
  })
  .strict();
