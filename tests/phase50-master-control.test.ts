import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('tests/phase50-acceptance-manifest.json', 'utf8')) as {
  expectedTotal: number;
  groups: Record<string, string[]>;
};
const expectedGroups = { D: 20, S: 12, W: 8, L: 16, T: 12, R: 18, C: 8, P: 12, B: 16, A: 8 };

const requiredImplementationFiles = [
  'packages/contracts/src/phase50.ts',
  'packages/domain/src/validation.ts',
  'packages/ai/src/semantic-evaluator.ts',
  'packages/db/src/validation.ts',
  'apps/worker/src/validation-worker.ts',
  'packages/db/prisma/migrations/20260826005000_phase50_validation_engine/migration.sql',
  'scripts/phase50-upgrade-test.mjs',
  'docs/runbooks/phase-50-validation.md',
];

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = `${root}/${name}`;
    return statSync(path).isDirectory() ? walk(path) : [path.replaceAll('\\', '/')];
  });
}

describe('Phase 50 protected master control', () => {
  it('MG50-01 freezes the exact 130-case manifest', () => {
    const allIds: string[] = [];
    for (const [group, expectedCount] of Object.entries(expectedGroups)) {
      const expected = Array.from(
        { length: expectedCount },
        (_, index) => `${group}${String(index + 1).padStart(2, '0')}`,
      );
      expect(manifest.groups[group]).toEqual(expected);
      allIds.push(...expected);
    }
    expect(manifest.expectedTotal).toBe(130);
    expect(allIds).toHaveLength(130);
    expect(new Set(allIds).size).toBe(130);
  });

  it('MG50-02 requires every deliverable and exactly one executable occurrence of every case ID', () => {
    for (const file of requiredImplementationFiles) expect(existsSync(file), file).toBe(true);
    const testFiles = [...walk('tests'), ...walk('packages'), ...walk('apps')].filter(
      (file) =>
        /phase50.*\.test\.ts$/i.test(file) &&
        !file.endsWith('tests/phase50-master-control.test.ts'),
    );
    const source = testFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const id of Object.values(manifest.groups).flat()) {
      expect(source.match(new RegExp(`\\b${id}\\b`, 'g'))?.length ?? 0, id).toBe(1);
    }
  });

  it('MG50-03 rejects evidence shortcuts and later-phase/dependency drift', () => {
    const phase50Files = [
      ...walk('tests'),
      ...walk('packages'),
      ...walk('apps'),
      ...walk('scripts'),
    ].filter(
      (file) => /phase50/i.test(file) && !file.endsWith('tests/phase50-master-control.test.ts'),
    );
    const source = phase50Files
      .filter((file) => /\.(?:ts|mjs)$/.test(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\.(?:skip|todo|only)\s*\(/);
    expect(source).not.toContain('prettier-ignore');
    expect(source).not.toMatch(/rejects\.toThrow\(\s*\)/);
    expect(source).not.toMatch(/toBeGreaterThan(?:OrEqual)?\(0\)/);
    expect(source).not.toMatch(/expected[-_ ]failure|sentinel|source gate/i);
    expect(source).toContain('requestRevisionValidation');
    expect(source).toContain('acknowledgeSemanticWarning');
    expect(source).toContain('getRevisionValidationReadiness');
    expect(source).toContain('assertRevisionApprovable');
    expect(source).toContain('processValidationRun');
    expect(
      execFileSync(
        'git',
        ['diff', '--name-only', '8f09173f073f13b8e565a12f3d37abac18b33bf5...HEAD'],
        { encoding: 'utf8' },
      ),
    ).not.toMatch(/^(?:apps\/web|packages\/rendering)\//m);
  });
});
