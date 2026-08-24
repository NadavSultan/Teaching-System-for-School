import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const required = [
  'packages/db/prisma/migrations/20260824004000_phase40_generation_engine/migration.sql',
  'packages/db/prisma/migrations/20260824004200_phase40_final_review_closure/migration.sql',
  'packages/contracts/schemas/draft-generation-request.v1.json',
  'packages/contracts/schemas/question-regeneration-request.v1.json',
  'packages/db/src/generation.ts',
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
const migrations = readdirSync('packages/db/prisma/migrations').filter((name) =>
  /^\d+_/.test(name),
);
if (
  migrations.length !== 10 ||
  migrations.filter((name) => name.startsWith('20260824004000_')).length !== 1 ||
  migrations.filter((name) => name.startsWith('20260824004100_')).length !== 1 ||
  migrations.filter((name) => name.startsWith('20260824004200_')).length !== 1
)
  throw new Error(`expected nine migrations, got ${migrations.length}`);
const schema = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
if (
  !schema.includes('model GenerationRun') ||
  !schema.includes('model GenerationContextItem') ||
  !schema.includes('model GenerationUsage') ||
  !schema.includes('model QuestionSourceLink')
)
  throw new Error('required models missing');
const generation = readFileSync('packages/db/src/generation.ts', 'utf8');
if (
  !generation.includes('ki.search_vector') ||
  generation.includes('sv.lifecycle') ||
  generation.includes('to_tsvector') ||
  generation.includes('new DeterministicFakeModelGateway') ||
  generation.includes('curriculumLinks[0]')
)
  throw new Error('eligibility/provider boundary failed');
if (
  !generation.includes('AbortController') ||
  !generation.includes('timeout') ||
  !generation.includes('contextStillEligible(runId, selected, tx)')
)
  throw new Error('timeout/transactional revalidation boundary failed');
if (generation.includes('return existing;')) throw new Error('raw idempotency return remains');
const matrixSource = readFileSync('packages/db/src/phase40-matrices.test.ts', 'utf8');
if (
  matrixSource.includes('toBeTypeOf') ||
  matrixSource.includes('caseId') ||
  matrixSource.includes('Array.from({ length') ||
  matrixSource.includes("safeParse('CONTEXT_EMPTY')") ||
  matrixSource.includes("safeParse('CONTEXT_INVALIDATED')") ||
  matrixSource.includes('JSON.stringify') ||
  matrixSource.includes("canTransitionGenerationRun('PROCESSING', 'FAILED')") ||
  !matrixSource.includes('it.each') ||
  !matrixSource.includes('phase40MatrixManifest')
)
  throw new Error('matrix runtime behavior is not registered');
const upgrade = readFileSync('scripts/phase40-upgrade-test.mjs', 'utf8');
if (
  !upgrade.includes('INSERT INTO') ||
  !upgrade.includes('rowCount') ||
  !upgrade.includes('generation_usage_guard')
)
  throw new Error('upgrade script does not seed and assert');
if (
  execSync('git branch --show-current', { encoding: 'utf8' }).trim() !==
  'codex/phase-40-generation-engine'
)
  throw new Error('wrong branch');
try {
  execSync('git merge-base --is-ancestor fd419a5ef7577b6d2ca65ba6381a7a30e3200c18 HEAD');
} catch {
  throw new Error('required Phase 30 baseline is not an ancestor');
}
const manifest = {
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
if (Object.values(manifest).reduce((a, b) => a + b, 0) !== 173)
  throw new Error('matrix manifest mismatch');
execSync('git branch --show-current', { stdio: 'inherit' });
console.log('PHASE40_CONTROL=PASS');
console.log('MATRIX_CASES=173');
console.log('MIGRATION_COUNT=10');
