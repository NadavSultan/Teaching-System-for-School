import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const expectedBranch = 'codex/phase-40-final-remediation';
const startingCommit = 'a81a9eab7c99a94f19d64591bf9af30735056bf3';
const migrationRoot = 'packages/db/prisma/migrations';
const allowedClosureMigration = '20260824004600_phase40_master_gate_closure';

const protectedFiles = [
  'packages/db/src/phase40.master-gate.integration.test.ts',
  'tests/phase40-master-control.test.ts',
  'tests/phase40-exact-matrix-master-control.test.ts',
  'tests/phase40-evidence-integrity-master-control.test.ts',
  'scripts/verify-phase40-control.mjs',
  'docs/phases/40-master-gate-baseline.md',
  'docs/phases/40-final-remediation-control-pack.md',
  'docs/phases/40-final-remediation-executor-handoff.md',
  'docs/phases/40-final-closure-control-pack.md',
  'docs/phases/40-final-closure-executor-handoff.md',
  'docs/phases/40-final-closure-baseline.md',
  'docs/phases/40-exact-matrix-closure-control-pack.md',
  'docs/phases/40-exact-matrix-closure-executor-handoff.md',
  'docs/phases/40-exact-matrix-closure-baseline.md',
  'docs/phases/40-evidence-integrity-control-pack.md',
  'docs/phases/40-evidence-integrity-executor-handoff.md',
  'docs/phases/40-evidence-integrity-baseline.md',
];

const protectedDigests = {
  'packages/db/src/phase40.master-gate.integration.test.ts':
    '543eb28bcbe5cd2ddfa26e55980013bbad210dbe01be0f921f334a8225cc96b1',
  'tests/phase40-master-control.test.ts':
    'deaa1ea2cbe9d819b14d6de91b130da1a11d44eac68592b4670b6c84b4dc6488',
  'tests/phase40-exact-matrix-master-control.test.ts':
    '5cc57cc7c5183c73d2416ea9139de1b8a9f80c2260825e8412817c5383f84e32',
  'tests/phase40-evidence-integrity-master-control.test.ts':
    '8c1d990842c81802cc2093aeb6b16e779bb5822e4b94e76c04a4c53269a285de',
  'scripts/verify-phase40-control.mjs':
    '12a9b40e0173d1062b3ba5794336235e14c7bd3d8a0b40fdb51da60760423715',
  'docs/phases/40-master-gate-baseline.md':
    '013cf1f2fbf3ab94419694b654d32bc43492f00ceee8ea3b5c4cb852b8c3bf22',
  'docs/phases/40-final-remediation-control-pack.md':
    '938a4385efbc1f54c17a8435be7f9f45d360fbcc3e6cf07e37c4bb3d8847e490',
  'docs/phases/40-final-remediation-executor-handoff.md':
    '25b7b84028a91e70c0199f81c62799fc0caa87ed0c0be5d8d490ab729a0b1056',
  'docs/phases/40-final-closure-control-pack.md':
    '3e58e8f4e343e74dde41eb5316aca9b087e35dc77f0d0769e9188e01d068f966',
  'docs/phases/40-final-closure-executor-handoff.md':
    'd130857d85ed219f135438fd079b81acb0ab2b50fe106fe28431abc8070014e0',
  'docs/phases/40-final-closure-baseline.md':
    '2c940da43a489840eb123bd270c567e323937867c57625cab258eb4c7f4098e3',
  'docs/phases/40-exact-matrix-closure-control-pack.md':
    '491b2e6d8b29333aee79bbc3cc88bc2b896eb1e4564d422d294757eb76e57e81',
  'docs/phases/40-exact-matrix-closure-executor-handoff.md':
    'db114ba6196f71cab65689e4950f53c829a7810f4af2ef43a655282a21df60a7',
  'docs/phases/40-exact-matrix-closure-baseline.md':
    '9c424fc5916d008996b52cfdbe33ffd826cf87d6bd31a4453595cc6f1a453830',
  'docs/phases/40-evidence-integrity-control-pack.md':
    '925b7d79f7db188edf428d508d6f4ac8f9afd5f863af4effa916dad7ba17aa66',
  'docs/phases/40-evidence-integrity-executor-handoff.md':
    '99a181d1419b3e2f9a66138e9e61bc020cd5cbe8765f09a608493be8a22633eb',
  'docs/phases/40-evidence-integrity-baseline.md':
    '2c9bed3750dea0ef7713d152115b6186c194c80bd5af10e5e03cb038e15bdab5',
};

