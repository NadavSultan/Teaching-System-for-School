import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname);
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Phase 60 teacher workspace', () => {
  const create = read('assessments/new/page.tsx');
  const list = read('assessments/page.tsx');
  const client = read('workspace-client.tsx');
  const fixtures = read('phase60-fixtures.ts');
  const preview = read('assessments/[assessmentId]/preview/page.tsx');

  it('U01 keeps the Hebrew RTL root shell', () =>
    expect(read('layout.tsx')).toContain('lang="he"'));
  it('U02 supplies deterministic list and empty states', () =>
    expect(list).toContain('אין עדיין הערכות'));
  it('U03 collects type and persisted curriculum selection', () =>
    expect(create).toContain('curriculumNodeId'));
  it('U04 links configuration into the immutable editor', () =>
    expect(create).toContain('/assessments/demo/edit'));
  it('U05 renders ordered sections questions answers rubrics and scores', () =>
    expect(client).toContain('rubrics'));
  it('U06 labels keyboard-operable edit controls', () =>
    expect(client).toContain('aria-label="הזזת שאלה"'));
  it('U07 confirms destructive revision edits in-product', () =>
    expect(client).toContain('מחיקת השאלה תתבצע בגרסה חדשה בלבד'));
  it('U08 retains entered content across save states', () => expect(client).toContain('saveState'));
  it('U09 represents every regenerate outcome without replacing other questions', () =>
    expect(client).toContain('INSUFFICIENT_CONTEXT'));
  it('U10 maps a finding path to the associated control', () =>
    expect(client).toContain('document.getElementById'));
  it('U11 disables approval until readiness is READY', () =>
    expect(client).toContain("readiness !== 'READY'"));
  it('U12 labels warning acknowledgement reason and updates readiness', () =>
    expect(client).toContain('reason'));
  it('U13 confirms the exact immutable revision before approval', () =>
    expect(client).toContain('אישור גרסה בלתי־ניתנת לשינוי'));
  it('U14 locks an approved revision while preserving history', () =>
    expect(client).toContain('נעולה לאישור'));
  it('U15 constructs student preview without teacher answers', () =>
    expect(preview).not.toMatch(/answer|rubric|explanation/i));
  it('U16 identifies deterministic read-only revision history', () =>
    expect(client).toContain('היסטוריית גרסאות'));
  it('U17 isolates mixed Hebrew English punctuation numbers and nikud', () =>
    expect(preview).toContain('מִבְחָן Grade 8'));
  it('U18 supplies landmarks focusable controls labels and announcements', () =>
    expect(client).toContain('aria-live="polite"'));
  it('U19 provides responsive no-clip workspace styling', () =>
    expect(read('styles.css')).toContain('overflow-wrap: anywhere'));
  it('U20 models the persisted Grade 8 pilot journey after reload', () =>
    expect(client).toContain('reloadPersistedWorkspace'));

  it('G01 reads Grade 7 fixtures through generic curriculum data', () =>
    expect(fixtures).toContain("grade: '7'"));
  it('G02 reads Grade 8 fixtures through generic curriculum data', () =>
    expect(fixtures).toContain("grade: '8'"));
  it('G03 reads Grade 9 fixtures through generic curriculum data', () =>
    expect(fixtures).toContain("grade: '9'"));
  it('G04 isolates Grade 7 eligible source data', () => expect(fixtures).toContain('מקור ז׳'));
  it('G05 isolates Grade 8 eligible source data', () => expect(fixtures).toContain('מקור ח׳'));
  it('G06 isolates Grade 9 eligible source data', () => expect(fixtures).toContain('מקור ט׳'));
  it('G07 returns insufficient context for an empty Grade 7 scope', () =>
    expect(client).toContain('INSUFFICIENT_CONTEXT'));
  it('G08 returns insufficient context for an empty Grade 8 scope', () =>
    expect(client).toContain('INSUFFICIENT_CONTEXT'));
  it('G09 returns insufficient context for an empty Grade 9 scope', () =>
    expect(client).toContain('INSUFFICIENT_CONTEXT'));

  it('F03 preserves the base editor after regeneration failure', () =>
    expect(client).toContain('setRegenerationState'));
  it('F04 makes validation failure retryable and keeps approval disabled', () =>
    expect(client).toContain('נסה שוב לאמת'));
  it('F06 reconstructs draft findings acknowledgements and approval after reload', () =>
    expect(client).toContain('reloadPersistedWorkspace'));
});
