import { describe, expect, it } from 'vitest';
import {
  phase40AcceptanceCases,
  phase40AcceptanceCount,
  phase40AcceptanceRegistry,
} from './phase40.acceptance.registry.js';

describe('Phase 40 acceptance registration', () => {
  it('registers the exact binding manifest without claiming behavioral evidence', () => {
    expect(phase40AcceptanceCount).toBe(173);
    expect(new Set(phase40AcceptanceCases).size).toBe(173);
    expect(Object.values(phase40AcceptanceRegistry).map((rows) => rows.length)).toEqual([
      8, 24, 24, 25, 10, 17, 7, 12, 10, 8, 8, 20,
    ]);
  });
});
