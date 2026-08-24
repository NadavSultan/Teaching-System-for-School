import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME ?? 'phase30',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE ?? process.cwd(),
  });
  syncBuiltinESMExports();
}
const { default: EmbeddedPostgres } = await import('embedded-postgres');
const databaseDir = join(os.tmpdir(), 'teaching-phase30-upgrade-postgres');
const prismaCopy = join(os.tmpdir(), 'teaching-phase30-upgrade-prisma');
rmSync(databaseDir, { recursive: true, force: true });
rmSync(prismaCopy, { recursive: true, force: true });
mkdirSync(databaseDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'phase30',
  password: 'phase30_local_only',
  port: 55433,
  persistent: false,
  onLog: () => undefined,
});
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('This harness must be started through pnpm.');
const databaseUrl =
  'postgresql://phase30:phase30_local_only@127.0.0.1:55433/teaching_upgrade?schema=public';
let completed = false;
const run = (schema) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [pnpmCli, '--filter', '@teach/db', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schema],
      {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    child.once('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`upgrade migration failed with ${code}`)),
    );
  });
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('teaching_upgrade');
  const sourcePrisma = resolve('packages/db/prisma');
  cpSync(sourcePrisma, prismaCopy, { recursive: true });
  rmSync(join(prismaCopy, 'migrations', '20260824003200_phase30_final_remediation'), {
    recursive: true,
    force: true,
  });
  rmSync(join(prismaCopy, 'migrations', '20260824003300_phase30_review_closure'), {
    recursive: true,
    force: true,
  });
  await run(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_BASELINE_03100=PASS');
  const client = pg.getPgClient('teaching_upgrade');
  await client.connect();
  await client.query(
    `INSERT INTO knowledge_sources (id, visibility, title, origin, metadata) VALUES ('11111111-1111-4111-8111-111111111111', 'PLATFORM_SHARED', 'Legacy source', 'upgrade-test', '{}')`,
  );
  await client.query(
    `INSERT INTO source_versions (id, source_id, version_number, content_hash, content_reference, content_mime_type, metadata, request_fingerprint, idempotency_key, lifecycle) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1, repeat('a', 64), 'fixture://legacy', 'text/plain', '{}', repeat('b', 64), 'legacy-v1', 'SUSPENDED')`,
  );
  await client.end();
  cpSync(
    join(sourcePrisma, 'migrations', '20260824003200_phase30_final_remediation'),
    join(prismaCopy, 'migrations', '20260824003200_phase30_final_remediation'),
    { recursive: true },
  );
  await run(join(prismaCopy, 'schema.prisma'));
  const verify = pg.getPgClient('teaching_upgrade');
  await verify.connect();
  const backfill = await verify.query(
    `SELECT from_status, to_status, actor_user_id, reason FROM source_lifecycle_events WHERE source_version_id = '22222222-2222-4222-8222-222222222222'`,
  );
  if (
    backfill.rows.length !== 1 ||
    backfill.rows[0].from_status !== null ||
    backfill.rows[0].to_status !== 'SUSPENDED' ||
    backfill.rows[0].actor_user_id !== null
  )
    throw new Error('lifecycle backfill evidence failed');
  await verify.end();
  console.log('UPGRADE_03100_TO_03200=PASS');
  cpSync(
    join(sourcePrisma, 'migrations', '20260824003300_phase30_review_closure'),
    join(prismaCopy, 'migrations', '20260824003300_phase30_review_closure'),
    { recursive: true },
  );
  await run(join(prismaCopy, 'schema.prisma'));
  const closureVerify = pg.getPgClient('teaching_upgrade');
  await closureVerify.connect();
  const uniqueConstraint = await closureVerify.query(
    `SELECT 1 FROM pg_constraint WHERE conrelid = 'source_versions'::regclass AND conname = 'source_versions_source_id_version_number_key'`,
  );
  const identityTrigger = await closureVerify.query(
    `SELECT 1 FROM pg_trigger WHERE tgrelid = 'knowledge_sources'::regclass AND tgname = 'knowledge_source_identity_immutable' AND NOT tgisinternal`,
  );
  const chainTrigger = await closureVerify.query(
    `SELECT 1 FROM pg_trigger WHERE tgrelid = 'source_lifecycle_events'::regclass AND tgname = 'source_lifecycle_chain_insert' AND NOT tgisinternal`,
  );
  if (
    uniqueConstraint.rowCount !== 1 ||
    identityTrigger.rowCount !== 1 ||
    chainTrigger.rowCount !== 1
  )
    throw new Error('review-closure constraints or triggers missing');
  let rejectedForgedLifecycle = false;
  try {
    await closureVerify.query(
      `INSERT INTO source_lifecycle_events (id, source_version_id, source_id, organization_id, from_status, to_status, reason) VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', NULL, NULL, 'ACTIVE', 'forged')`,
    );
  } catch {
    rejectedForgedLifecycle = true;
  }
  await closureVerify.end();
  if (!rejectedForgedLifecycle) throw new Error('forged lifecycle insert was accepted');
  console.log('UPGRADE_03200_TO_03300=PASS');
  completed = true;
} finally {
  if (process.platform === 'win32' && pg.process?.pid) {
    const killResult = spawnSync('taskkill', ['/pid', String(pg.process.pid), '/f', '/t'], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    if (killResult.error) {
      try {
        process.kill(pg.process.pid);
      } catch {
        // The embedded server may already have exited after the timeout.
      }
    }
  } else {
    await pg.stop();
  }
  rmSync(prismaCopy, { recursive: true, force: true });
  if (completed) process.exit(0);
}
