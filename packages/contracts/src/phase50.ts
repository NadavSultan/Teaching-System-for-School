import { z } from 'zod';

export const VALIDATION_SCHEMA_VERSION = '1.0.0' as const;
export const validationRunStateSchema = z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED']);
export const validationSeveritySchema = z.enum(['BLOCKING', 'WARNING', 'INFO']);
export const validationFindingKindSchema = z.enum(['DETERMINISTIC', 'SEMANTIC']);
export const semanticCategorySchema = z.enum([
  'HEBREW_CORRECTNESS', 'AMBIGUITY', 'ANSWER_VALIDITY', 'DIFFICULTY_FIT',
  'CURRICULUM_FIT', 'DUPLICATION', 'ANSWER_LEAKAGE',
]);
export const validationRequestSchema = z.object({
  version: z.literal(VALIDATION_SCHEMA_VERSION), assessmentId: z.string().uuid(),
  assessmentRevisionId: z.string().uuid(), idempotencyKey: z.string().min(1).max(255),
}).strict();
export const validationFindingSchema = z.object({
  id: z.string().uuid(), kind: validationFindingKindSchema, code: z.string().min(1).max(120),
  category: z.string().min(1).max(120), severity: validationSeveritySchema,
  path: z.string().max(500), messageKey: z.string().min(1).max(160), evidence: z.record(z.unknown()),
}).strict();
export const validationStatusSchema = z.object({
  version: z.literal(VALIDATION_SCHEMA_VERSION), id: z.string().uuid(), assessmentId: z.string().uuid(),
  assessmentRevisionId: z.string().uuid(), revisionSequence: z.number().int().positive(),
  state: validationRunStateSchema, attempts: z.number().int().nonnegative(), failureCode: z.string().nullable(),
}).strict();
export const validationResultSchema = z.object({
  version: z.literal(VALIDATION_SCHEMA_VERSION), status: validationStatusSchema,
  executions: z.array(z.object({ ruleId: z.string(), ruleVersion: z.string(), outcome: z.enum(['PASS', 'FAIL']) }).strict()),
  findings: z.array(validationFindingSchema), semanticEvaluation: z.object({ state: z.enum(['SUCCEEDED', 'FAILED']), evaluatorVersion: z.string() }).nullable(),
}).strict();
export const validationReadinessSchema = z.object({
  version: z.literal(VALIDATION_SCHEMA_VERSION), status: z.enum(['READY', 'BLOCKED']),
  reasonCode: z.string().nullable(), validationRunId: z.string().uuid().nullable(),
}).strict();
export const validationAcknowledgementSchema = z.object({
  version: z.literal(VALIDATION_SCHEMA_VERSION), findingId: z.string().uuid(),
  reason: z.string().min(1).max(1000), idempotencyKey: z.string().min(1).max(255),
}).strict();
