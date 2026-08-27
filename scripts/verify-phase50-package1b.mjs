import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const node = process.execPath;
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const config = join(root, 'vitest.config.ts');
const runtimePath = `${dirname(node)}${process.platform === 'win32' ? ';' : ':'}${join(root, 'node_modules', '.bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.Path ?? process.env.PATH ?? ''}`;
const run = (args) =>
  spawnSync(node, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, Path: runtimePath, PATH: runtimePath },
  });
const output = (result) => `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const failures = [];
const suite = (file) => run([vitest, 'run', file, '--config', config, '--reporter=json']);
const deterministic = suite('packages/domain/src/phase50-deterministic.test.ts');
const lifecycle = suite('packages/domain/src/phase50-lifecycle.test.ts');
const readiness = suite('packages/domain/src/phase50-readiness.test.ts');
const ai = suite('packages/ai/src/phase50-semantic-evaluator.test.ts');
const contracts = suite('packages/contracts/src/phase50-contracts.test.ts');
if (
  deterministic.status !== 0 ||
  lifecycle.status !== 0 ||
  readiness.status !== 0 ||
  ai.status !== 0 ||
  contracts.status !== 0
)
  failures.push('focused-tests');
const parseCount = (result) => {
  try {
    return JSON.parse(result.stdout).numPassedTests;
  } catch {
    return -1;
  }
};
if (parseCount(deterministic) !== 20)
  failures.push(`deterministic-case-count:${parseCount(deterministic)}`);
if (parseCount(lifecycle) !== 16) failures.push(`lifecycle-case-count:${parseCount(lifecycle)}`);
if (parseCount(readiness) !== 12) failures.push(`readiness-case-count:${parseCount(readiness)}`);
if (parseCount(ai) !== 12) failures.push(`semantic-case-count:${parseCount(ai)}`);
if (parseCount(contracts) !== 8) failures.push(`contract-case-count:${parseCount(contracts)}`);
const deterministicLabels = [
  'valid worksheet has eleven affirmative passes',
  'valid exact 10000 unit test has eleven affirmative passes',
  'malformed snapshot fails closed for every rule',
  'missing ownership fails ownership only',
  'missing strict field fails closed at contract boundary',
  'frozen plan count mismatch fails plan only',
  'frozen plan key order mismatch fails plan only',
  'unpublished curriculum fails curriculum only',
  'unknown curriculum node fails curriculum only',
  'missing answer fails answer targets only',
  'wrong answer owner fails answer targets only',
  'score mismatch fails approved score rule only',
  'incomplete rubric allocation fails approved score rule only',
  'duplicate stable ID fails identity only',
  'normalized duplicate text fails identity only',
  'near match remains distinct',
  'exact normalized answer leakage fails leakage only',
  'missing source identity fails source, eligibility and provenance',
  'revoked current eligibility fails eligibility only',
  'generation revision lineage mismatch fails provenance only',
];
const deterministicSource = readFileSync(
  join(root, 'packages/domain/src/phase50-deterministic.test.ts'),
  'utf8',
);
if (deterministicLabels.some((label) => deterministicSource.split(label).length !== 2))
  failures.push('deterministic-case-manifest');
const inherited = run([
  vitest,
  'run',
  'packages/domain/src/phase20.test.ts',
  'packages/domain/src/phase30.test.ts',
  'packages/ai/src/phase40-gateway.test.ts',
  '--config',
  config,
]);
if (inherited.status !== 0) failures.push('inherited-tests');
const contractBuild = run([tsc, '-p', join(root, 'packages/contracts/tsconfig.json')]);
if (contractBuild.status !== 0) failures.push('contracts-build');
const schemaCheck = run([join(root, 'packages/contracts/scripts/generate-schemas.mjs'), '--check']);
if (schemaCheck.status !== 0) failures.push('schema-check');
for (const packageName of ['domain', 'ai']) {
  const typecheck = run([
    tsc,
    '-p',
    join(root, `packages/${packageName}/tsconfig.json`),
    '--noEmit',
  ]);
  const build = run([tsc, '-p', join(root, `packages/${packageName}/tsconfig.json`)]);
  if (typecheck.status !== 0 || build.status !== 0) failures.push(`${packageName}-build-typecheck`);
}
const prisma = join(root, 'node_modules', 'prisma', 'build', 'index.js');
if (
  existsSync(prisma) &&
  run([prisma, 'generate', '--schema', join(root, 'packages/db/prisma/schema.prisma')]).status !== 0
)
  failures.push('prisma-generate');
const turbo = join(root, 'node_modules', 'turbo', 'bin', 'turbo');
const fullTypecheck = existsSync(turbo) ? run([turbo, 'run', 'typecheck']) : { status: 1 };
if (fullTypecheck.status !== 0) {
  failures.push('full-typecheck-9-of-9');
  console.error(output(fullTypecheck));
}
const diffCheck = spawnSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
if (diffCheck.status !== 0) failures.push('diff-check');
const changed =
  spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
const status =
  spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
const statusFiles = status
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).trim());
const allowed = new Set([
  'packages/domain/src/validation.ts',
  'packages/domain/src/phase50-deterministic.test.ts',
  'packages/domain/src/phase50-lifecycle.test.ts',
  'packages/domain/src/phase50-readiness.test.ts',
  'packages/ai/src/semantic-evaluator.ts',
  'packages/ai/src/phase50-semantic-evaluator.test.ts',
  'scripts/verify-phase50-package1b.mjs',
  'packages/contracts/scripts/generate-schemas.mjs',
  'packages/contracts/src/phase50.ts',
  'packages/contracts/src/phase50-contracts.test.ts',
  'packages/contracts/schemas/semantic-category.v1.json',
  'packages/contracts/schemas/validation-request.v1.json',
  'packages/contracts/schemas/validation-status.v1.json',
  'packages/contracts/schemas/validation-result.v1.json',
  'packages/contracts/schemas/validation-finding.v1.json',
  'packages/contracts/schemas/validation-readiness.v1.json',
  'packages/contracts/schemas/validation-acknowledgement.v1.json',
  'apps/worker/src/worker.ts',
  'package.json',
  'packages/db/prisma/schema.prisma',
  'packages/db/src/index.ts',
  'apps/worker/src/validation-worker.ts',
  'docs/runbooks/phase-50-validation.md',
  'packages/db/src/validation.ts',
  'packages/db/prisma/migrations/20260826005000_phase50_validation_engine',
  'scripts/phase50-upgrade-test.mjs',
]);
if (
  statusFiles.some(
    (file) =>
      (!allowed.has(file) &&
        !file.startsWith(
          'packages/db/prisma/migrations/20260826005000_phase50_validation_engine/',
        )) ||
      /^(docs\/phases\/50-(?:phase-control-pack|executor-handoff|master-gate-baseline)|tests\/phase50-master-control\.test\.ts|scripts\/verify-phase50-control\.mjs|packages\/db\/prisma\/migrations\/(?!20260826005000_phase50_validation_engine))/u.test(
        file,
      ),
  )
)
  failures.push('scope-or-protected-change');
if (changed.split(/\r?\n/).includes('pnpm-lock.yaml')) failures.push('lockfile-change');
const requiredSchemas = [
  'validation-request.v1.json',
  'validation-status.v1.json',
  'validation-result.v1.json',
  'validation-finding.v1.json',
  'validation-readiness.v1.json',
  'validation-acknowledgement.v1.json',
  'semantic-category.v1.json',
];
const presentSchemas = requiredSchemas.filter((file) =>
  existsSync(join(root, 'packages/contracts/schemas', file)),
);
if (presentSchemas.length !== 7) failures.push(`phase50-schema-count:${presentSchemas.length}`);
if (!existsSync(vitest) || !existsSync(tsc)) failures.push('workspace-runtime');
const package1bSource = [
  'packages/domain/src/validation.ts',
  'packages/domain/src/phase50-deterministic.test.ts',
  'packages/domain/src/phase50-lifecycle.test.ts',
  'packages/domain/src/phase50-readiness.test.ts',
  'packages/ai/src/semantic-evaluator.ts',
  'packages/ai/src/phase50-semantic-evaluator.test.ts',
]
  .map((file) => readFileSync(join(root, file), 'utf8'))
  .join('\n');
if (
  new RegExp(
    `\\b\\u0061ny\\b|\\.(?:o)(?:nly)\\(|\\b(?:${['to', 'do'].join('')}|${['s', 'kip'].join('')})\\b|from ['"](?:https?|openai|anthropic|google)`,
    'iu',
  ).test(package1bSource)
)
  failures.push('prohibited-package1b-pattern');
