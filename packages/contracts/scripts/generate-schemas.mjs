import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  apiErrorSchema,
  authenticatedPrincipalSchema,
  healthSchema,
  membershipSummarySchema,
  organizationSummarySchema,
  workspaceContextSchema,
  curriculumImportSchema,
  publishedCurriculumSchema,
  assessmentCreationSchema,
  assessmentRevisionSchema,
  assessmentSummarySchema,
  finalizedAssessmentRevisionSchema,
  scoreValidationResultSchema,
  sourceCreationSchema,
  sourceSummarySchema,
  sourceVersionRegistrationSchema,
  sourceVersionSummarySchema,
  pedagogicalReviewDecisionSchema,
  usagePermissionDecisionContractSchema,
  ingestionRequestSchema,
  ingestionStatusSchema,
  eligibleKnowledgeItemSchema,
  knowledgeItemProvenanceSchema,
  retrievalRequestSchema,
  retrievalResultSchema,
  draftGenerationRequestSchema,
  questionRegenerationRequestSchema,
  frozenGenerationSpecificationSchema,
  generatedDraftOutputSchema,
  generatedQuestionOutputSchema,
  generationStatusSchema,
  generationResultSchema,
  generationContextItemSchema,
  generationContextProvenanceSchema,
  generationUsageSchema,
} from '../dist/index.js';

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const schemas = [
  ['authenticated-principal.v1.json', authenticatedPrincipalSchema, 'AuthenticatedPrincipalV1'],
  ['health-readiness.v1.json', healthSchema, 'HealthReadinessV1'],
  ['organization-summary.v1.json', organizationSummarySchema, 'OrganizationSummaryV1'],
  ['membership-summary.v1.json', membershipSummarySchema, 'MembershipSummaryV1'],
  ['workspace-context.v1.json', workspaceContextSchema, 'WorkspaceContextV1'],
  ['api-error.v1.json', apiErrorSchema, 'ApiErrorV1'],
  ['curriculum-import.v1.json', curriculumImportSchema, 'CurriculumImportV1'],
  ['published-curriculum.v1.json', publishedCurriculumSchema, 'PublishedCurriculumV1'],
  ['assessment-creation.v1.json', assessmentCreationSchema, 'AssessmentCreationV1'],
  ['assessment-summary.v1.json', assessmentSummarySchema, 'AssessmentSummaryV1'],
  ['assessment-revision.v1.json', assessmentRevisionSchema, 'AssessmentRevisionV1'],
  [
    'finalized-assessment-revision.v1.json',
    finalizedAssessmentRevisionSchema,
    'FinalizedAssessmentRevisionV1',
  ],
  ['score-validation-result.v1.json', scoreValidationResultSchema, 'ScoreValidationResultV1'],
  ['source-creation.v1.json', sourceCreationSchema, 'SourceCreationV1'],
  ['source-summary.v1.json', sourceSummarySchema, 'SourceSummaryV1'],
  [
    'source-version-registration.v1.json',
    sourceVersionRegistrationSchema,
    'SourceVersionRegistrationV1',
  ],
  ['source-version-summary.v1.json', sourceVersionSummarySchema, 'SourceVersionSummaryV1'],
  [
    'pedagogical-review-decision.v1.json',
    pedagogicalReviewDecisionSchema,
    'PedagogicalReviewDecisionV1',
  ],
  [
    'usage-permission-decision.v1.json',
    usagePermissionDecisionContractSchema,
    'UsagePermissionDecisionV1',
  ],
  ['ingestion-request.v1.json', ingestionRequestSchema, 'IngestionRequestV1'],
  ['ingestion-status.v1.json', ingestionStatusSchema, 'IngestionStatusV1'],
  ['eligible-knowledge-item.v1.json', eligibleKnowledgeItemSchema, 'EligibleKnowledgeItemV1'],
  ['knowledge-item-provenance.v1.json', knowledgeItemProvenanceSchema, 'KnowledgeItemProvenanceV1'],
  ['retrieval-request.v1.json', retrievalRequestSchema, 'RetrievalRequestV1'],
  ['retrieval-result.v1.json', retrievalResultSchema, 'RetrievalResultV1'],
  ['draft-generation-request.v1.json', draftGenerationRequestSchema, 'DraftGenerationRequestV1'],
  [
    'question-regeneration-request.v1.json',
    questionRegenerationRequestSchema,
    'QuestionRegenerationRequestV1',
  ],
  [
    'frozen-generation-specification.v1.json',
    frozenGenerationSpecificationSchema,
    'FrozenGenerationSpecificationV1',
  ],
  ['generated-draft-output.v1.json', generatedDraftOutputSchema, 'GeneratedDraftOutputV1'],
  ['generated-question-output.v1.json', generatedQuestionOutputSchema, 'GeneratedQuestionOutputV1'],
  ['generation-status.v1.json', generationStatusSchema, 'GenerationStatusV1'],
  ['generation-result.v1.json', generationResultSchema, 'GenerationResultV1'],
  ['generation-context-item.v1.json', generationContextItemSchema, 'GenerationContextItemV1'],
  [
    'generation-context-provenance.v1.json',
    generationContextProvenanceSchema,
    'GenerationContextProvenanceV1',
  ],
  ['generation-usage.v1.json', generationUsageSchema, 'GenerationUsageV1'],
];
let drift = false;
for (const [file, schema, name] of schemas) {
  const generated = `${JSON.stringify(zodToJsonSchema(schema, { name, target: 'jsonSchema7' }), null, 2)}\n`;
  const path = join(outputDirectory, file);
  if (process.argv.includes('--check')) {
    try {
      if (readFileSync(path, 'utf8') !== generated) drift = true;
    } catch {
      drift = true;
    }
  } else writeFileSync(path, generated, 'utf8');
}
if (drift) {
  console.error(
    'Contract JSON Schema snapshots are missing or stale. Run pnpm contracts:generate.',
  );
  process.exitCode = 1;
}
