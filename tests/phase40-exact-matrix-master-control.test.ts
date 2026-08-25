import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');
const literalProperty = (id: string) =>
  /^[A-Za-z_$][\w$]*$/.test(id)
    ? new RegExp(`(?:['\"]${id}['\"]|${id})\\s*:`)
    : new RegExp(`['\"]${id}['\"]\\s*:`);

const files = {
  tenant: 'packages/db/src/phase40.tenant-matrix.integration.test.ts',
  roleState: 'packages/db/src/phase40.role-state-matrix.integration.test.ts',
  output: 'packages/db/src/phase40.output-matrix.integration.test.ts',
  regeneration: 'packages/db/src/phase40.regeneration-matrix.integration.test.ts',
  concurrency: 'packages/db/src/phase40.concurrency-audit-directdb.integration.test.ts',
  eligibility: 'packages/db/src/phase40.eligibility-matrix.integration.test.ts',
};

describe('Phase 40 exact matrix master closure', () => {
  it('MG-17 rejects generic, alternative, aggregate, and non-zero-only assertions', () => {
    for (const file of Object.values(files)) {
      const source = read(file);
      expect(source, `${file} contains bare rejects.toThrow()`).not.toMatch(
        /\.rejects\.toThrow\(\)/,
      );
      expect(source, `${file} accepts only an error class`).not.toContain(
        '.rejects.toBeInstanceOf(',
      );
      expect(source, `${file} accepts alternative error messages`).not.toMatch(
        /\.rejects\.toThrow\(\/[^/\r\n]*\|/,
      );
      expect(source, `${file} uses a non-exact positive count`).not.toContain('toBeGreaterThan(0)');
      expect(source, `${file} uses a non-exact non-empty count`).not.toContain(
        'not.toHaveLength(0)',
      );
    }
    expect(read(files.regeneration)).not.toContain('results.every(');
  });

  it('MG-18 requires exact database message and SQLSTATE evidence for A, D, and L', () => {
    const source = read(files.concurrency);
    expect(source).toContain('expectExactDatabaseError');
    expect(source).toContain('expectedSqlState');
    expect(source).toContain('expectedMessage');
    const aStart = source.indexOf("describe('A —");
    const dStart = source.indexOf("describe('D —");
    const lStart = source.indexOf("describe('L —");
    expect(aStart).toBeGreaterThanOrEqual(0);
    expect(dStart).toBeGreaterThan(aStart);
    expect(lStart).toBeGreaterThan(dStart);
    expect(source.slice(aStart, dStart)).not.toContain('.rejects.toThrow(');
    expect(source.slice(dStart, lStart)).not.toContain('.rejects.toThrow(');
    expect(source.slice(lStart)).not.toContain('.rejects.toThrow(');
  });

  it('MG-19 requires complete per-row G, O, and E1 terminal evidence', () => {
    const output = read(files.output);
    expect(output).toContain('gatewayExpectedByOutcome');
    expect(output).toContain('adversarialExpectedByKind');
    for (const id of [
      'valid-draft',
      'valid-regeneration',
      'malformed',
      'schema-violation',
      'timeout',
      'rate-limit-retry',
      'transient-exhausted',
      'permanent-error',
      'budget-overrun',
      'replay',
    ]) {
      expect(output, `missing exact G expectation for ${id}`).toMatch(literalProperty(id));
    }
    for (const field of [
      'state',
      'failureCode',
      'attempts',
      'usageCount',
      'outputRevisionCount',
      'sourceLinkCount',
    ]) {
      expect(output, `G/O evidence omits ${field}`).toContain(field);
    }
    const eligibility = read(files.eligibility);
    expect(eligibility).toContain('new DeterministicFakeModelGateway()');
    expect(eligibility).toContain("state).toBe('INSUFFICIENT_CONTEXT')");
    expect(eligibility).toContain("failureCode).toBe('CONTEXT_EMPTY')");
    expect(eligibility).toContain('expectedCitationCount(');
    expect(eligibility).toContain('questionSourceLink.count');
    expect(eligibility).toContain('outputRevisionId).toBeNull()');
  });

  it('MG-20 requires exact T, R, S, Q, and C row evidence', () => {
    const tenant = read(files.tenant);
    expect(tenant.match(/Resource not found or unavailable/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    );
    const roleState = read(files.roleState);
    expect(roleState).not.toContain('.rejects.toThrow(');
    expect(
      roleState.match(/Resource not found or unavailable/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(roleState).toContain('expectedRoleOperation');
    const regeneration = read(files.regeneration);
    expect(regeneration).toContain('carriedBaseLinks');
    expect(regeneration).toContain('carriedOutputLinks');
    const concurrency = read(files.concurrency);
    expect(concurrency).toContain('results[1]');
    expect(concurrency).toContain('GENERATION_LEASE_ACTIVE');
    expect(concurrency).toContain('concurrentEvidenceBefore');
    expect(concurrency).toContain('concurrentEvidenceAfter');
  });
});
