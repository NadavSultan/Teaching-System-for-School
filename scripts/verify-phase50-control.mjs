import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const expectedBranch = 'codex/phase-50-validation-engine';
const productBaseline = '8f09173f073f13b8e565a12f3d37abac18b33bf5';
const migrationRoot = 'packages/db/prisma/migrations';
const allowedMigration = '20260826005000_phase50_validation_engine';

const protectedDigests = {
  'docs/phases/40-phase-review.md':
    '5b86b1734b7305da2207e93be8cf1d9aafa8d2231412cca722dea0bacff86fc1',
  'docs/phases/50-phase-control-pack.md':
    '033270f77a39a74f1a14cfcdcaa4196bee6f3f73d400714dcedd8e2f59b07e3a',
  'docs/phases/50-executor-handoff.md':
    '98f7443c947288be47c8638fde6f3bf73182c404a760a8a412e72af9cf2b6227',
  'docs/phases/50-master-gate-baseline.md':
    'ea65245d05ef954f2aeb50ee722223c115ce2eda3c45020a541cefd50e63e6aa',
  'docs/architecture/project-state.md':
    'aec0e8d83128b691f67d36e2659d6b71ea03371a03b48cc22262e9fb37222d2b',
  'tests/phase50-acceptance-manifest.json':
    'b2ae58a322f539aae49cda4b25af1d82cea5b1b800e6fb28fdfc1acfd7898517',
  'tests/phase50-master-control.test.ts':
    '24c64b5cd8dc7c2703cfc7d9444ffb7540d52c07ab1159e8c878fb3a23ca5167',
};

const requiredImplementationFiles = [
  'packages/contracts/src/phase50.ts',
  'packages/domain/src/validation.ts',
  'packages/ai/src/semantic-evaluator.ts',
  'packages/db/src/validation.ts',
  'apps/worker/src/validation-worker.ts',
  `${migrationRoot}/${allowedMigration}/migration.sql`,
  'scripts/phase50-upgrade-test.mjs',
  'docs/runbooks/phase-50-validation.md',
];

const expectedGroups = { D: 20, S: 12, W: 8, L: 16, T: 12, R: 18, C: 8, P: 12, B: 16, A: 8 };

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function digestBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function digestFile(file) {
  return digestBytes(readFileSync(file));
}

function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = `${root}/${name}`;
    return statSync(path).isDirectory() ? walk(path) : [path.replaceAll('\\', '/')];
  });
}

if (git('branch', '--show-current') !== expectedBranch) {
  throw new Error(`wrong branch; expected ${expectedBranch}`);
}
execFileSync('git', ['merge-base', '--is-ancestor', productBaseline, 'HEAD']);

const manifest = JSON.parse(readFileSync('tests/phase50-acceptance-manifest.json', 'utf8'));
if (manifest.phase !== 50 || manifest.expectedTotal !== 130) {
  throw new Error('Phase 50 manifest identity/total mismatch');
}
const manifestIds = [];
for (const [group, expectedCount] of Object.entries(expectedGroups)) {
  const expected = Array.from(
    { length: expectedCount },
    (_, index) => `${group}${String(index + 1).padStart(2, '0')}`,
  );
  const actual = manifest.groups?.[group];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Phase 50 manifest group ${group} mismatch`);
  }
  manifestIds.push(...actual);
}
if (manifestIds.length !== 130 || new Set(manifestIds).size !== 130) {
  throw new Error('Phase 50 manifest must contain 130 unique case IDs');
}

for (const [file, expected] of Object.entries(protectedDigests)) {
  if (!existsSync(file) || digestFile(file) !== expected) {
    throw new Error(`protected Phase 50 master file changed: ${file}`);
  }
}

const baselineMigrations = git('ls-tree', '-r', '--name-only', productBaseline, migrationRoot)
  .split(/\r?\n/)
  .filter((path) => path.endsWith('/migration.sql'));
if (baselineMigrations.length !== 14) {
  throw new Error(`approved baseline must contain 14 migrations; got ${baselineMigrations.length}`);
}
for (const file of baselineMigrations) {
  if (!existsSync(file)) throw new Error(`frozen migration missing: ${file}`);
  const baselineBytes = execFileSync('git', ['show', `${productBaseline}:${file}`]);
  if (digestFile(file) !== digestBytes(baselineBytes)) {
    throw new Error(`frozen migration changed: ${file}`);
  }
}

const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d+_/.test(name))
  .sort();
const later = migrations.filter((name) => Number(name.match(/^(\d+)_/)?.[1]) > 20260824004600);
if (
  (migrations.length !== 14 && migrations.length !== 15) ||
  later.length > 1 ||
  (later.length === 1 && later[0] !== allowedMigration)
) {
  throw new Error(`migration scope invalid: count=${migrations.length}, later=${later.join(',')}`);
}

const baselineLock = execFileSync('git', ['show', `${productBaseline}:pnpm-lock.yaml`]);
if (digestFile('pnpm-lock.yaml') !== digestBytes(baselineLock)) {
  throw new Error('Phase 50 must not add or change dependencies; pnpm-lock.yaml changed');
}

const changed = new Set(
  [
    ...git('diff', '--name-only', `${productBaseline}...HEAD`).split(/\r?\n/),
    ...git('diff', '--name-only').split(/\r?\n/),
    ...git('diff', '--cached', '--name-only').split(/\r?\n/),
  ].filter(Boolean),
);
for (const path of changed) {
  if (
    path.startsWith('apps/web/') ||
    path.startsWith('packages/rendering/') ||
    /(^|\/)(phase[-_ ]?6\d|phase[-_ ]?7\d|phase[-_ ]?8\d|phase[-_ ]?9\d)(\/|\.|-|_)/i.test(path)
  ) {
    throw new Error(`later-phase path is prohibited in Phase 50: ${path}`);
  }
}

const missing = requiredImplementationFiles.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`PHASE50_EXPECTED_RED_MISSING=${missing.join(',')}`);
  process.exitCode = 1;
} else {
  const testFiles = [...walk('tests'), ...walk('packages'), ...walk('apps')].filter(
    (file) =>
      /phase50.*\.test\.ts$/i.test(file) && !file.endsWith('tests/phase50-master-control.test.ts'),
  );
  const testSource = testFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const id of manifestIds) {
    const count = testSource.match(new RegExp(`\\b${id}\\b`, 'g'))?.length ?? 0;
    if (count !== 1)
      throw new Error(
        `acceptance case ${id} must occur exactly once in Phase 50 tests; got ${count}`,
      );
  }

  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  if (
    rootPackage.scripts?.['verify:phase50'] !== 'node scripts/verify-phase50-control.mjs' ||
    rootPackage.scripts?.['test-integration:phase50-upgrade'] !==
      'node scripts/phase50-upgrade-test.mjs'
  ) {
    throw new Error('required Phase 50 package scripts are missing or changed');
  }

  console.log('PHASE50_CONTROL=STRUCTURAL_PASS');
}

console.log(`MATRIX_MANIFEST=${manifestIds.length}`);
console.log(`MIGRATION_COUNT=${migrations.length}`);
console.log(`PRODUCT_BASELINE=${productBaseline}`);
