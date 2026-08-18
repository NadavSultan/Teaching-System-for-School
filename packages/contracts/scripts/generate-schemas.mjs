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
