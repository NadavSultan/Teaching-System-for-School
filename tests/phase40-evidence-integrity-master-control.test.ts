import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const literalProperty = (id: string) =>
  /^[A-Za-z_$][\w$]*$/.test(id)
    ? new RegExp(`(?:^|\\n)\\s*(?:['"]${id}['"]|${id})\\s*:\\s*\\{`)
    : new RegExp(`(?:^|\\n)\\s*['"]${id}['"]\\s*:\\s*\\{`);

const outputFile = 'packages/db/src/phase40.output-matrix.integration.test.ts';
const eligibilityFile = 'packages/db/src/phase40.eligibility-matrix.integration.test.ts';
const databaseFile = 'packages/db/src/phase40.concurrency-audit-directdb.integration.test.ts';

describe('Phase 40 evidence integrity master closure', () => {
  it('MG-21 rejects source-gate comments, self-check sentinels, and computed-key workarounds', () => {
    const rawOutput = read(outputFile);
    const rawEligibility = read(eligibilityFile);
    expect(`${rawOutput}\n${rawEligibility}`).not.toMatch(/source gate|protected source/i);
    expect(rawOutput).not.toContain('prettier-ignore');
    expect(rawEligibility).not.toContain('expectedCitationModelEvidence');
    expect(rawEligibility).not.toMatch(
      /expect\((?<quote>['"])(?<value>[^'"]+)\k<quote>\)\.toBe\(\k<quote>\k<value>\k<quote>\)/,
    );
    const output = withoutComments(rawOutput);
    expect(output).not.toMatch(/\[\s*['"][^'"]+['"]\s*\]\s*:/);
    expect(output).not.toContain('Object.fromEntries(');
  });

  it('MG-22 requires parsed exact database messages instead of substring or generic-key evidence', () => {
    const source = withoutComments(read(databaseFile));
    expect(source).toContain('extractDatabaseDiagnostic');
    expect(source).toContain('expect(databaseMessage).toBe(expectedMessage)');
    expect(source).toContain('expect(sqlState).toBe(expectedSqlState)');
    expect(source).not.toContain('diagnostic).toContain(expectedMessage)');
    expect(source).not.toMatch(/expectExactDatabaseError\([\s\S]{0,300}['"]Key \(['"]/);
  });

  it('MG-23 requires explicit comment-free G and O expectation entries for every registry ID', () => {
    const source = withoutComments(read(outputFile));
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
      'valid-planned-draft',
      'unknown-field',
      'missing-section',
      'unplanned-key',
      'duplicate-key',
      'wrong-order',
      'type-mismatch',
      'difficulty-mismatch',
      'score-mismatch',
      'missing-citation',
      'unknown-citation',
      'foreign-citation',
    ]) {
      expect(source, `missing explicit expectation entry for ${id}`).toMatch(literalProperty(id));
    }
  });

  it('MG-24 rejects combined or masked D arrangements', () => {
    const source = withoutComments(read(databaseFile));
    expect(source).not.toMatch(/kind === 'run-identity'\s*\|\|\s*kind === 'forged-owner'/);
    expect(source).not.toMatch(
      /kind === 'forged-question-run'\s*\|\|\s*kind === 'forged-source-link'/,
    );
    expect(source).toContain("'generation run identity is immutable'");
    expect(source).toContain("'success shape invalid'");
    expect(source).toContain("'output revision identity invalid'");
    expect(source).toContain("'question source assessment identity invalid'");
    expect(source).toContain("'question source identity invalid'");
    const duplicateIdempotencyStart = source.indexOf("kind === 'duplicate-idempotency'");
    const terminalReopenStart = source.indexOf(
      "kind === 'terminal-reopen'",
      duplicateIdempotencyStart,
    );
    expect(duplicateIdempotencyStart).toBeGreaterThanOrEqual(0);
    expect(terminalReopenStart).toBeGreaterThan(duplicateIdempotencyStart);
    const duplicateIdempotency = source.slice(duplicateIdempotencyStart, terminalReopenStart);
    expect(duplicateIdempotency).toContain('gen_random_uuid()');
    expect(duplicateIdempotency).toContain('idempotency_key');
  });
});
