import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME ?? 'phase50',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE ?? process.cwd(),
  });
  syncBuiltinESMExports();
}
if (process.platform === 'win32') fsPromises.chmod = async () => undefined;
const { default: EmbeddedPostgres } = await import('embedded-postgres');

const migrationRoot = 'packages/db/prisma/migrations';
const phase50Migration = '20260826005000_phase50_validation_engine';
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d+_/.test(name))
  .sort();
if (migrations.length !== 15 || migrations.at(-1) !== phase50Migration) {
  throw new Error('Phase 50 staged upgrade requires exactly 15 migrations ending at 05000');
}
if (!existsSync(`${migrationRoot}/${phase50Migration}/migration.sql`)) {
  throw new Error('Phase 50 migration is missing');
}
execFileSync(
  'git',
  [
    'diff',
    '--exit-code',
    '8f09173f073f13b8e565a12f3d37abac18b33bf5',
    '--',
    ...migrations.slice(0, 14).map((name) => `${migrationRoot}/${name}/migration.sql`),
  ],
  { stdio: 'inherit' },
);

const databaseDir = join(os.tmpdir(), `teaching-phase50-upgrade-postgres-${process.pid}`);
const prismaCopy = join(os.tmpdir(), `teaching-phase50-upgrade-prisma-${process.pid}`);
const port = 55900 + (process.pid % 500);
rmSync(databaseDir, { recursive: true, force: true });
rmSync(prismaCopy, { recursive: true, force: true });
mkdirSync(databaseDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'phase50',
  password: 'phase50_local_only',
  port,
  persistent: false,
  onLog: () => undefined,
});
const virtualStores = [resolve('node_modules/.pnpm'), resolve('../v')];
const prismaStore = virtualStores.find(
  (store) => existsSync(store) && readdirSync(store).some((name) => name.startsWith('prisma@')),
);
const prismaPackage =
  prismaStore && readdirSync(prismaStore).find((name) => name.startsWith('prisma@'));
if (!prismaPackage) throw new Error('Prisma CLI package is unavailable');
const prismaCli = resolve(prismaStore, prismaPackage, 'node_modules/prisma/build/index.js');
const databaseUrl = (database) =>
  `postgresql://phase50:phase50_local_only@127.0.0.1:${port}/${database}?schema=public`;
const deploy = (database, schema) =>
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', DATABASE_URL: databaseUrl(database) },
  });

const expectDatabaseError = async (label, operation, code) => {
  try {
    await operation();
  } catch (error) {
    if (error?.code === code) {
      console.log(`${label}=PASS code=${code}`);
      return;
    }
    throw error;
  }
  throw new Error(`${label} did not fail with ${code}`);
};

const catalogFingerprint = async (database) => {
  const client = pg.getPgClient(database);
  await client.connect();
  const result = await client.query(`
    WITH catalog AS (
      SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' ||
        COALESCE(column_default, '') || '|' || is_nullable AS value
      FROM information_schema.columns WHERE table_schema='public'
      UNION ALL
      SELECT 'constraint|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace='public'::regnamespace
      UNION ALL
      SELECT 'index|' || schemaname || '|' || indexname || '|' || indexdef
      FROM pg_indexes WHERE schemaname='public'
      UNION ALL
      SELECT 'trigger|' || c.relname || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
      UNION ALL
      SELECT 'function|' || p.oid::regprocedure::text || '|' || pg_get_functiondef(p.oid)
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    )
    SELECT md5(COALESCE(string_agg(value, E'\\n' ORDER BY value), '')) AS fingerprint,
           count(*)::int AS rows FROM catalog
  `);
  await client.end();
  return result.rows[0];
};

const ids = {
  organization: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  membership: '33333333-3333-4333-8333-333333333333',
  curriculum: '44444444-4444-4444-8444-444444444444',
  version: '55555555-5555-4555-8555-555555555555',
  assessment: '66666666-6666-4666-8666-666666666666',
  revision: '77777777-7777-4777-8777-777777777777',
  successRun: '88888888-8888-4888-8888-888888888888',
  incompleteRun: '99999999-9999-4999-8999-999999999999',
};