const frozenPhase40Migrations = {
  '20260824004000_phase40_generation_engine':
    '390468805a150e7a914d8ef010034917095791a84ed8085c07198f4875e7b69e',
  '20260824004100_phase40_review_remediation':
    '4793e8ad08b1716019d4f57d2f64300640de3aa695899db3129457a655227676',
  '20260824004200_phase40_final_review_closure':
    '3440dfa65fef309db502463e3ed23d8f8444fe3045a2b1f868d07041699bbc71',
  '20260824004300_phase40_acceptance_closure':
    'da8aa3c21848bb1aeb84a95f848f1426b742324bed25465d0512e499a826a4ab',
  '20260824004400_phase40_complete_output_graph':
    '282aaae533c70d9b49155ab81dee769baa19a51aa3be84be49eb5bff31826109',
  '20260824004500_phase40_exact_output_graph':
    '508d68c64794594deeb5d7da8d2c1b599d2f634391b98424525cb6f6dae0971b',
};

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

for (const file of [...protectedFiles, 'scripts/verify-phase40-master-gate.mjs']) {
  if (!existsSync(file)) throw new Error(`missing master gate file: ${file}`);
}

for (const [file, expected] of Object.entries(protectedDigests)) {
  const actual = digest(file);
  if (actual !== expected) {
    throw new Error(`protected master file changed: ${file}`);
  }
}

for (const [name, expected] of Object.entries(frozenPhase40Migrations)) {
  const file = `${migrationRoot}/${name}/migration.sql`;
  if (!existsSync(file)) throw new Error(`missing frozen migration: ${name}`);
  if (digest(file) !== expected) {
    throw new Error(`frozen Phase 40 migration changed: ${name}`);
  }
}

if (git('branch', '--show-current') !== expectedBranch) {
  throw new Error(`wrong branch; expected ${expectedBranch}`);
}
execFileSync('git', ['merge-base', '--is-ancestor', startingCommit, 'HEAD']);

const migrations = readdirSync(migrationRoot).filter((name) => /^\d+_/.test(name));
if (migrations.length !== 13 && migrations.length !== 14) {
  throw new Error(`expected 13 baseline or 14 remediated migrations, got ${migrations.length}`);
}
const laterMigrations = migrations.filter(
  (name) => Number(name.match(/^(\d+)_/)?.[1]) > 20260824004500,
);
if (
  laterMigrations.length > 1 ||
  (laterMigrations.length === 1 && laterMigrations[0] !== allowedClosureMigration)
) {
  throw new Error(
    `only ${allowedClosureMigration} is allowed after 04500; found ${laterMigrations.join(', ')}`,
  );
}

const protectedSources = protectedFiles
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
for (let index = 1; index <= 24; index += 1) {
  const id = `MG-${String(index).padStart(2, '0')}`;
  const occurrences = protectedSources.match(new RegExp(id, 'g'))?.length ?? 0;
  if (occurrences !== 1) {
    throw new Error(`expected exactly one protected ${id} test, found ${occurrences}`);
  }
}
for (const forbidden of ['.skip(', '.todo(', '.only(', 'describe.skip', 'describe.only']) {
  if (protectedSources.includes(forbidden)) {
    throw new Error(`protected master gate contains forbidden ${forbidden}`);
  }
}

execFileSync(process.execPath, ['scripts/verify-phase40-control.mjs'], {
  stdio: 'inherit',
});

console.log('PHASE40_MASTER_GATE=STRUCTURAL_PASS');
console.log('PROTECTED_CASES=24');
console.log(`STARTING_COMMIT=${startingCommit}`);
console.log(`MIGRATION_COUNT=${migrations.length}`);
