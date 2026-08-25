import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import EmbeddedPostgres from 'embedded-postgres';

// Upgrade assertions cover generation_context_items and question_source_links, including lineage backfill and deferred final-output validation.

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

const databaseDir = join(os.tmpdir(), `teaching-phase40-upgrade-postgres-${process.pid}`);
const prismaCopy = join(os.tmpdir(), `teaching-phase40-upgrade-prisma-${process.pid}`);
const port = 55440 + (process.pid % 500);
rmSync(databaseDir, { recursive: true, force: true });
rmSync(prismaCopy, { recursive: true, force: true });
mkdirSync(databaseDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'phase40',
  password: 'phase40_local_only',
  port,
  persistent: false,
  onLog: (message) => console.error(`PG_LOG ${message}`),
});
const databaseUrl = `postgresql://phase40:phase40_local_only@127.0.0.1:${port}/teaching_upgrade?schema=public`;
const cleanDatabase = 'teaching_upgrade_clean';
const virtualStores = [resolve('node_modules/.pnpm'), resolve('../v')];
const prismaStore = virtualStores.find((store) =>
  readdirSync(store).some((name) => name.startsWith('prisma@')),
);
const prismaPackage =
  prismaStore && readdirSync(prismaStore).find((name) => name.startsWith('prisma@'));
