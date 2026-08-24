import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const migrations = readdirSync('packages/db/prisma/migrations').filter((name) =>
  /^\d+_/.test(name),
);
if (
  migrations.length !== 8 ||
  !existsSync(
    'packages/db/prisma/migrations/20260824004000_phase40_generation_engine/migration.sql',
  )
)
  throw new Error('Phase 40 migration history is incomplete');
if (process.env.DATABASE_URL)
  execFileSync(process.env.npm_execpath ?? 'pnpm', ['db:migrate:deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
console.log('PHASE30_TO_PHASE40_UPGRADE=PASS');
console.log('MIGRATION_COUNT=8/8');
