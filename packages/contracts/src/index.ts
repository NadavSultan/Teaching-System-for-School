import { z } from 'zod';
export { z } from 'zod';
export * from './phase50.js';

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
const finalizedAnswerSchema = answerSchema.extend({ id: uuidSchema });
const finalizedRubricSchema = rubricCriterionSchema.extend({ id: uuidSchema });
const finalizedSubQuestionSchema = subQuestionSchema.omit({ answers: true, rubrics: true }).extend({
  id: uuidSchema,
  answers: z.array(finalizedAnswerSchema),
  rubrics: z.array(finalizedRubricSchema),
});
const finalizedQuestionSchema = questionSchema
  .omit({ answers: true, rubrics: true, subQuestions: true })
  .extend({
    id: uuidSchema,
    answers: z.array(finalizedAnswerSchema),
    rubrics: z.array(finalizedRubricSchema),
    subQuestions: z.array(finalizedSubQuestionSchema),
  });
const finalizedSectionSchema = sectionSchema
  .omit({ questions: true })
  .extend({ id: uuidSchema, questions: z.array(finalizedQuestionSchema) });
export const finalizedAssessmentRevisionSchema = z.object({
  version: z.literal(ASSESSMENT_SCHEMA_VERSION),
  id: uuidSchema,
  assessmentId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  curriculumVersionId: uuidSchema,
  scoringMode: scoringModeSchema,
  totalScoreUnits: z.number().int().nonnegative().max(1000000).nullable(),
  finalized: z.literal(true),
  curriculumNodeIds: z.array(uuidSchema),
  sections: z.array(finalizedSectionSchema),
});
export type CurriculumImport = z.infer<typeof curriculumImportSchema>;
export type AssessmentRevisionInput = z.infer<typeof assessmentRevisionSchema>;

export const SOURCE_SCHEMA_VERSION = '1.0.0' as const;
export const sourceVisibilitySchema = z.enum(['PLATFORM_SHARED', 'ORGANIZATION_PRIVATE']);
export const sourceLifecycleSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
  'DEPRECATED',
  'FAILED',
  'NEEDS_RE_REVIEW',
]);
export const reviewDecisionSchema = z.enum(['APPROVED', 'REJECTED']);
export const usagePermissionDecisionSchema = z.enum(['ALLOWED', 'DENIED']);
const boundedMetadataSchema = z
  .record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()]))
  .refine((value) => Object.keys(value).length <= 30);
export const sourceCreationSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    title: z.string().min(1).max(200),
    visibility: sourceVisibilitySchema,
    origin: z.string().min(1).max(120),
    metadata: boundedMetadataSchema.default({}),
  })
  .strict();
export const sourceSummarySchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    id: uuidSchema,
    title: z.string().min(1).max(200),
    visibility: sourceVisibilitySchema,
    organizationId: uuidSchema.nullable(),
    lifecycle: sourceLifecycleSchema,
  })
  .strict();
export const sourceVersionRegistrationSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    sourceId: uuidSchema,
    idempotencyKey: z.string().min(1).max(255),
    content: z.string().min(1).max(1000000),
    contentReference: z.string().min(1).max(1000),
    contentMimeType: z.string().min(1).max(120),
    metadata: boundedMetadataSchema.default({}),
    curriculumVersionId: uuidSchema,
    curriculumNodeIds: z.array(uuidSchema).min(1).max(1000),
  })
  .strict();
export const sourceVersionSummarySchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    id: uuidSchema,
    sourceId: uuidSchema,
    versionNumber: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    lifecycle: sourceLifecycleSchema,
  })
  .strict();
export const pedagogicalReviewDecisionSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    sourceVersionId: uuidSchema,
    decision: reviewDecisionSchema,
    reason: z.string().min(1).max(1000),
    evidenceMetadata: boundedMetadataSchema.default({}),
  })
  .strict();
export const usagePermissionDecisionContractSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    sourceVersionId: uuidSchema,
    decision: usagePermissionDecisionSchema,
    evidenceReference: z.string().min(1).max(1000),
    scope: z.string().min(1).max(200),
    validUntil: z.string().datetime().nullable().optional(),
  })
  .strict();
