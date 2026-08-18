import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0' as const;
export const uuidSchema = z.string().uuid();

export const healthSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  status: z.enum(['ok', 'unavailable']),
  service: z.string().min(1),
  requestId: z.string().min(1),
  checks: z.record(z.enum(['ok', 'unavailable'])).optional(),
});

export const roleSchema = z.enum(['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN']);
export const membershipSummarySchema = z.object({
  organizationId: uuidSchema,
  role: roleSchema,
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
export const organizationSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  workspaceType: z.enum(['PERSONAL', 'SCHOOL']),
});
export const authenticatedPrincipalSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  userId: uuidSchema,
  email: z.string().email(),
  provider: z.string().min(1),
  providerSubject: z.string().min(1),
  platformAdmin: z.boolean(),
});
export const workspaceContextSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  principal: authenticatedPrincipalSchema,
  organization: organizationSummarySchema,
  membership: membershipSummarySchema,
});
export const apiErrorSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

export type AuthenticatedPrincipal = z.infer<typeof authenticatedPrincipalSchema>;
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const CURRICULUM_SCHEMA_VERSION = '1.0.0' as const;
export const ASSESSMENT_SCHEMA_VERSION = '1.0.0' as const;
export const nodeTypeSchema = z.enum(['GRADE', 'DOMAIN', 'TOPIC', 'SUBTOPIC', 'SKILL']);
export const difficultyBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type CurriculumNode = {
  id?: string | undefined;
  code: string;
  type: z.infer<typeof nodeTypeSchema>;
  label: string;
  description?: string | undefined;
  sortOrder: number;
  difficulties?: z.infer<typeof difficultyBandSchema>[] | undefined;
  children?: CurriculumNode[] | undefined;
};
export const curriculumNodeSchema: z.ZodType<CurriculumNode> = z.object({
  id: uuidSchema.optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  type: nodeTypeSchema,
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).max(100000),
  difficulties: z.array(difficultyBandSchema).max(3).optional(),
  children: z.lazy(() => z.array(curriculumNodeSchema).max(1000)).optional(),
});
export const curriculumImportSchema = z
  .object({
    version: z.literal(CURRICULUM_SCHEMA_VERSION),
    curriculumId: uuidSchema.optional(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    educationSystemCode: z.string().min(1).max(64),
    subjectCode: z.string().min(1).max(64),
    displayName: z.string().min(1).max(200),
    versionNumber: z.number().int().positive(),
    humanLabel: z.string().max(200).optional(),
    nodes: z.array(curriculumNodeSchema).min(1).max(10000),
  })
  .strict();
export const curriculumNodeResponseSchema: z.ZodType<CurriculumNode & { id: string }> = z.object({
  id: uuidSchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  type: nodeTypeSchema,
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).max(100000),
  difficulties: z.array(difficultyBandSchema).max(3).optional(),
  children: z.lazy(() => z.array(curriculumNodeResponseSchema).max(1000)).optional(),
});
export const publishedCurriculumSchema = z.object({
  version: z.literal(CURRICULUM_SCHEMA_VERSION),
  id: uuidSchema,
  curriculumId: uuidSchema,
  versionNumber: z.number().int().positive(),
  status: z.literal('PUBLISHED'),
  nodes: z.array(curriculumNodeResponseSchema),
});

export const scoringModeSchema = z.enum(['NONE', 'POINTS']);
export const assessmentTypeSchema = z.enum(['WORKSHEET', 'TEST']);
export const answerSchema = z.object({
  key: z.string().min(1).max(100),
  order: z.number().int().min(0).max(1000),
  text: z.string().max(10000),
  data: z.record(z.unknown()).optional(),
  explanation: z.string().max(10000).optional(),
});
export const rubricCriterionSchema = z.object({
  key: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  order: z.number().int().min(0),
  scoreUnits: z.number().int().nonnegative().max(1000000).nullable().optional(),
});
export const subQuestionSchema = z.object({
  key: z.string().min(1).max(100),
  prompt: z.string().min(1).max(10000),
  order: z.number().int().min(0),
  scoreUnits: z.number().int().nonnegative().max(1000000).nullable().optional(),
  answers: z.array(answerSchema).max(100),
  rubrics: z.array(rubricCriterionSchema).max(100),
});
export const questionSchema = z.object({
  key: z.string().min(1).max(100),
  type: z.string().min(1).max(64),
  prompt: z.string().min(1).max(20000),
  instructions: z.string().max(5000).optional(),
  order: z.number().int().min(0),
  difficulty: difficultyBandSchema.optional(),
  scoreUnits: z.number().int().nonnegative().max(1000000).nullable().optional(),
  subQuestions: z.array(subQuestionSchema).max(100),
  answers: z.array(answerSchema).max(100),
  rubrics: z.array(rubricCriterionSchema).max(100),
});
export const sectionSchema = z.object({
  key: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  instructions: z.string().max(5000).optional(),
  order: z.number().int().min(0),
  scoreUnits: z.number().int().nonnegative().max(1000000).nullable().optional(),
  questions: z.array(questionSchema).max(1000),
});
export const assessmentCreationSchema = z
  .object({
    version: z.literal(ASSESSMENT_SCHEMA_VERSION),
    type: assessmentTypeSchema,
    title: z.string().min(1).max(200),
  })
  .strict();
export const assessmentRevisionSchema = z
  .object({
    version: z.literal(ASSESSMENT_SCHEMA_VERSION),
    assessmentId: uuidSchema,
    idempotencyKey: z.string().min(1).max(255),
    curriculumVersionId: uuidSchema,
    scoringMode: scoringModeSchema,
    totalScoreUnits: z.number().int().nonnegative().max(1000000).nullable().optional(),
    curriculumNodeIds: z.array(uuidSchema).max(1000),
    sections: z.array(sectionSchema).min(1).max(100),
  })
  .strict();
export const scoreValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
});
export const assessmentSummarySchema = z.object({
  version: z.literal(ASSESSMENT_SCHEMA_VERSION),
  id: uuidSchema,
  type: assessmentTypeSchema,
  title: z.string().min(1).max(200),
  latestRevisionNumber: z.number().int().positive().nullable(),
});
export const finalizedAssessmentRevisionSchema = assessmentRevisionSchema
  .omit({ assessmentId: true, idempotencyKey: true })
  .extend({
    id: uuidSchema,
    assessmentId: uuidSchema,
    revisionNumber: z.number().int().positive(),
    finalized: z.literal(true),
  });
export type CurriculumImport = z.infer<typeof curriculumImportSchema>;
export type AssessmentRevisionInput = z.infer<typeof assessmentRevisionSchema>;
