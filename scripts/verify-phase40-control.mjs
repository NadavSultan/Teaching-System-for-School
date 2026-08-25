import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const required = [
  'packages/db/prisma/migrations/20260824004000_phase40_generation_engine/migration.sql',
  'packages/db/prisma/migrations/20260824004100_phase40_review_remediation/migration.sql',
  'packages/db/prisma/migrations/20260824004200_phase40_final_review_closure/migration.sql',
  'packages/db/prisma/migrations/20260824004300_phase40_acceptance_closure/migration.sql',
  'packages/db/prisma/migrations/20260824004400_phase40_complete_output_graph/migration.sql',
  'packages/db/prisma/migrations/20260824004500_phase40_exact_output_graph/migration.sql',
  'packages/db/src/phase40.acceptance.registry.ts',
  'packages/db/src/phase40.tenant-matrix.integration.test.ts',
  'packages/db/src/phase40.role-state-matrix.integration.test.ts',
  'packages/db/src/phase40.eligibility-matrix.integration.test.ts',
  'packages/db/src/phase40.invalidation.integration.test.ts',
  'packages/db/src/phase40.output-matrix.integration.test.ts',
  'packages/db/src/phase40.regeneration-matrix.integration.test.ts',
  'packages/db/src/phase40.concurrency-audit-directdb.integration.test.ts',
  'packages/db/src/phase40.acceptance.fixtures.ts',
];
for (const file of required) if (!existsSync(file)) throw new Error(`missing ${file}`);
const frozen = {
  '20260816000100_phase10_foundation':
    'aacf73f970bc730f4215704aeda5559afd849a1a21a0c3047142aa8d1de19671',
  '20260816000200_phase10_remediation':
    '2c31642d57b5f9306fe8b499f088c543b14d11d08082e42dd73c8b7b4d3e322f',
  '20260818002000_phase20_curriculum_assessment':
    'cafdcf5dcc1dd13f35e176b54a5b8c39bfb50cb3c814ae6f93ab2a0f71013d81',
  '20260824003000_phase30_source_registry':
    '50eef1301234ef55dcf3fa367dc3255e88ef492fb32d1650102ad7c7ec0dbf3d',
  '20260824003100_phase30_remediation':
    '3bd345fead6de9dcdc557b3a55d894fcc0d2597816f62649ae271b83ff675c50',
  '20260824003200_phase30_final_remediation':
    '3bb1401945c169b61c81da73c87e258c752b04bff56edd54d998e605eae47625',
  '20260824003300_phase30_review_closure':
    'd61b675f839a81a57af63a45ef2460dbfa3ff81bf60229ef6fb0611d9a1dc4ea',
};
for (const [name, expected] of Object.entries(frozen)) {
  const digest = createHash('sha256')
    .update(readFileSync(`packages/db/prisma/migrations/${name}/migration.sql`))
    .digest('hex');
  if (digest !== expected) throw new Error(`frozen migration changed: ${name}`);
}
if (
  execSync('git branch --show-current', { encoding: 'utf8' }).trim() !==
  'codex/phase-40-generation-engine'
)
  throw new Error('wrong branch');
execSync('git merge-base --is-ancestor fd419a5ef7577b6d2ca65ba6381a7a30e3200c18 HEAD');
const migrations = readdirSync('packages/db/prisma/migrations').filter((name) =>
  /^\d+_/.test(name),
);
if (
  migrations.length !== 13 ||
  migrations.filter((name) => name.startsWith('20260824004300_')).length !== 1
)
  throw new Error(`expected thirteen migrations, got ${migrations.length}`);
const registry = readFileSync('packages/db/src/phase40.acceptance.registry.ts', 'utf8');
const expectedCounts = {
  T: 8,
  R: 24,
  S: 24,
  L: 25,
  G: 10,
  E1: 17,
  E2: 7,
  O: 12,
  Q: 10,
  C: 8,
  A: 8,
  D: 20,
};
for (const [key] of Object.entries(expectedCounts))
  if (!new RegExp(`\\b${key}:`).test(registry)) throw new Error(`missing ${key} registry`);
if (Object.values(expectedCounts).reduce((a, b) => a + b, 0) !== 173)
  throw new Error('matrix manifest mismatch');
const integration = required
  .filter((file) => file.includes('integration'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
for (const token of [
  'prisma',
  'requestDraftGeneration',
  'requestQuestionRegeneration',
  'getGenerationStatus',
  'getGenerationResult',
  'processGenerationRun',
  'selectGenerationContext',
  'it.each',
])
  if (!integration.includes(token)) throw new Error(`integration behavior missing ${token}`);
const dedicated = required.filter((file) => file.includes('integration.test.ts'));
for (const file of dedicated) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('phase40AcceptanceRegistry'))
    throw new Error(`unregistered integration cases: ${file}`);
  if (!source.includes('createGenerationFixture'))
    throw new Error(`non-isolated fixture binding: ${file}`);
}
const matrixUnit = readFileSync('packages/db/src/phase40-matrices.test.ts', 'utf8');
for (const forbidden of [
  'authorizeWorkspace',
  'isEligibleKnowledgeItem',
  'canTransitionGenerationRun',
  'DeterministicFakeModelGateway',
  'safeParse',
  'JSON.stringify',
])
  if (matrixUnit.includes(forbidden)) throw new Error(`placeholder matrix remains: ${forbidden}`);
const migration043 = readFileSync(
  'packages/db/prisma/migrations/20260824004300_phase40_acceptance_closure/migration.sql',
  'utf8',
);
for (const token of [
  'DEFERRABLE INITIALLY DEFERRED',
  'question_source_commit_guard',
  'generation_context_complete_lineage',
  'jsonb_array_length',
])
  if (!migration043.includes(token)) throw new Error(`043 enforcement missing ${token}`);
const migration044 = readFileSync(
  'packages/db/prisma/migrations/20260824004400_phase40_complete_output_graph/migration.sql',
  'utf8',
);
for (const token of [
  'phase40_validate_complete_output_graph',
  'phase40_complete_output_run_guard',
  'phase40_complete_output_link_guard',
  'DEFERRABLE INITIALLY DEFERRED',
])
  if (!migration044.includes(token)) throw new Error(`044 enforcement missing ${token}`);
const upgrade = readFileSync('scripts/phase40-upgrade-test.mjs', 'utf8');
for (const token of [
  'generation_context_items',
  'question_source_links',
  'SECOND_CLEAN_DATABASE_COMPARISON',
  '03300',
  '04300',
  '04400',
  '04500',
  'pg_get_functiondef',
  'pg_get_triggerdef',
])
  if (!upgrade.includes(token)) throw new Error(`upgrade evidence missing ${token}`);
const generation = readFileSync('packages/db/src/generation.ts', 'utf8');
for (const forbidden of [
  'sv.lifecycle',
  'to_tsvector',
  'new DeterministicFakeModelGateway',
  'curriculumLinks[0]',
  'return existing;',
])
  if (generation.includes(forbidden)) throw new Error(`generation boundary failed: ${forbidden}`);
for (const token of ['AbortController', 'timeout', 'contextStillEligible(runId, selected, tx)'])
  if (!generation.includes(token)) throw new Error(`generation safety missing ${token}`);
console.log('PHASE40_CONTROL=STRUCTURAL_PASS');
console.log('MATRIX_MANIFEST=173');
console.log('MIGRATION_COUNT=13');
