import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync('scripts/verify-phase60-control.mjs', 'utf8');
const controlPack = readFileSync('docs/phases/60-phase-control-pack.md', 'utf8');
const handoff = readFileSync('docs/phases/60-executor-handoff.md', 'utf8');
const qaPlan = readFileSync('docs/phases/60-manual-qa-plan.md', 'utf8');
const manifest = JSON.parse(readFileSync('tests/phase60-acceptance-manifest.json', 'utf8')) as {
  phase: number;
  expectedTotal: number;
  groups: Record<string, string[]>;
};

describe('Phase 60 protected master control', () => {
  it('pins the exact branch, baseline, migration, and manifest identity', () => {
    expect(verifier).toContain("const expectedBranch = 'codex/phase-60-teacher-workspace'");
    expect(verifier).toContain("const startingCommit = 'eb94f524435c0ecd58277649ef33d07ff9c51624'");
    expect(verifier).toContain(
      "const allowedMigration = '20260903006000_phase60_teacher_workspace_approval'",
    );
    expect(manifest.phase).toBe(60);
    expect(manifest.expectedTotal).toBe(125);
    expect(Object.values(manifest.groups).flat()).toHaveLength(125);
    expect(new Set(Object.values(manifest.groups).flat()).size).toBe(125);
  });

  it('binds immutable revisions, database approval, and data-driven Grades 7-9', () => {
    expect(controlPack).toContain('Never mutate a finalized assessment revision');
    expect(controlPack).toContain('assert_revision_approvable');
    expect(controlPack).toContain('Grades 7–9');
    expect(controlPack).toContain('must never borrow another grade');
    expect(controlPack).toContain('student-safe view model');
    expect(qaPlan).toContain('Hebrew Grade 8 Pilot');
    expect(qaPlan).toContain('Grade 7–9');
  });

  it('requires autonomous execution through all packages and the complete final gate', () => {
    expect(handoff).toContain('Execute P60-0 through P60-8');
    expect(handoff).toContain('Do not return control after a package');
    expect(handoff).toContain('Do not push, merge, deploy, rewrite history, self-approve');
    expect(controlPack).toContain('MATRIX_MANIFEST=125');
    expect(controlPack).toContain('test-integration:phase60-upgrade');
    expect(controlPack).toContain('test:e2e:phase60');
    expect(controlPack).toContain('qa:phase60 -- --smoke');
  });

  it('keeps Phase 70, real providers, and invented curriculum outside Phase 60', () => {
    expect(controlPack).toContain('Phase 70 rendering, PDF/DOCX');
    expect(controlPack).toContain('Real provider SDKs');
    expect(controlPack).toContain('Authoritative curriculum or source content invented');
    expect(verifier).toContain('later-phase path is prohibited in Phase 60');
    expect(verifier).toContain('provider SDK/network dependency is prohibited in Phase 60');
  });
});
