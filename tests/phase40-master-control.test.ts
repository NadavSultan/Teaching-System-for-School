import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Phase 40 protected master source gate', () => {
  it('MG-10 stages 04400 and 04500 in separate historical upgrade deployments', () => {
    const source = readFileSync('scripts/phase40-upgrade-test.mjs', 'utf8');
    const stage044 = source.indexOf('UPGRADE_STAGE=04400_START');
    const deploy044 = source.indexOf("runDeploy(join(prismaCopy, 'schema.prisma'));", stage044);
    const copy045 = source.indexOf(
      "join(sourcePrisma, 'migrations', '20260824004500_phase40_exact_output_graph')",
    );
    const stage045 = source.indexOf('UPGRADE_STAGE=04500_START');
    expect(stage044).toBeGreaterThan(-1);
    expect(deploy044).toBeGreaterThan(stage044);
    expect(copy045).toBeGreaterThan(deploy044);
    expect(stage045).toBeGreaterThan(copy045);
  });

  it('MG-11 requires behavioral upgrade probes instead of PASS labels alone', () => {
    const source = readFileSync('scripts/phase40-upgrade-test.mjs', 'utf8');
    for (const marker of [
      'UPGRADE_PROBE_MULTI_CITATION=PASS',
      'UPGRADE_PROBE_EXACT_CARRIED_SET=PASS',
      'UPGRADE_PROBE_UNRELATED_GRAPH=PASS',
      'UPGRADE_PROBE_ATOMIC_ROLLBACK=PASS',
    ])
      expect(source).toContain(marker);
  });

  it('MG-12 rejects known false-positive acceptance patterns', () => {
    const output = readFileSync(
      'packages/db/src/phase40.output-matrix.integration.test.ts',
      'utf8',
    );
    const regeneration = readFileSync(
      'packages/db/src/phase40.regeneration-matrix.integration.test.ts',
      'utf8',
    );
    expect(output).not.toContain('toBeGreaterThanOrEqual(0)');
    expect(regeneration).not.toContain("kind === 'missing-target' || kind === 'foreign-target'");
    expect(regeneration).not.toContain(
      "kind === 'foreign-base' ? '00000000-0000-4000-8000-000000000099'",
    );
  });

  it('MG-15 rejects generic or aggregated binding-matrix assertions', () => {
    const matrixFiles = [
      'packages/db/src/phase40.regeneration-matrix.integration.test.ts',
      'packages/db/src/phase40.concurrency-audit-directdb.integration.test.ts',
      'packages/db/src/phase40.output-matrix.integration.test.ts',
      'packages/db/src/phase40.eligibility-matrix.integration.test.ts',
    ];
    for (const file of matrixFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} contains bare rejects.toThrow()`).not.toMatch(
        /\.rejects\.toThrow\(\)/,
      );
    }
    const regeneration = readFileSync(matrixFiles[0]!, 'utf8');
    const concurrency = readFileSync(matrixFiles[1]!, 'utf8');
    const output = readFileSync(matrixFiles[2]!, 'utf8');
    expect(regeneration).not.toMatch(
      /if\s*\(\s*kind === 'missing-target'[\s\S]{0,120}\|\|[\s\S]{0,120}foreign-target/,
    );
    expect(regeneration).not.toContain('links.some(');
    expect(concurrency).not.toContain('results.some(');
    expect(output).not.toContain('toBeGreaterThan(');
  });

  it('MG-16 rejects derived truth, unstable target exclusion, and false reporting', () => {
    const generation = readFileSync('packages/db/src/generation.ts', 'utf8');
    const upgrade = readFileSync('scripts/phase40-upgrade-test.mjs', 'utf8');
    const report = readFileSync('docs/phases/40-implementation-report.md', 'utf8');
    expect(generation).not.toMatch(
      /INSERT INTO generation_expected_question_citations[\s\S]{0,700}FROM question_source_links/,
    );
    expect(upgrade).not.toContain("q.key <> 'q1'");
    expect(report).not.toContain('migrations `00100` through `04600` were not modified');
  });
});
