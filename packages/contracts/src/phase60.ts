import { z } from 'zod';
import { validationReadinessSchema, validationStatusSchema } from './phase50.js';

export const PHASE60_SCHEMA_VERSION = '1.0.0' as const;
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const version = z.literal(PHASE60_SCHEMA_VERSION);
const uuidSchema = z.string().uuid();
const revisionNumber = z.number().int().positive();
const order = z.number().int().min(0).max(1_000_000);
const scoreUnits = z.number().int().nonnegative().max(1_000_000).nullable();

const assessmentTypeSchema = z.enum(['WORKSHEET', 'TEST']);
const teacherAnswerSchema = z
  .object({
    id: uuidSchema,
    key: boundedText(100),
    order,
    text: z.string().trim().max(10_000),
    explanation: z.string().trim().max(10_000).nullable(),
  })
  .strict();
const teacherRubricSchema = z
  .object({
    id: uuidSchema,
    key: boundedText(100),
    description: boundedText(2_000),
    order,
    scoreUnits,
  })
  .strict();
const teacherSubQuestionSchema = z
  .object({
    id: uuidSchema,
    key: boundedText(100),
    prompt: boundedText(10_000),
    order,
    scoreUnits,
    answers: z.array(teacherAnswerSchema).max(100),
    rubrics: z.array(teacherRubricSchema).max(100),
  })
  .strict();
const teacherQuestionSchema = z
  .object({
    id: uuidSchema,
    logicalId: uuidSchema,
    key: boundedText(100),
    type: boundedText(64),
    prompt: boundedText(20_000),
    instructions: z.string().trim().max(5_000).nullable(),
    order,
    scoreUnits,
    answers: z.array(teacherAnswerSchema).max(100),
    rubrics: z.array(teacherRubricSchema).max(100),
    subQuestions: z.array(teacherSubQuestionSchema).max(100),
  })
  .strict();
const teacherSectionSchema = z
  .object({
    id: uuidSchema,
    key: boundedText(100),
    title: boundedText(200),
    instructions: z.string().trim().max(5_000).nullable(),
    order,
    scoreUnits,
    questions: z.array(teacherQuestionSchema).max(1_000),
  })
  .strict();
const teacherRevisionSchema = z
  .object({
    version: z.literal('1.0.0'),
    id: uuidSchema,
    assessmentId: uuidSchema,
    revisionNumber,
    curriculumVersionId: uuidSchema,
    scoringMode: z.enum(['NONE', 'POINTS']),
    totalScoreUnits: scoreUnits,
    finalized: z.literal(true),
    curriculumNodeIds: z.array(uuidSchema).max(1_000),
    sections: z.array(teacherSectionSchema).max(100),
  })
  .strict();