let completed = false;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('teaching_upgrade');
  await pg.createDatabase('teaching_clean');
  const sourcePrisma = resolve('packages/db/prisma');
  cpSync(sourcePrisma, prismaCopy, { recursive: true });
  rmSync(join(prismaCopy, 'migrations', phase50Migration), { recursive: true, force: true });
  deploy('teaching_upgrade', join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04600_APPLIED');

  const seed = pg.getPgClient('teaching_upgrade');
  await seed.connect();
  await seed.query('SET session_replication_role = replica');
  await seed.query(
    `INSERT INTO organizations (id,name,workspace_type) VALUES ($1,'Phase 50 upgrade','SCHOOL')`,
    [ids.organization],
  );
  await seed.query(
    `INSERT INTO users (id,normalized_email,status,platform_admin) VALUES ($1,'phase50-upgrade@example.test','ACTIVE',false)`,
    [ids.user],
  );
  await seed.query(
    `INSERT INTO memberships (id,user_id,organization_id,role,status) VALUES ($1,$2,$3,'TEACHER','ACTIVE')`,
    [ids.membership, ids.user, ids.organization],
  );
  await seed.query(
    `INSERT INTO curricula (id,code,education_system_code,subject_code,display_name) VALUES ($1,'UPGRADE50','IL','MATH','Upgrade')`,
    [ids.curriculum],
  );
  await seed.query(
    `INSERT INTO curriculum_versions (id,curriculum_id,version_number,status,published_at) VALUES ($1,$2,1,'PUBLISHED',now())`,
    [ids.version, ids.curriculum],
  );
  await seed.query(
    `INSERT INTO assessments (id,organization_id,type,title,created_by_user_id) VALUES ($1,$2,'WORKSHEET','Upgrade',$3)`,
    [ids.assessment, ids.organization, ids.user],
  );
  await seed.query(
    `INSERT INTO assessment_revisions (id,assessment_id,revision_number,idempotency_key,request_fingerprint,state,curriculum_version_id,scoring_mode) VALUES ($1,$2,1,'upgrade-revision',repeat('a',64),'FINALIZED',$3,'NONE')`,
    [ids.revision, ids.assessment, ids.version],
  );
  await seed.query('SET session_replication_role = origin');
  await seed.end();
  console.log('UPGRADE_STAGE=04600_DATA_SEEDED');

  cpSync(
    join(sourcePrisma, 'migrations', phase50Migration),
    join(prismaCopy, 'migrations', phase50Migration),
    { recursive: true },
  );
  deploy('teaching_upgrade', join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=05000_APPLIED');
  const verify = pg.getPgClient('teaching_upgrade');
  await verify.connect();
  const preserved = await verify.query(
    `SELECT 1 FROM assessment_revisions WHERE id=$1 AND state='FINALIZED'`,
    [ids.revision],
  );
  if (preserved.rowCount !== 1) throw new Error('Phase 40 revision was not preserved');
  const registry = await verify.query(
    `SELECT count(*)::int AS count FROM validation_rule_definitions WHERE ruleset_version='v1'`,
  );
  if (registry.rows[0].count !== 11) throw new Error('Phase 50 registry does not contain 11 rules');

  await verify.query(
    `INSERT INTO validation_runs (id,organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,idempotency_key,request_fingerprint) VALUES ($1,$2,$3,$4,$5,'v1','local-disabled-v1',1,'upgrade-success',repeat('b',64))`,
    [ids.successRun, ids.organization, ids.assessment, ids.revision, ids.user],
  );
  await verify.query(
    `UPDATE validation_runs SET state='PROCESSING',attempts=1,processing_started_at=now(),lease_expires_at=now()+interval '1 minute' WHERE id=$1`,
    [ids.successRun],
  );
  await verify.query(
    `INSERT INTO validation_rule_executions (validation_run_id,rule_definition_id,outcome,evidence)
     SELECT $1,id,'PASS',jsonb_build_object('identity',rule_id,'revisionId',$2::text)
     FROM validation_rule_definitions WHERE ruleset_version='v1' ORDER BY deterministic_order`,
    [ids.successRun, ids.revision],
  );
  await verify.query(
    `INSERT INTO semantic_evaluations (validation_run_id,evaluator_version,prompt_version,model_configuration_version,schema_version,state,latency_ms,usage) VALUES ($1,'local-disabled-v1','validation-prompt-v1','local-none-v1','1.0.0','SUCCEEDED',0,'{}')`,
    [ids.successRun],
  );
  await verify.query(
    `UPDATE validation_runs SET state='SUCCEEDED',deterministic_pass_count=11,deterministic_fail_count=0,semantic_finding_count=0,completed_at=now(),lease_expires_at=NULL WHERE id=$1`,
    [ids.successRun],
  );
  const approvable = await verify.query(`SELECT assert_revision_approvable($1,$2) AS run_id`, [
    ids.organization,
    ids.revision,
  ]);
  if (approvable.rows[0].run_id !== ids.successRun)
    throw new Error('upgraded positive readiness probe returned the wrong run');
  console.log('UPGRADE_PROBE_POSITIVE_COMPLETION_READINESS=PASS');

  await expectDatabaseError(
    'UPGRADE_PROBE_APPEND_ONLY',
    () =>
      verify.query(
        `UPDATE validation_rule_executions SET evidence=evidence || '{"tampered":true}'::jsonb WHERE validation_run_id=$1`,
        [ids.successRun],
      ),
    'P5001',
  );
  await verify.query(
    `INSERT INTO validation_runs (id,organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,idempotency_key,request_fingerprint) VALUES ($1,$2,$3,$4,$5,'v1','local-disabled-v1',2,'upgrade-incomplete',repeat('c',64))`,
    [ids.incompleteRun, ids.organization, ids.assessment, ids.revision, ids.user],
  );
  await verify.query(
    `UPDATE validation_runs SET state='PROCESSING',attempts=1,processing_started_at=now(),lease_expires_at=now()+interval '1 minute' WHERE id=$1`,
    [ids.incompleteRun],
  );
  await expectDatabaseError(
    'UPGRADE_PROBE_INCOMPLETE_COMPLETION',
    () =>
      verify.query(
        `UPDATE validation_runs SET state='SUCCEEDED',deterministic_pass_count=11,completed_at=now(),lease_expires_at=NULL WHERE id=$1`,
        [ids.incompleteRun],
      ),
    'P5022',
  );
  await expectDatabaseError(
    'UPGRADE_PROBE_NEWEST_NON_READY',
    () =>
      verify.query(`SELECT assert_revision_approvable($1,$2)`, [ids.organization, ids.revision]),
    'P5029',
  );
  await expectDatabaseError(
    'UPGRADE_PROBE_FORGED_EVIDENCE',
    () =>
      verify.query(
        `INSERT INTO validation_rule_executions (validation_run_id,rule_definition_id,outcome,evidence) SELECT $1,id,'PASS','{}'::jsonb FROM validation_rule_definitions WHERE ruleset_version='v1' ORDER BY deterministic_order LIMIT 1`,
        [ids.incompleteRun],
      ),
    'P5031',
  );
  await verify.end();

  deploy('teaching_clean', join(sourcePrisma, 'schema.prisma'));
  const upgradedFingerprint = await catalogFingerprint('teaching_upgrade');
  const cleanFingerprint = await catalogFingerprint('teaching_clean');
  if (
    upgradedFingerprint.fingerprint !== cleanFingerprint.fingerprint ||
    upgradedFingerprint.rows !== cleanFingerprint.rows
  ) {
    throw new Error(
      `catalog fingerprint mismatch: upgraded=${upgradedFingerprint.fingerprint}/${upgradedFingerprint.rows} clean=${cleanFingerprint.fingerprint}/${cleanFingerprint.rows}`,
    );
  }
  console.log('PHASE40_TO_PHASE50_UPGRADE=PASS');
  console.log('UPGRADE_04600_TO_05000_POSITIVE_NEGATIVE_PROBES=PASS');
  console.log(
    `SECOND_CLEAN_15_MIGRATION_DATABASE=PASS fingerprint=${upgradedFingerprint.fingerprint} rows=${upgradedFingerprint.rows}`,
  );
  completed = true;
} finally {
  if (process.platform === 'win32' && pg.process?.pid) {
    spawnSync('taskkill', ['/pid', String(pg.process.pid), '/f', '/t'], { stdio: 'ignore' });
  } else {
    await pg.stop();
  }
  rmSync(prismaCopy, { recursive: true, force: true });
  try {
    rmSync(databaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    console.warn(`PostgreSQL data cleanup deferred: ${databaseDir}`);
  }
  if (completed) process.exit(0);
}
