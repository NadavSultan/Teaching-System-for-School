import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const migrationRoot = 'packages/db/prisma/migrations';
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d+_/.test(name))
  .sort();
if (migrations.length !== 15 || migrations.at(-1) !== '20260826005000_phase50_validation_engine') {
  throw new Error('Phase 50 staged upgrade requires exactly migrations 00100 through 05000');
}
if (!existsSync(`${migrationRoot}/20260826005000_phase50_validation_engine/migration.sql`)) {
  throw new Error('Phase 50 migration is missing');
}
// The local integration harness owns PostgreSQL lifecycle and invokes this script after
// applying the frozen 04600 baseline. Keep this explicit preflight free of provider calls.
execFileSync(
  'git',
  [
    'diff',
    '--exit-code',
    '8f09173f073f13b8e565a12f3d37abac18b33bf5',
    '--',
    `${migrationRoot}/20260826000100_secure_foundation`,
    `${migrationRoot}/20260826004600_phase40_generation_engine`,
  ],
  { stdio: 'inherit' },
);
console.log('PHASE50_UPGRADE_LAYOUT=PASS');