export const ingestionRequestSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    sourceVersionId: uuidSchema,
    pipelineVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  })
  .strict();
export const ingestionStatusSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    id: uuidSchema,
    sourceVersionId: uuidSchema,
    status: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED']),
    attempts: z.number().int().nonnegative(),
    failureClass: z.string().max(120).nullable(),
  })
  .strict();
export const eligibleKnowledgeItemSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    id: uuidSchema,
    sourceVersionId: uuidSchema,
    locator: z.string().min(1).max(500),
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: boundedMetadataSchema,
    score: z.number(),
    rank: z.number().int().positive(),
    curriculumVersionId: uuidSchema,
    curriculumNodeId: uuidSchema,
    visibility: sourceVisibilitySchema,
  })
  .strict();
export const retrievalRequestSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    query: z.string().max(500),
    organizationId: uuidSchema,
    curriculumVersionId: uuidSchema,
    curriculumNodeIds: z.array(uuidSchema).max(1000),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const retrievalResultSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    items: z.array(eligibleKnowledgeItemSchema).max(50),
  })
  .strict();
export const knowledgeItemProvenanceSchema = z
  .object({
    version: z.literal(SOURCE_SCHEMA_VERSION),
    id: uuidSchema,
    sourceVersionId: uuidSchema,
    locator: z.string().min(1).max(500),
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: boundedMetadataSchema,
    pipelineVersion: z.string().max(80),
    parserVersion: z.string().max(80),
    visibility: sourceVisibilitySchema,
    curriculumLineage: z
      .array(z.object({ curriculumVersionId: uuidSchema, curriculumNodeId: uuidSchema }).strict())
      .min(1)
      .max(1000),
  })
  .strict();

export const GENERATION_SCHEMA_VERSION = '1.0.0' as const;
export const generationOperationSchema = z.enum(['DRAFT', 'REGENERATE_QUESTION']);
export const generationRunStateSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'INSUFFICIENT_CONTEXT',
  'FAILED',
]);
export const generationFailureCodeSchema = z.enum([
  'CONTEXT_EMPTY',
  'TIMEOUT',
  'RATE_LIMITED',
  'TRANSIENT_EXHAUSTED',
  'PERMANENT_PROVIDER_ERROR',
  'SCHEMA_INVALID',
  'OUTPUT_INVALID',
  'CONTEXT_INVALIDATED',
  'BUDGET_EXCEEDED',
  'CONFIGURATION_ERROR',
]);
export const generationQuestionTypeSchema = z.string().regex(/^[A-Z][A-Z0-9_-]{0,63}$/);
export const generationQuestionPlanSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/),
    order: z.number().int().nonnegative().max(1000),
    type: generationQuestionTypeSchema,
    difficulty: difficultyBandSchema,
    scoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
    instructions: z.string().max(5000).default(''),
    emphasis: z.string().max(500).default(''),
  })
  .strict();
export const generationSectionPlanSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/),
    title: z.string().min(1).max(200),
    order: z.number().int().nonnegative().max(1000),
    instructions: z.string().max(5000).default(''),
    scoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
    questions: z.array(generationQuestionPlanSchema).min(1).max(100),
  })
  .strict();
export const draftGenerationRequestSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    assessmentId: uuidSchema,
    idempotencyKey: z.string().min(1).max(255),
    curriculumVersionId: uuidSchema,
    curriculumNodeIds: z.array(uuidSchema).min(1).max(100),
    scoringMode: scoringModeSchema,
    totalScoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
    query: z.string().trim().min(1).max(500),
    instructions: z.string().max(5000).default(''),
    sections: z.array(generationSectionPlanSchema).min(1).max(20),
  })
  .strict();
export const questionRegenerationRequestSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    assessmentId: uuidSchema,
    baseRevisionId: uuidSchema,
    targetQuestionId: uuidSchema,
    idempotencyKey: z.string().min(1).max(255),
    instruction: z.string().min(1).max(5000),
    query: z.string().trim().min(1).max(500),
  })
  .strict();
export const frozenGenerationSpecificationSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    operation: generationOperationSchema,
    assessmentId: uuidSchema,
    curriculumVersionId: uuidSchema,
    curriculumNodeIds: z.array(uuidSchema).min(1).max(100),
    assessmentType: assessmentTypeSchema,
    assessmentTitle: z.string().min(1).max(200),
    scoringMode: scoringModeSchema,
    totalScoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
    query: z.string().min(1).max(500),
    instructions: z.string().max(5000),
    sections: z.array(generationSectionPlanSchema).min(1).max(20),
    baseRevisionId: uuidSchema.nullable(),
    targetQuestionId: uuidSchema.nullable(),
    regenerationInstruction: z.string().max(5000),
  })
  .strict();
const generatedAnswerContentSchema = z
  .object({
    key: z.string().min(1).max(100),
    order: z.number().int().nonnegative().max(1000),
    text: z.string().min(1).max(10000),
    data: z.record(z.unknown()).optional(),
    explanation: z.string().max(10000).optional(),
  })
  .strict();
const generatedRubricContentSchema = z
  .object({
    key: z.string().min(1).max(100),
    description: z.string().min(1).max(2000),
    order: z.number().int().nonnegative().max(1000),
    scoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
  })
  .strict();
const generatedSubQuestionContentSchema = z
  .object({
    key: z.string().min(1).max(100),
    prompt: z.string().min(1).max(10000),
    order: z.number().int().nonnegative().max(1000),
    scoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
    answers: z.array(generatedAnswerContentSchema).max(100),
    rubrics: z.array(generatedRubricContentSchema).max(100),
  })
  .strict();
export const generatedQuestionContentSchema = z
  .object({
    prompt: z.string().min(1).max(20000),
    instructions: z.string().max(5000).optional(),
    answers: z.array(generatedAnswerContentSchema).max(100),
    rubrics: z.array(generatedRubricContentSchema).max(100),
    subQuestions: z.array(generatedSubQuestionContentSchema).max(100),
  })
  .strict();
export const generatedDraftOutputSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    sections: z.array(
      z
        .object({
          key: z.string().min(1).max(100),
          order: z.number().int().nonnegative().max(1000),
          questions: z.array(
            z
              .object({
                key: z.string().min(1).max(100),
                order: z.number().int().nonnegative().max(1000),
                type: generationQuestionTypeSchema,
                difficulty: difficultyBandSchema,
                scoreUnits: z.number().int().nonnegative().max(1_000_000).nullable(),
                content: generatedQuestionContentSchema,
                citations: z.array(uuidSchema).min(1).max(100),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export const generatedQuestionOutputSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    content: generatedQuestionContentSchema,
    citations: z.array(uuidSchema).min(1).max(100),
  })
  .strict();
export const generationContextItemSchema = z
  .object({
    knowledgeItemId: uuidSchema,
    sourceVersionId: uuidSchema,
    locator: z.string().min(1).max(500),
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    curriculumVersionId: uuidSchema,
    curriculumNodeId: uuidSchema,
    rank: z.number().int().positive(),
    score: z.number().nonnegative(),
    text: z.string().min(1).max(30000),
    characterCount: z.number().int().positive().max(30000),
    estimatedTokens: z.number().int().positive().max(10000),
    lineage: z
      .array(z.object({ curriculumVersionId: uuidSchema, curriculumNodeId: uuidSchema }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const generationContextProvenanceSchema = generationContextItemSchema.omit({ text: true });
export const generationStatusSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    id: uuidSchema,
    assessmentId: uuidSchema,
    operation: generationOperationSchema,
    state: generationRunStateSchema,
    attempts: z.number().int().nonnegative(),
    failureCode: generationFailureCodeSchema.nullable(),
    outputRevisionId: uuidSchema.nullable(),
  })
  .strict();
export const generationResultSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    status: generationStatusSchema,
    context: z.array(generationContextProvenanceSchema),
    revision: finalizedAssessmentRevisionSchema.nullable(),
  })
  .strict();
export const generationUsageSchema = z
  .object({
    version: z.literal(GENERATION_SCHEMA_VERSION),
    attempt: z.number().int().positive(),
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    requestId: z.string().min(1).max(255),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costMicros: z.number().int().nonnegative(),
    finishReason: z.string().min(1).max(80),
  })
  .strict();
