import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME ?? 'phase10',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE ?? process.cwd(),
  });
  syncBuiltinESMExports();
}
if (process.platform === 'win32') fsPromises.chmod = async () => undefined;
const { default: EmbeddedPostgres } = await import('embedded-postgres');

const databaseDir = join(os.tmpdir(), `teaching-phase40-postgres-${process.pid}`);
const port = 55432 + (process.pid % 500);
rmSync(databaseDir, { recursive: true, force: true });
mkdirSync(databaseDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'phase10',
  password: 'phase10_local_only',
  port,
  persistent: false,
  onLog: () => undefined,
});
const pnpmCli = process.env.npm_execpath;
const childPath = `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.Path ?? process.env.PATH ?? ''}`;
const run = (args, database) =>
  new Promise((resolve, reject) => {
    const child = pnpmCli
      ? spawn(process.execPath, [pnpmCli, ...args], {
          stdio: 'inherit',
          env: {
            ...process.env,
            CI: 'true',
            Path: childPath,
            PATH: childPath,
            NODE_ENV: 'test',
            AUTH_ADAPTER: 'test',
            DATABASE_URL: `postgresql://phase10:phase10_local_only@127.0.0.1:${port}/${database}?schema=public`,
          },
        })
      : spawn('pnpm.cmd', args, {
          shell: true,
          stdio: 'inherit',
          env: {
            ...process.env,
            CI: 'true',
            Path: childPath,
            PATH: childPath,
            NODE_ENV: 'test',
            AUTH_ADAPTER: 'test',
            DATABASE_URL: `postgresql://phase10:phase10_local_only@127.0.0.1:${port}/${database}?schema=public`,
          },
        });
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} failed with exit ${code}`)),
    );
  });

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('teaching_test');
  await pg.createDatabase('teaching_clean');
  await pg.createDatabase('teaching_shadow');
  const client = pg.getPgClient();
  await client.connect();
  const version = await client.query('SHOW server_version');
  console.log(`POSTGRES_VERSION=${version.rows[0].server_version}`);
  await client.end();
  await run(['db:migrate:deploy'], 'teaching_test');
  await run(['test-integration'], 'teaching_test');
  await run(['db:migrate:deploy'], 'teaching_clean');
  console.log('CLEAN_DATABASE_MIGRATIONS=PASS');
  await run(
    [
      '--filter',
      '@teach/db',
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datasource',
      'prisma/schema.prisma',
      '--shadow-database-url',
      `postgresql://phase10:phase10_local_only@127.0.0.1:${port}/teaching_shadow?schema=public`,
      '--exit-code',
    ],
    'teaching_clean',
  );
  console.log('MIGRATION_DRIFT=PASS');
} finally {
  if (process.platform === 'win32' && pg.process?.pid) {
    spawnSync('taskkill', ['/pid', String(pg.process.pid), '/f', '/t'], { stdio: 'ignore' });
    try {
      rmSync(databaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      console.warn(`PostgreSQL data cleanup deferred until the next run: ${databaseDir}`);
    }
  } else {
    await pg.stop();
  }
}
// The Windows embedded runtime retains a closed child-process handle; all work and cleanup are complete.
process.exit(0);
