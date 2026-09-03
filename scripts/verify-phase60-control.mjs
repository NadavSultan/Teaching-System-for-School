import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const expectedBranch = 'codex/phase-60-teacher-workspace';
const startingCommit = 'eb94f524435c0ecd58277649ef33d07ff9c51624';
const migrationRoot = 'packages/db/prisma/migrations';
const allowedMigration = '20260903006000_phase60_teacher_workspace_approval';

const expectedGroups = { K: 8, E: 18, G: 9, V: 12, A: 16, T: 14, C: 10, U: 20, D: 10, F: 8 };
const allowedDevDependencies = new Set([
  '@playwright/test',
  '@testing-library/react',
  '@testing-library/user-event',
  'jsdom',
  '@axe-core/playwright',
]);

const protectedDigests = {
  'docs/phases/50-phase-review.md':
    '65034e103503e86b7a23cc1afca692e680be74ecc433dba3aed59ee411d222f0',
  'docs/phases/60-phase-control-pack.md':
    'bc189c7c411ba6eacc91da66de16c457f23d73ca214494a64024a26842f3bde3',
  'docs/phases/60-executor-handoff.md':
    '24b6de295d36ae638b35a2ebaf77fc23732b17e1eeb24beed724c3ece488b8aa',
  'docs/phases/60-master-gate-baseline.md':
    'ce66a8a458ba1f6b5d9aea9c4965cf1c7825a7d58897be190e81b90408dc7f33',
  'docs/phases/60-manual-qa-plan.md':
    'debeb657ed493bf55d2e982a337c2a46752a8f126b07ff38fe14b12c970fde8e',
  'docs/architecture/project-state.md':
    '58af4d40f4dec57b0c0251a559fecd3c516bc812a2d203cb08420057c5c06e0d',
  'tests/phase60-acceptance-manifest.json':
    '2b85278a400695617c0e29e4be23a592950ebcb0a04c541507d39df597a066e2',
  'tests/phase60-master-control.test.ts':
    '5198dbedec7d227986fc1cb3836696697d2d552f711e77d903266ac473aa3a6d',
};

const requiredImplementationFiles = [
  'packages/contracts/src/phase60.ts',
  'packages/domain/src/editor.ts',
  'packages/db/src/teacher-workspace.ts',
  `${migrationRoot}/${allowedMigration}/migration.sql`,
  'apps/api/src/teacher-workspace.module.ts',
  'apps/web/app/assessments/page.tsx',
  'apps/web/app/assessments/new/page.tsx',
  'apps/web/app/assessments/[assessmentId]/page.tsx',
  'apps/web/app/assessments/[assessmentId]/edit/page.tsx',
  'scripts/phase60-upgrade-test.mjs',
  'scripts/phase60-manual-qa.mjs',
  'docs/runbooks/phase-60-teacher-workspace.md',
];

const requiredScripts = {
  'verify:phase60': 'node scripts/verify-phase60-control.mjs',
  'test-integration:phase60-upgrade': 'node scripts/phase60-upgrade-test.mjs',
  'test:e2e:phase60': 'playwright test --config playwright.phase60.config.ts',
  'qa:phase60': 'node scripts/phase60-manual-qa.mjs',
};

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function digestBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function digestFile(file) {
  return digestBytes(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
}

function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    if (['node_modules', '.pnpm-store', '.next', 'dist', '.git', 'coverage'].includes(name))
      return [];
    const path = `${root}/${name}`;
    return statSync(path).isDirectory() ? walk(path) : [path.replaceAll('\\', '/')];
  });
}

if (git('branch', '--show-current') !== expectedBranch) {
  throw new Error(`wrong branch; expected ${expectedBranch}`);
}
execFileSync('git', ['merge-base', '--is-ancestor', startingCommit, 'HEAD']);