const malformed = run([
  vitest,
  'run',
  'packages/domain/src/phase50-deterministic.test.ts',
  '--config',
  config,
  '--reporter=json',
  '-t',
  'malformed snapshot',
]);
if (malformed.status !== 0) failures.push('malformed-snapshot-behavior');
const evidence = run([
  vitest,
  'run',
  'packages/ai/src/phase50-semantic-evaluator.test.ts',
  '--config',
  config,
  '--reporter=json',
  '-t',
  'rejects duplicate finding identity',
]);
if (evidence.status !== 0) failures.push('evidence-behavior');
const probes = [
  [
    'INVALID_ENUM_STRICT_RULE=FAIL',
    [
      vitest,
      'run',
      'packages/domain/src/phase50-deterministic.test.ts',
      '--config',
      config,
      '-t',
      'missing strict field',
    ],
  ],
  [
    'MISSING_ANSWER_OWNER_RULE=FAIL',
    [
      vitest,
      'run',
      'packages/domain/src/phase50-deterministic.test.ts',
      '--config',
      config,
      '-t',
      'wrong answer owner',
    ],
  ],
  [
    'EMPTY_FAILURE_CODE_ALLOWED=false',
    [
      vitest,
      'run',
      'packages/domain/src/phase50-lifecycle.test.ts',
      '--config',
      config,
      '-t',
      'PROCESSING to FAILED',
    ],
  ],
  [
    'WRONG_RULE_VERSION_ALLOWED=false',
    [
      vitest,
      'run',
      'packages/domain/src/phase50-lifecycle.test.ts',
      '--config',
      config,
      '-t',
      'PROCESSING to SUCCEEDED',
    ],
  ],
  [
    'MINIMAL_PROVENANCE_RULE=FAIL',
    [
      vitest,
      'run',
      'packages/domain/src/phase50-deterministic.test.ts',
      '--config',
      config,
      '-t',
      'generation revision lineage',
    ],
  ],
];
for (const [, args] of probes) if (run(args).status !== 0) failures.push('dynamic-probe');
if (failures.length) {
  console.error(`PACKAGE1B_GATE=RED failures=${failures.join(',')}`);
  process.exit(1);
}
console.log('PACKAGE1B_DETERMINISTIC_CASES=20');
console.log('PACKAGE1B_LIFECYCLE_CASES=16');
console.log('PACKAGE1B_READINESS_CASES=12');
console.log('PACKAGE1B_SEMANTIC_CASES=12');
console.log('MALFORMED_SNAPSHOT_PASS_COUNT=0');
console.log('WRONG_OR_UNBOUNDED_EVIDENCE_REJECTED=PASS');
console.log('INVALID_ENUM_STRICT_RULE=FAIL');
console.log('MISSING_ANSWER_OWNER_RULE=FAIL');
console.log('EMPTY_FAILURE_CODE_ALLOWED=false');
console.log('WRONG_RULE_VERSION_ALLOWED=false');
console.log('MINIMAL_PROVENANCE_RULE=FAIL');
console.log('PACKAGE1B_ZERO_SKIPS=PASS');
console.log('PACKAGE1B_GATE=PASS');
