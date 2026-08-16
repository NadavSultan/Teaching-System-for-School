import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Hebrew RTL shell', () => {
  const layout = readFileSync(resolve(__dirname, 'layout.tsx'), 'utf8');
  const page = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');
  it('sets Hebrew language and RTL direction', () => {
    expect(layout).toContain('lang="he"');
    expect(layout).toContain('dir="rtl"');
    expect(layout).toContain('skip-link');
  });
  it('isolates mixed-direction identifiers and labels development auth', () => {
    expect(page).toContain('<bdi>');
    expect(page).toContain('dir="ltr"');
    expect(page).toContain('כניסת פיתוח בלבד');
  });
});