export const teacherAssessmentListItemSchema = z
  .object({
    version: z.literal('1.0.0'),
    id: uuidSchema,
    type: assessmentTypeSchema,
    title: boundedText(200),
    latestRevisionNumber: revisionNumber.nullable(),
    latestRevisionId: uuidSchema.nullable(),
    latestApprovalRevisionId: uuidSchema.nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const teacherAssessmentListResponseSchema = z
  .object({
    version,
    items: z.array(teacherAssessmentListItemSchema).max(100),
    nextCursor: z.string().max(500).nullable(),
  })
  .strict();

export const teacherRevisionHistoryItemSchema = z
  .object({
    id: uuidSchema,
    assessmentId: uuidSchema,
    revisionNumber,
    baseRevisionId: uuidSchema.nullable(),
    createdAt: z.string().datetime(),
    approvedAt: z.string().datetime().nullable(),
    isLatest: z.boolean(),
  })
  .strict();

export const teacherWorkspaceSchema = z
  .object({
    version,
    assessment: teacherAssessmentListItemSchema,
    revision: teacherRevisionSchema.extend({ baseRevisionId: uuidSchema.nullable() }).strict(),
    history: z.array(teacherRevisionHistoryItemSchema).max(1000),
    validation: validationStatusSchema.nullable(),
    readiness: validationReadinessSchema,
    approval: z
      .object({
        version,
        assessmentRevisionId: uuidSchema,
        approved: z.boolean(),
        approvalId: uuidSchema.nullable(),
        approvalSequence: revisionNumber.nullable(),
      })
      .strict(),
  })
  .strict();

const editorAnswerSchema = z
  .object({
    key: boundedText(100),
    order,
    text: z.string().trim().max(10_000),
    explanation: z.string().trim().max(10_000).nullable().optional(),
  })
  .strict();
const editorRubricSchema = z
  .object({ key: boundedText(100), order, description: boundedText(2_000), scoreUnits })
  .strict();
const editorSubQuestionSchema = z
  .object({
    key: boundedText(100),
    prompt: boundedText(10_000),
    order,
    scoreUnits,
    answers: z.array(editorAnswerSchema).max(100),
    rubrics: z.array(editorRubricSchema).max(100),
  })
  .strict();
const editorQuestionSchema = z
  .object({
    logicalId: uuidSchema.optional(),
    key: boundedText(100),
    type: boundedText(64),
    prompt: boundedText(20_000),
    instructions: z.string().trim().max(5_000).nullable().optional(),
    order,
    scoreUnits,
    answers: z.array(editorAnswerSchema).max(100),
    rubrics: z.array(editorRubricSchema).max(100),
    subQuestions: z.array(editorSubQuestionSchema).max(100),
  })
  .strict();
const editorSectionSchema = z
  .object({
    key: boundedText(100),
    title: boundedText(200),
    instructions: z.string().trim().max(5_000).nullable().optional(),
    order,
    scoreUnits,
    questions: z.array(editorQuestionSchema).min(1).max(1_000),
  })
  .strict();

export const editorSaveRequestSchema = z
  .object({
    version,
    assessmentId: uuidSchema,
    baseRevisionId: uuidSchema,
    baseRevisionNumber: revisionNumber,
    idempotencyKey: boundedText(255),
    sections: z.array(editorSectionSchema).min(1).max(100),
  })
  .strict();
export const editorSaveResultSchema = z
  .object({
    version,
    assessmentId: uuidSchema,
    revisionId: uuidSchema,
    revisionNumber,
    baseRevisionId: uuidSchema,
  })
  .strict();

export const teacherQuestionRegenerationRequestSchema = z
  .object({
    version,
    assessmentId: uuidSchema,
    baseRevisionId: uuidSchema,
    logicalQuestionId: uuidSchema,
    idempotencyKey: boundedText(255),
  })
  .strict();
export const teacherQuestionRegenerationStatusSchema = z
  .object({
    version,
    generationRunId: uuidSchema,
    state: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED']),
  })
  .strict();
export const teacherQuestionRegenerationResultSchema = z
  .object({
    version,
    generationRunId: uuidSchema,
    outputRevisionId: uuidSchema.nullable(),
    logicalQuestionId: uuidSchema,
  })
  .strict();

export const studentSafePreviewSchema = z
  .object({
    version,
    assessmentId: uuidSchema,
    revisionId: uuidSchema,
    title: boundedText(200),
    sections: z
      .array(
        z
          .object({
            title: boundedText(200),
            order,
            questions: z
              .array(
                z
                  .object({
                    logicalId: uuidSchema,
                    prompt: boundedText(20_000),
                    instructions: z.string().trim().max(5_000).nullable(),
                    order,
                    scoreUnits,
                  })
                  .strict(),
              )
              .max(1_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const approvalRequestSchema = z
  .object({
    version,
    assessmentId: uuidSchema,
    assessmentRevisionId: uuidSchema,
    idempotencyKey: boundedText(255),
  })
  .strict();
export const approvalResultSchema = z
  .object({
    version,
    approvalId: uuidSchema,
    assessmentId: uuidSchema,
    assessmentRevisionId: uuidSchema,
    validationRunId: uuidSchema,
    approvalSequence: revisionNumber,
    createdAt: z.string().datetime(),
  })
  .strict();
export const approvalStatusSchema = z
  .object({
    version,
    assessmentRevisionId: uuidSchema,
    approved: z.boolean(),
    approvalId: uuidSchema.nullable(),
    approvalSequence: revisionNumber.nullable(),
  })
  .strict();

export type EditorSaveRequest = z.infer<typeof editorSaveRequestSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
