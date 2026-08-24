import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import EmbeddedPostgres from 'embedded-postgres';

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME ?? 'phase40',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE ?? process.cwd(),
  });
  syncBuiltinESMExports();
}

const databaseDir = join(os.tmpdir(), 'teaching-phase40-upgrade-postgres');
const prismaCopy = join(os.tmpdir(), 'teaching-phase40-upgrade-prisma');
rmSync(databaseDir, { recursive: true, force: true });
rmSync(prismaCopy, { recursive: true, force: true });
mkdirSync(databaseDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'phase40',
  password: 'phase40_local_only',
  port: 55434,
  persistent: false,
  onLog: () => undefined,
});
const databaseUrl =
  'postgresql://phase40:phase40_local_only@127.0.0.1:55434/teaching_upgrade?schema=public';
const runDeploy = (schema) => {
  const args = ['--filter', '@teach/db', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schema];
  const env = { ...process.env, DATABASE_URL: databaseUrl, CI: 'true' };
  if (process.env.npm_execpath)
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit', env });
  else execFileSync('pnpm.cmd', args, { stdio: 'inherit', env });
};
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('teaching_upgrade');
  const sourcePrisma = resolve('packages/db/prisma');
  cpSync(sourcePrisma, prismaCopy, { recursive: true });
  for (const migration of readdirSync(join(prismaCopy, 'migrations')).filter((name) =>
    [
      '20260824004000_phase40_generation_engine',
      '20260824004100_phase40_review_remediation',
      '20260824004200_phase40_final_review_closure',
    ].includes(name),
  ))
    rmSync(join(prismaCopy, 'migrations', migration), { recursive: true, force: true });
  runDeploy(join(prismaCopy, 'schema.prisma'));
  const client = pg.getPgClient('teaching_upgrade');
  await client.connect();
  await client.query(
    `INSERT INTO organizations (id, name, workspace_type) VALUES ('11111111-1111-4111-8111-111111111111', 'upgrade', 'SCHOOL')`,
  );
  await client.query(
    `INSERT INTO users (id, normalized_email, status, platform_admin) VALUES ('22222222-2222-4222-8222-222222222222', 'upgrade@example.test', 'ACTIVE', false)`,
  );
  await client.query(
    `INSERT INTO memberships (id, user_id, organization_id, role, status) VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'TEACHER', 'ACTIVE')`,
  );
  await client.query(
    `INSERT INTO curricula (id, code, education_system_code, subject_code, display_name) VALUES ('44444444-4444-4444-8444-444444444444', 'UPGRADE40', 'IL', 'HE', 'Upgrade')`,
  );
  await client.query(
    `INSERT INTO curriculum_versions (id, curriculum_id, version_number, status) VALUES ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', 1, 'DRAFT')`,
  );
  await client.query(
    `INSERT INTO assessments (id, organization_id, type, title, created_by_user_id) VALUES ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'WORKSHEET', 'Upgrade', '22222222-2222-4222-8222-222222222222')`,
  );
  await client.query(
    `INSERT INTO knowledge_sources (id, organization_id, visibility, title, origin, metadata) VALUES ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'ORGANIZATION_PRIVATE', 'Legacy', 'upgrade', '{}')`,
  );
  await client.query(
    `INSERT INTO source_versions (id, source_id, version_number, content_hash, content_reference, content_mime_type, metadata, request_fingerprint, idempotency_key, lifecycle) VALUES ('88888888-8888-4888-8888-888888888888', '77777777-7777-4777-8777-777777777777', 1, repeat('a', 64), 'fixture://upgrade', 'text/plain', '{}', repeat('b', 64), 'legacy-v1', 'DRAFT')`,
  );
  const legacy = await client.query(
    `SELECT id FROM source_versions WHERE id = '88888888-8888-4888-8888-888888888888'`,
  );
  if (legacy.rowCount !== 1) throw new Error('Phase 30 seed was not preserved');
  await client.end();
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004000_phase40_generation_engine'),
    join(prismaCopy, 'migrations', '20260824004000_phase40_generation_engine'),
    { recursive: true },
  );
  runDeploy(join(prismaCopy, 'schema.prisma'));
  const phase40Seed = pg.getPgClient('teaching_upgrade');
  await phase40Seed.connect();
  await phase40Seed.query(
    `INSERT INTO generation_runs (id, organization_id, requesting_user_id, assessment_id, operation, idempotency_key, request_fingerprint, frozen_specification, curriculum_version_id, prompt_template_version, prompt_template_hash, model_configuration_version, model_configuration_hash, response_schema_version, response_schema_hash) VALUES ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '66666666-6666-4666-8666-666666666666', 'DRAFT', 'upgrade-run', repeat('c', 64), '{"version":"1.0.0","operation":"DRAFT"}', '55555555-5555-4555-8555-555555555555', 'draft-v1', repeat('d', 64), 'fake-v1', repeat('e', 64), '1.0.0', repeat('f', 64))`,
  );
  await phase40Seed.query(
    `UPDATE generation_runs SET state='PROCESSING', attempts=1 WHERE id='99999999-9999-4999-8999-999999999999'`,
  );
  await phase40Seed.query(
    `INSERT INTO generation_usages (generation_run_id, attempt, provider, model, request_id, input_tokens, output_tokens, total_tokens, cost_micros, finish_reason) VALUES ('99999999-9999-4999-8999-999999999999', 1, 'fake', 'fake', 'upgrade-request', 1, 1, 2, 0, 'stop')`,
  );
  await phase40Seed.end();
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004100_phase40_review_remediation'),
    join(prismaCopy, 'migrations', '20260824004100_phase40_review_remediation'),
    { recursive: true },
  );
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004200_phase40_final_review_closure'),
    join(prismaCopy, 'migrations', '20260824004200_phase40_final_review_closure'),
    { recursive: true },
  );
  runDeploy(join(prismaCopy, 'schema.prisma'));
  const verify = pg.getPgClient('teaching_upgrade');
  await verify.connect();
  const checks = await Promise.all([
    verify.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'generation_runs' AND column_name = 'lease_expires_at'`,
    ),
    verify.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'generation_usage_guard' AND NOT tgisinternal`,
    ),
    verify.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'generation_context_identity' AND NOT tgisinternal`,
    ),
    verify.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'question_source_identity' AND NOT tgisinternal`,
    ),
    verify.query(`SELECT 1 FROM source_versions WHERE id = '88888888-8888-4888-8888-888888888888'`),
    verify.query(
      `SELECT 1 FROM generation_runs WHERE id = '99999999-9999-4999-8999-999999999999' AND state = 'PROCESSING' AND attempts = 1`,
    ),
    verify.query(
      `SELECT 1 FROM generation_usages WHERE generation_run_id = '99999999-9999-4999-8999-999999999999' AND total_tokens = input_tokens + output_tokens`,
    ),
    verify.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'generation_context_items_lineage_ck'`,
    ),
    verify.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'phase40_review_source_lock' AND NOT tgisinternal`,
    ),
  ]);
  await verify.end();
  if (checks.some((check) => check.rowCount !== 1))
    throw new Error('Phase 40 upgrade assertions failed');
  const migrations = readdirSync('packages/db/prisma/migrations').filter((name) =>
    /^\d+_/.test(name),
  );
  if (
    migrations.length !== 10 ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004100_phase40_review_remediation/migration.sql',
    ) ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004200_phase40_final_review_closure/migration.sql',
    )
  )
    throw new Error('final migration count mismatch');
  console.log('PHASE30_TO_PHASE40_UPGRADE=PASS');
  console.log('UPGRADE_03300_TO_04000_TO_04100_TO_04200=PASS');
  console.log('DATA_PRESERVATION_AND_TRIGGER_ASSERTIONS=PASS');
} finally {
  if (process.platform === 'win32' && pg.process?.pid)
    spawnSync('taskkill', ['/pid', String(pg.process.pid), '/f', '/t'], { stdio: 'ignore' });
  rmSync(prismaCopy, { recursive: true, force: true });
}