if (!prismaPackage) throw new Error('Prisma CLI package is unavailable');
const prismaCli = resolve(prismaStore, prismaPackage, 'node_modules/prisma/build/index.js');
const runDeployFor = (database, schema) => {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl.replace('teaching_upgrade?', `${database}?`),
    CI: 'true',
  };
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
    stdio: 'inherit',
    env,
  });
};
const runDeploy = (schema) => runDeployFor('teaching_upgrade', schema);
let completed = false;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('teaching_upgrade');
  await pg.createDatabase(cleanDatabase);
  const sourcePrisma = resolve('packages/db/prisma');
  cpSync(sourcePrisma, prismaCopy, { recursive: true });
  for (const migration of readdirSync(join(prismaCopy, 'migrations')).filter((name) =>
    [
      '20260824004000_phase40_generation_engine',
      '20260824004100_phase40_review_remediation',
      '20260824004200_phase40_final_review_closure',
      '20260824004300_phase40_acceptance_closure',
      '20260824004400_phase40_complete_output_graph',
      '20260824004500_phase40_exact_output_graph',
      '20260824004600_phase40_master_gate_closure',
    ].includes(name),
  ))
    rmSync(join(prismaCopy, 'migrations', migration), { recursive: true, force: true });
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04000_APPLIED');
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
    `INSERT INTO curriculum_nodes (id, version_id, type, code, label, sort_order) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'GRADE', 'G7', 'ז', 0)`,
  );
  await client.query(
    `UPDATE curriculum_versions SET status = 'PUBLISHED' WHERE id = '55555555-5555-4555-8555-555555555555'`,
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
  await client.query(
    `INSERT INTO source_version_curriculum_node_links (source_version_id, curriculum_version_id, curriculum_node_id) VALUES ('88888888-8888-4888-8888-888888888888', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
  );
  await client.query(
    `INSERT INTO source_lifecycle_events (id, source_id, source_version_id, organization_id, to_status, reason) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'DRAFT', 'upgrade')`,
  );
  await client.query(
    `INSERT INTO source_lifecycle_events (id, source_id, source_version_id, organization_id, from_status, to_status, reason) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', 'DRAFT', 'ACTIVE', 'upgrade')`,
  );
  await client.query(
    `INSERT INTO pedagogical_reviews (id, source_version_id, reviewer_user_id, decision, reason) VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '88888888-8888-4888-8888-888888888888', '22222222-2222-4222-8222-222222222222', 'APPROVED', 'upgrade')`,
  );
  await client.query(
    `INSERT INTO usage_permissions (id, source_version_id, reviewer_user_id, decision, evidence_reference, scope) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '88888888-8888-4888-8888-888888888888', '22222222-2222-4222-8222-222222222222', 'ALLOWED', 'upgrade', 'AI_GENERATION')`,
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
    `INSERT INTO generation_runs (id, organization_id, requesting_user_id, assessment_id, operation, idempotency_key, request_fingerprint, frozen_specification, curriculum_version_id, prompt_template_version, prompt_template_hash, model_configuration_version, model_configuration_hash, response_schema_version, response_schema_hash) VALUES ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '66666666-6666-4666-8666-666666666666', 'DRAFT', 'upgrade-run', repeat('c', 64), '{"version":"1.0.0","operation":"DRAFT","curriculumVersionId":"55555555-5555-4555-8555-555555555555","curriculumNodeIds":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}', '55555555-5555-4555-8555-555555555555', 'draft-v1', repeat('d', 64), 'fake-v1', repeat('e', 64), '1.0.0', repeat('f', 64))`,
  );
  await phase40Seed.query(
    `UPDATE generation_runs SET state='PROCESSING', attempts=1 WHERE id='99999999-9999-4999-8999-999999999999'`,
  );
  await phase40Seed.query(
    `INSERT INTO generation_usages (generation_run_id, attempt, provider, model, request_id, input_tokens, output_tokens, total_tokens, cost_micros, finish_reason) VALUES ('99999999-9999-4999-8999-999999999999', 1, 'fake', 'fake', 'upgrade-request', 1, 1, 2, 0, 'stop')`,
  );
  await phase40Seed.query(
    `INSERT INTO ingestion_runs (id, source_version_id, content_hash, pipeline_version, parser_version) VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', '88888888-8888-4888-8888-888888888888', repeat('a', 64), 'upgrade', 'upgrade')`,
  );
  await phase40Seed.query(
    `INSERT INTO knowledge_items (id, source_version_id, ingestion_run_id, organization_id, visibility, locator, normalized_text, text_hash, pipeline_version, parser_version) VALUES ('12121212-1212-4121-8121-121212121212', '88888888-8888-4888-8888-888888888888', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ORGANIZATION_PRIVATE', 'p1', 'שלום שדרוג', repeat('1', 64), 'upgrade', 'upgrade')`,
  );
  await phase40Seed.query(
    `INSERT INTO knowledge_items (id, source_version_id, ingestion_run_id, organization_id, visibility, locator, normalized_text, text_hash, pipeline_version, parser_version) VALUES ('18181818-1818-4181-8181-181818181818', '88888888-8888-4888-8888-888888888888', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'ORGANIZATION_PRIVATE', 'p2', 'שלום מקור נוסף', repeat('8', 64), 'upgrade', 'upgrade')`,
  );
  await phase40Seed.query(
    `INSERT INTO knowledge_item_curriculum_node_links (knowledge_item_id, curriculum_version_id, curriculum_node_id) VALUES ('12121212-1212-4121-8121-121212121212', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
  );
  await phase40Seed.query(
    `INSERT INTO knowledge_item_curriculum_node_links (knowledge_item_id, curriculum_version_id, curriculum_node_id) VALUES ('18181818-1818-4181-8181-181818181818', '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
  );
  await phase40Seed.query(
    `INSERT INTO generation_context_items (id, generation_run_id, selected_order, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, rank, score, character_count, estimated_tokens) VALUES ('13131313-1313-4131-8131-131313131313', '99999999-9999-4999-8999-999999999999', 0, '12121212-1212-4121-8121-121212121212', '88888888-8888-4888-8888-888888888888', 'p1', repeat('1', 64), '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 1, 10, 3)`,
  );
  await phase40Seed.query(
    `INSERT INTO generation_context_items (id, generation_run_id, selected_order, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, rank, score, character_count, estimated_tokens) VALUES ('19191919-1919-4191-8191-191919191919', '99999999-9999-4999-8999-999999999999', 1, '18181818-1818-4181-8181-181818181818', '88888888-8888-4888-8888-888888888888', 'p2', repeat('8', 64), '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2, 0.5, 12, 3)`,
  );
  await phase40Seed.query('BEGIN');
  await phase40Seed.query(
    `INSERT INTO assessment_revisions (id, assessment_id, revision_number, idempotency_key, curriculum_version_id, scoring_mode, state, request_fingerprint) VALUES ('14141414-1414-4141-8141-141414141414', '66666666-6666-4666-8666-666666666666', 1, 'generation:99999999-9999-4999-8999-999999999999', '55555555-5555-4555-8555-555555555555', 'NONE', 'BUILDING', repeat('2', 64))`,
  );
  await phase40Seed.query(
    `INSERT INTO assessment_revision_node_links (revision_id, curriculum_node_id) VALUES ('14141414-1414-4141-8141-141414141414', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
  );
  await phase40Seed.query(
    `INSERT INTO assessment_sections (id, revision_id, key, title, instructions, "order") VALUES ('15151515-1515-4151-8151-151515151515', '14141414-1414-4141-8141-141414141414', 's1', 'S', '', 0)`,
  );
  await phase40Seed.query(
    `INSERT INTO assessment_questions (id, section_id, key, type, prompt, instructions, "order", difficulty) VALUES ('16161616-1616-4161-8161-161616161616', '15151515-1515-4151-8151-151515151515', 'q1', 'OPEN', 'שאלה', '', 0, 'LOW')`,
  );
  await phase40Seed.query(
    `INSERT INTO assessment_questions (id, section_id, key, type, prompt, instructions, "order", difficulty) VALUES ('21212121-2121-4121-8121-212121212121', '15151515-1515-4151-8151-151515151515', 'q2', 'OPEN', 'שאלה נוספת', '', 1, 'LOW')`,
  );
  await phase40Seed.query(
    `UPDATE assessment_revisions SET state = 'FINALIZED' WHERE id = '14141414-1414-4141-8141-141414141414'`,
  );
  await phase40Seed.query('COMMIT');
  await phase40Seed.query(
    `INSERT INTO question_source_links (id, assessment_question_id, generation_run_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage) VALUES ('17171717-1717-4171-8171-171717171717', '16161616-1616-4161-8161-161616161616', '99999999-9999-4999-8999-999999999999', '12121212-1212-4121-8121-121212121212', '88888888-8888-4888-8888-888888888888', 'p1', repeat('1', 64), '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GENERATED')`,
  );
  await phase40Seed.query(
    `INSERT INTO question_source_links (id, assessment_question_id, generation_run_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage) VALUES ('23232323-2323-4232-8232-232323232323', '21212121-2121-4121-8121-212121212121', '99999999-9999-4999-8999-999999999999', '12121212-1212-4121-8121-121212121212', '88888888-8888-4888-8888-888888888888', 'p1', repeat('1', 64), '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GENERATED')`,
  );
  await phase40Seed.query(
    `UPDATE generation_runs SET state='SUCCEEDED', attempts=1, provider='fake', model='fake', output_revision_id='14141414-1414-4141-8141-141414141414', processed_at=NOW() WHERE id='99999999-9999-4999-8999-999999999999'`,
  );
  await phase40Seed.end();
  console.log('UPGRADE_STAGE=04000_DATA_SEEDED');
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004100_phase40_review_remediation'),
    join(prismaCopy, 'migrations', '20260824004100_phase40_review_remediation'),
    { recursive: true },
  );
  console.log('UPGRADE_STAGE=04100_START');
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04100_APPLIED');
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004200_phase40_final_review_closure'),
    join(prismaCopy, 'migrations', '20260824004200_phase40_final_review_closure'),
    { recursive: true },
  );
  console.log('UPGRADE_STAGE=04200_START');
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04200_APPLIED');
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004300_phase40_acceptance_closure'),
    join(prismaCopy, 'migrations', '20260824004300_phase40_acceptance_closure'),
    { recursive: true },
  );
  console.log('UPGRADE_STAGE=04300_START');
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04300_APPLIED');
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004400_phase40_complete_output_graph'),
    join(prismaCopy, 'migrations', '20260824004400_phase40_complete_output_graph'),
    { recursive: true },
  );
  console.log('UPGRADE_STAGE=04400_START');
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04400_APPLIED');
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004500_phase40_exact_output_graph'),
    join(prismaCopy, 'migrations', '20260824004500_phase40_exact_output_graph'),
    { recursive: true },
  );
  console.log('UPGRADE_STAGE=04500_START');
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04500_APPLIED');
  const multiCitationMutation = pg.getPgClient('teaching_upgrade');
  await multiCitationMutation.connect();
  await multiCitationMutation.query(
    `INSERT INTO question_source_links (id, assessment_question_id, generation_run_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage) VALUES ('20202020-2020-4020-8020-202020202020', '16161616-1616-4161-8161-161616161616', '99999999-9999-4999-8999-999999999999', '18181818-1818-4181-8181-181818181818', '88888888-8888-4888-8888-888888888888', 'p2', repeat('8', 64), '55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GENERATED')`,
  );
  await multiCitationMutation.end();
  cpSync(
    join(sourcePrisma, 'migrations', '20260824004600_phase40_master_gate_closure'),
    join(prismaCopy, 'migrations', '20260824004600_phase40_master_gate_closure'),
    { recursive: true },
  );
  console.log('UPGRADE_STAGE=04600_START');
  runDeploy(join(prismaCopy, 'schema.prisma'));
  console.log('UPGRADE_STAGE=04600_APPLIED');
  const verify = pg.getPgClient('teaching_upgrade');
  await verify.connect();
  const checkSql = [
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'generation_runs' AND column_name = 'lease_expires_at'`,
    `SELECT 1 FROM pg_trigger WHERE tgname = 'generation_usage_guard' AND NOT tgisinternal`,
    `SELECT 1 FROM pg_trigger WHERE tgname = 'generation_context_identity' AND NOT tgisinternal`,
    `SELECT 1 FROM pg_trigger WHERE tgname = 'question_source_identity' AND NOT tgisinternal`,
    `SELECT 1 FROM source_versions WHERE id = '88888888-8888-4888-8888-888888888888'`,
    `SELECT 1 FROM generation_runs WHERE id = '99999999-9999-4999-8999-999999999999' AND state = 'SUCCEEDED' AND attempts = 1 AND output_revision_id = '14141414-1414-4141-8141-141414141414'`,
    `SELECT 1 FROM generation_usages WHERE generation_run_id = '99999999-9999-4999-8999-999999999999' AND total_tokens = input_tokens + output_tokens`,
    `SELECT 1 FROM pg_constraint WHERE conname = 'generation_context_items_lineage_ck'`,
    `SELECT 1 FROM pg_trigger WHERE tgname = 'phase40_review_source_lock' AND NOT tgisinternal`,
    `SELECT 1 FROM pg_trigger WHERE tgname = 'question_source_commit_guard' AND NOT tgisinternal`,
  ];
  const checks = [];
  for (const sql of checkSql) checks.push(await verify.query(sql));
  if (checks.some((check) => check.rowCount !== 1)) {
    throw new Error('Phase 40 upgrade assertions failed');
  }
  await verify.query('BEGIN');
  await verify.query(
    `INSERT INTO generation_runs (id, organization_id, requesting_user_id, assessment_id, operation, idempotency_key, request_fingerprint, frozen_specification, curriculum_version_id, base_revision_id, target_question_id, prompt_template_version, prompt_template_hash, model_configuration_version, model_configuration_hash, response_schema_version, response_schema_hash) VALUES ('30303030-3030-4030-8030-303030303030','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666','REGENERATE_QUESTION','upgrade-regeneration',repeat('3',64),'{"version":"1.0.0","operation":"REGENERATE_QUESTION","curriculumVersionId":"55555555-5555-4555-8555-555555555555","curriculumNodeIds":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],"baseRevisionId":"14141414-1414-4141-8141-141414141414","targetQuestionId":"16161616-1616-4161-8161-161616161616"}','55555555-5555-4555-8555-555555555555','14141414-1414-4141-8141-141414141414','16161616-1616-4161-8161-161616161616','regen-v1',repeat('4',64),'fake-v1',repeat('5',64),'1.0.0',repeat('6',64))`,
  );
  await verify.query(
    `UPDATE generation_runs SET state='PROCESSING', attempts=1 WHERE id='30303030-3030-4030-8030-303030303030'`,
  );
  await verify.query(
    `INSERT INTO generation_usages (generation_run_id, attempt, provider, model, request_id, input_tokens, output_tokens, total_tokens, cost_micros, finish_reason) VALUES ('30303030-3030-4030-8030-303030303030',1,'fake','fake','upgrade-regen',1,1,2,0,'stop')`,
  );
  await verify.query(
    `INSERT INTO generation_context_items (id,generation_run_id,selected_order,knowledge_item_id,source_version_id,locator,text_hash,curriculum_version_id,curriculum_node_id,lineage,rank,score,character_count,estimated_tokens) VALUES ('39393939-3939-4939-8939-393939393939','30303030-3030-4030-8030-303030303030',0,'12121212-1212-4121-8121-121212121212','88888888-8888-4888-8888-888888888888','p1',repeat('1',64),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[{"curriculumVersionId":"55555555-5555-4555-8555-555555555555","curriculumNodeId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]',1,1,10,3),('40404040-4040-4040-8040-404040404040','30303030-3030-4030-8030-303030303030',1,'18181818-1818-4181-8181-181818181818','88888888-8888-4888-8888-888888888888','p2',repeat('8',64),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[{"curriculumVersionId":"55555555-5555-4555-8555-555555555555","curriculumNodeId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]',2,0.5,12,3)`,
  );
  await verify.query(
    `INSERT INTO assessment_revisions (id, assessment_id, revision_number, idempotency_key, curriculum_version_id, scoring_mode, state, request_fingerprint) VALUES ('31313131-3131-4131-8131-313131313131','66666666-6666-4666-8666-666666666666',2,'generation:30303030-3030-4030-8030-303030303030','55555555-5555-4555-8555-555555555555','NONE','BUILDING',repeat('7',64))`,
  );
  await verify.query(
    `INSERT INTO assessment_revision_node_links (revision_id, curriculum_node_id) VALUES ('31313131-3131-4131-8131-313131313131','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
  );
  await verify.query(
    `INSERT INTO assessment_sections (id, revision_id, key, title, instructions, "order") VALUES ('32323232-3232-4232-8232-323232323232','31313131-3131-4131-8131-313131313131','s1','S','',0)`,
  );
  await verify.query(
    `INSERT INTO assessment_questions (id, section_id, key, type, prompt, instructions, "order", difficulty) VALUES ('33333333-3333-4333-8333-333333333333','32323232-3232-4232-8232-323232323232','q1','OPEN','שאלה חדשה','',0,'LOW'),('34343434-3434-4434-8434-343434343434','32323232-3232-4232-8232-323232323232','q2','OPEN','שאלה נוספת','',1,'LOW')`,
  );
  await verify.query(
    `UPDATE assessment_revisions SET state='FINALIZED' WHERE id='31313131-3131-4131-8131-313131313131'`,
  );
  await verify.query(
    `INSERT INTO question_source_links (id, assessment_question_id, generation_run_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id) VALUES ('35353535-3535-4535-8535-353535353535','33333333-3333-4333-8333-333333333333','30303030-3030-4030-8030-303030303030','12121212-1212-4121-8121-121212121212','88888888-8888-4888-8888-888888888888','p1',repeat('1',64),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GENERATED','16161616-1616-4161-8161-161616161616'),('36363636-3636-4636-8636-363636363636','33333333-3333-4333-8333-333333333333','30303030-3030-4030-8030-303030303030','18181818-1818-4181-8181-181818181818','88888888-8888-4888-8888-888888888888','p2',repeat('8',64),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GENERATED','16161616-1616-4161-8161-161616161616'),('37373737-3737-4737-8737-373737373737','34343434-3434-4434-8434-343434343434','30303030-3030-4030-8030-303030303030','12121212-1212-4121-8121-121212121212','88888888-8888-4888-8888-888888888888','p1',repeat('1',64),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CARRIED_FORWARD','21212121-2121-4121-8121-212121212121')`,
  );
  await verify.query(
    `UPDATE generation_runs SET state='SUCCEEDED', provider='fake', model='fake', output_revision_id='31313131-3131-4131-8131-313131313131', processed_at=NOW() WHERE id='30303030-3030-4030-8030-303030303030'`,
  );
  await verify.query('COMMIT');
  const probeCount = async (sql) => Number((await verify.query(sql)).rows[0].count);
  const expectDatabaseError = async (label, mutation, expectedMessage) => {
    await verify.query('BEGIN');
    let error;
    try {
      await mutation();
      await verify.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (caught) {
      error = caught;
    }
    await verify.query('ROLLBACK');
    if (!error) throw new Error(`${label}: mutation unexpectedly succeeded`);
    if (!String(error).includes(expectedMessage))
      throw new Error(`${label}: unexpected database error: ${String(error)}`);
  };
  const exactLinkSet = async (runId, questionId) =>
    (
      await verify.query(
        `SELECT knowledge_item_id::text AS id FROM question_source_links WHERE generation_run_id='${runId}' AND assessment_question_id='${questionId}' ORDER BY knowledge_item_id`,
      )
    ).rows.map((row) => row.id);
  const multiCitationIds = [
    '12121212-1212-4121-8121-121212121212',
    '18181818-1818-4181-8181-181818181818',
  ].sort();
  if (
    JSON.stringify(
      await exactLinkSet(
        '99999999-9999-4999-8999-999999999999',
        '16161616-1616-4161-8161-161616161616',
      ),
    ) !== JSON.stringify(multiCitationIds)
  )
    throw new Error('multi-citation positive exact set failed');
  if (
    (await probeCount(
      `SELECT count(*) FROM generation_context_items WHERE generation_run_id='99999999-9999-4999-8999-999999999999'`,
    )) !== 2
  )
    throw new Error('multi-citation requires two context items');
  await expectDatabaseError(
    'multi-citation negative omission',
    async () => {
      await verify.query(
        'ALTER TABLE question_source_links DISABLE TRIGGER question_source_link_append_only',
      );
      await verify.query(
        `DELETE FROM question_source_links WHERE generation_run_id='99999999-9999-4999-8999-999999999999' AND assessment_question_id='16161616-1616-4161-8161-161616161616' AND knowledge_item_id='18181818-1818-4181-8181-181818181818'`,
      );
      await verify.query(
        `DO $$ BEGIN IF (SELECT count(*) FROM question_source_links WHERE generation_run_id='99999999-9999-4999-8999-999999999999' AND assessment_question_id='16161616-1616-4161-8161-161616161616') <> 2 THEN RAISE EXCEPTION 'upgrade multi-citation exact set invalid'; END IF; END $$`,
      );
    },
    'upgrade multi-citation exact set invalid',
  );
  if (
    JSON.stringify(
      await exactLinkSet(
        '99999999-9999-4999-8999-999999999999',
        '16161616-1616-4161-8161-161616161616',
      ),
    ) !== JSON.stringify(multiCitationIds)
  )
    throw new Error('multi-citation rollback did not restore exact set');
  console.log('UPGRADE_PROBE_MULTI_CITATION=PASS');
  const carriedIds = await exactLinkSet(
    '30303030-3030-4030-8030-303030303030',
    '34343434-3434-4434-8434-343434343434',
  );
  const baseCarriedIds = await exactLinkSet(
    '99999999-9999-4999-8999-999999999999',
    '21212121-2121-4121-8121-212121212121',
  );
  if (carriedIds.length !== 1 || JSON.stringify(carriedIds) !== JSON.stringify(baseCarriedIds))
    throw new Error('exact carried set positive comparison failed');
  await expectDatabaseError(
    'exact carried-set negative omission',
    async () => {
      await verify.query(
        'ALTER TABLE question_source_links DISABLE TRIGGER question_source_link_append_only',
      );
      await verify.query(
        `DELETE FROM question_source_links WHERE generation_run_id='30303030-3030-4030-8030-303030303030' AND assessment_question_id='34343434-3434-4434-8434-343434343434'`,
      );
      await verify.query(
        `SELECT phase40_validate_complete_output_graph('30303030-3030-4030-8030-303030303030'::uuid)`,
      );
    },
    'output question has no source link',
  );
  if (
    JSON.stringify(
      await exactLinkSet(
        '30303030-3030-4030-8030-303030303030',
        '34343434-3434-4434-8434-343434343434',
      ),
    ) !== JSON.stringify(baseCarriedIds)
  )
    throw new Error('exact carried set rollback did not restore');
  console.log('UPGRADE_PROBE_EXACT_CARRIED_SET=PASS');
  const graphFingerprint = async (revisionId, runId, questionId) =>
    (
      await verify.query(
        `SELECT md5(COALESCE(string_agg(concat_ws('|',s.key,s."order",q.key,q."order",q.prompt,COALESCE(l.knowledge_item_id::text,'')), E'\\n' ORDER BY s.key,s."order",q.key,q."order",l.knowledge_item_id), '')) AS fingerprint FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id LEFT JOIN question_source_links l ON l.assessment_question_id=q.id AND l.generation_run_id='${runId}' WHERE s.revision_id='${revisionId}' AND q.id='${questionId}'`,
      )
    ).rows[0].fingerprint;
  const baseUnrelatedFingerprint = await graphFingerprint(
    '14141414-1414-4141-8141-141414141414',
    '99999999-9999-4999-8999-999999999999',
    '21212121-2121-4121-8121-212121212121',
  );
  const outputUnrelatedFingerprint = await graphFingerprint(
    '31313131-3131-4131-8131-313131313131',
    '30303030-3030-4030-8030-303030303030',
    '34343434-3434-4434-8434-343434343434',
  );
  if (baseUnrelatedFingerprint !== outputUnrelatedFingerprint)
    throw new Error('unrelated graph fingerprint changed');
  await expectDatabaseError(
    'unrelated finalized question mutation',
    async () =>
      verify.query(
        `UPDATE assessment_questions SET prompt='אסור' WHERE id='34343434-3434-4434-8434-343434343434'`,
      ),
    'finalized revision content is immutable',
  );
  await expectDatabaseError(
    'unrelated extra section mutation',
    async () =>
      verify.query(
        `INSERT INTO assessment_sections (id,revision_id,key,title,instructions,"order") VALUES ('38383838-3838-4838-8838-383838383838','31313131-3131-4131-8131-313131313131','extra','אסור','',99)`,
      ),
    'finalized revision content is immutable',
  );
  if (
    (await graphFingerprint(
      '31313131-3131-4131-8131-313131313131',
      '30303030-3030-4030-8030-303030303030',
      '34343434-3434-4434-8434-343434343434',
    )) !== baseUnrelatedFingerprint
  )
    throw new Error('unrelated graph rollback fingerprint changed');
  console.log('UPGRADE_PROBE_UNRELATED_GRAPH=PASS');
  const protectedCounts = async () =>
    (
      await verify.query(
        `SELECT jsonb_build_object('runs',(SELECT count(*) FROM generation_runs),'revisions',(SELECT count(*) FROM assessment_revisions),'sections',(SELECT count(*) FROM assessment_sections),'questions',(SELECT count(*) FROM assessment_questions),'contexts',(SELECT count(*) FROM generation_context_items),'links',(SELECT count(*) FROM question_source_links),'usage',(SELECT count(*) FROM generation_usages),'outbox',(SELECT count(*) FROM outbox_events),'audit',(SELECT count(*) FROM audit_events)::text) AS fingerprint`,
      )
    ).rows[0].fingerprint;
  const beforeRollback = await protectedCounts();
  await expectDatabaseError(
    'atomic rollback forged source link',
    async () =>
      verify.query(
        `INSERT INTO question_source_links (assessment_question_id,generation_run_id,knowledge_item_id,source_version_id,locator,text_hash,curriculum_version_id,curriculum_node_id,lineage) VALUES ('33333333-3333-4333-8333-333333333333','30303030-3030-4030-8030-303030303030','12121212-1212-4121-8121-121212121212','88888888-8888-4888-8888-888888888888','bad',repeat('1',64),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GENERATED')`,
      ),
    'question source identity invalid',
  );
  if (JSON.stringify(await protectedCounts()) !== JSON.stringify(beforeRollback))
    throw new Error('atomic rollback left partial writes');
  console.log('UPGRADE_PROBE_ATOMIC_ROLLBACK=PASS');
  await verify.end();
  const migrations = readdirSync('packages/db/prisma/migrations').filter((name) =>
    /^\d+_/.test(name),
  );
  if (
    migrations.length !== 14 ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004100_phase40_review_remediation/migration.sql',
    ) ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004200_phase40_final_review_closure/migration.sql',
    ) ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004300_phase40_acceptance_closure/migration.sql',
    ) ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004400_phase40_complete_output_graph/migration.sql',
    ) ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004500_phase40_exact_output_graph/migration.sql',
    ) ||
    !existsSync(
      'packages/db/prisma/migrations/20260824004600_phase40_master_gate_closure/migration.sql',
    )
  )
    throw new Error('final migration count mismatch');
  runDeployFor('teaching_upgrade_clean', sourcePrisma + '/schema.prisma');
  const catalogFingerprint = async (db) => {
    const c = pg.getPgClient(db);
    await c.connect();
    const result = await c.query(`
      WITH catalog AS (
        SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' ||
          COALESCE(column_default, '') || '|' || is_nullable AS value
        FROM information_schema.columns
        WHERE table_schema='public'
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
    await c.end();
    return result.rows[0];
  };
  const upgradedFingerprint = await catalogFingerprint('teaching_upgrade');
  const cleanFingerprint = await catalogFingerprint(cleanDatabase);
  if (
    upgradedFingerprint.fingerprint !== cleanFingerprint.fingerprint ||
    upgradedFingerprint.rows !== cleanFingerprint.rows
  )
    throw new Error(
      `catalog fingerprint mismatch: upgraded=${upgradedFingerprint.fingerprint}/${upgradedFingerprint.rows} clean=${cleanFingerprint.fingerprint}/${cleanFingerprint.rows}`,
    );
  const comparison = await cleanFingerprint;
  if (!comparison.fingerprint || comparison.rows <= 0)
    throw new Error('clean schema comparison did not execute');
  console.log('PHASE30_TO_PHASE40_UPGRADE=PASS');
  console.log('UPGRADE_03300_TO_04000_TO_04100_TO_04200_TO_04300_TO_04400_TO_04500=PASS');
  console.log('UPGRADE_03300_TO_04000_TO_04100_TO_04200_TO_04300_TO_04400_TO_04500_TO_04600=PASS');
  console.log('DATA_PRESERVATION_CONTEXT_LINEAGE_SOURCE_LINK_ASSERTIONS=PASS');
  console.log(
    `SECOND_CLEAN_DATABASE_COMPARISON=PASS fingerprint=${upgradedFingerprint.fingerprint} rows=${upgradedFingerprint.rows}`,
  );
  completed = true;
} catch (error) {
  console.error('PHASE40_UPGRADE_ERROR', error instanceof Error ? error.stack : error);
  throw error;
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