const manifest = JSON.parse(readFileSync('tests/phase60-acceptance-manifest.json', 'utf8'));
if (manifest.phase !== 60 || manifest.expectedTotal !== 125) {
  throw new Error('Phase 60 manifest identity/total mismatch');
}
const manifestIds = [];
for (const [group, expectedCount] of Object.entries(expectedGroups)) {
  const expected = Array.from(
    { length: expectedCount },
    (_, index) => `${group}${String(index + 1).padStart(2, '0')}`,
  );
  const actual = manifest.groups?.[group];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Phase 60 manifest group ${group} mismatch`);
  }
  manifestIds.push(...actual);
}
if (manifestIds.length !== 125 || new Set(manifestIds).size !== 125) {
  throw new Error('Phase 60 manifest must contain 125 unique case IDs');
}

for (const [file, expected] of Object.entries(protectedDigests)) {
  const actual = existsSync(file) ? digestFile(file) : 'MISSING';
  if (actual !== expected) {
    throw new Error(
      `protected Phase 60 master file changed: ${file}; expected=${expected}; actual=${actual}`,
    );
  }
}

const baselineMigrations = git('ls-tree', '-r', '--name-only', startingCommit, migrationRoot)
  .split(/\r?\n/)
  .filter((path) => path.endsWith('/migration.sql'));
if (baselineMigrations.length !== 15) {
  throw new Error(
    `approved Phase 50 baseline must contain 15 migrations; got ${baselineMigrations.length}`,
  );
}
for (const file of baselineMigrations) {
  if (!existsSync(file)) throw new Error(`frozen migration missing: ${file}`);
  const baselineBytes = execFileSync('git', ['show', `${startingCommit}:${file}`]);
  if (digestFile(file) !== digestBytes(baselineBytes)) {
    throw new Error(`frozen migration changed: ${file}`);
  }
}

const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d+_/.test(name))
  .sort();
const later = migrations.filter((name) => Number(name.match(/^(\d+)_/)?.[1]) > 20260826005000);
if (
  (migrations.length !== 15 && migrations.length !== 16) ||
  later.length > 1 ||
  (later.length === 1 && later[0] !== allowedMigration)
) {
  throw new Error(`migration scope invalid: count=${migrations.length}, later=${later.join(',')}`);
}

const changed = new Set(
  [
    ...git('diff', '--name-only', `${startingCommit}...HEAD`).split(/\r?\n/),
    ...git('diff', '--name-only').split(/\r?\n/),
    ...git('diff', '--cached', '--name-only').split(/\r?\n/),
  ].filter(Boolean),
);
for (const path of changed) {
  if (
    path.startsWith('packages/rendering/') ||
    /(^|\/)(phase[-_ ]?7\d|phase[-_ ]?8\d|phase[-_ ]?9\d)(\/|\.|-|_)/i.test(path) ||
    /(^|\/)(pdf|docx|exports?|object-storage|signed-downloads?)(\/|\.|-|_)/i.test(path)
  ) {
    throw new Error(`later-phase path is prohibited in Phase 60: ${path}`);
  }
}

const productionChangedFiles = [...changed].filter(
  (path) =>
    /^(apps|packages)\//.test(path) &&
    /\.(?:ts|tsx|js|mjs|json)$/.test(path) &&
    !/\.(?:test|spec)\./.test(path) &&
    !/(?:fixture|seed)/i.test(path),
);
for (const file of productionChangedFiles) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (
    /from ['"](?:openai|anthropic|@google\/generative|@aws-sdk|puppeteer|playwright)['"]/.test(
      source,
    )
  ) {
    throw new Error(`provider SDK/network dependency is prohibited in Phase 60: ${file}`);
  }
  if (
    /(?:grade|gradeCode|gradeId)\s*(?:===|==)\s*['"]?(?:7|8|9|G7|G8|G9)/i.test(source) ||
    /case\s+['"]?(?:7|8|9|G7|G8|G9)['"]?\s*:/i.test(source)
  ) {
    throw new Error(`hard-coded grade branch is prohibited in Phase 60: ${file}`);
  }
}

for (const packageFile of [...changed].filter((path) => path.endsWith('package.json'))) {
  if (!existsSync(packageFile)) continue;
  const current = JSON.parse(readFileSync(packageFile, 'utf8'));
  let baseline;
  try {
    baseline = JSON.parse(
      execFileSync('git', ['show', `${startingCommit}:${packageFile}`], { encoding: 'utf8' }),
    );
  } catch {
    baseline = { dependencies: {}, devDependencies: {} };
  }
  if (JSON.stringify(current.dependencies ?? {}) !== JSON.stringify(baseline.dependencies ?? {})) {
    throw new Error(`production dependencies changed without approval: ${packageFile}`);
  }
  const baselineDev = baseline.devDependencies ?? {};
  for (const name of Object.keys(current.devDependencies ?? {})) {
    if (!(name in baselineDev) && !allowedDevDependencies.has(name)) {
      throw new Error(`unapproved Phase 60 dev dependency ${name} in ${packageFile}`);
    }
  }
  for (const [name, version] of Object.entries(baselineDev)) {
    if (current.devDependencies?.[name] !== version) {
      throw new Error(`existing dev dependency changed or removed: ${name} in ${packageFile}`);
    }
  }
}

const missing = requiredImplementationFiles.filter((file) => !existsSync(file));
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
for (const [name, command] of Object.entries(requiredScripts)) {
  if (rootPackage.scripts?.[name] !== command) missing.push(`package.json#${name}`);
}

const phase60Tests = [...walk('tests'), ...walk('packages'), ...walk('apps')].filter(
  (file) =>
    /phase60.*\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/i.test(file) &&
    !file.endsWith('tests/phase60-master-control.test.ts'),
);
if (phase60Tests.length > 0) {
  const testSource = phase60Tests.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const id of manifestIds) {
    const count = testSource.match(new RegExp(`\\b${id}\\b`, 'g'))?.length ?? 0;
    if (count !== 1) {
      throw new Error(
        `acceptance case ${id} must occur exactly once in Phase 60 tests; got ${count}`,
      );
    }
  }
  if (/\.(?:skip|todo|only)\s*\(|expectedFailure|fails\s*:/i.test(testSource)) {
    throw new Error('Phase 60 tests contain a prohibited skip/todo/only/expected-failure marker');
  }
  if (
    /const\s+cases\s*[:=][\s\S]{0,200}\[string[\s\S]{0,400}for\s*\(const\s*\[[^\]]*id/i.test(
      testSource,
    )
  ) {
    throw new Error('callback/proxy acceptance tables are prohibited in Phase 60');
  }
}

if (missing.length > 0) {
  console.error(`PHASE60_EXPECTED_RED_MISSING=${missing.join(',')}`);
  process.exitCode = 1;
} else {
  if (phase60Tests.length === 0) throw new Error('Phase 60 permanent acceptance tests are missing');
  console.log('PHASE60_CONTROL=STRUCTURAL_PASS');
}

console.log(`MATRIX_MANIFEST=${manifestIds.length}`);
console.log(`MIGRATION_COUNT=${migrations.length}`);
console.log(`STARTING_COMMIT=${startingCommit}`);
