import { describe, expect, it } from 'vitest';
import { canTransitionGenerationRun } from './index.js';

const states = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED'] as const;
const allowed = new Set([
  'PENDING->PROCESSING',
  'PROCESSING->PENDING',
  'PROCESSING->SUCCEEDED',
  'PROCESSING->INSUFFICIENT_CONTEXT',
  'PROCESSING->FAILED',
]);

describe('Phase 40 generation run transition matrix', () => {
  it.each(states.flatMap((from) => states.map((to) => [from, to] as const)))(
    '%s -> %s is enforced',
    (from, to) => {
      expect(canTransitionGenerationRun(from, to)).toBe(allowed.has(`${from}->${to}`));
    },
  );
});
