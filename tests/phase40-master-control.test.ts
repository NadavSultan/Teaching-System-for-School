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
});
