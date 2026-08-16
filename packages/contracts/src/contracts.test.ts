import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, authenticatedPrincipalSchema, healthSchema } from './index.js';

describe('runtime contracts', () => {
  it('accepts versioned health and rejects invalid boundary data', () => {
    expect(
      healthSchema.parse({
        version: CONTRACT_VERSION,
        status: 'ok',
        service: 'api',
        requestId: 'r1',
      }).status,
    ).toBe('ok');
    expect(() => authenticatedPrincipalSchema.parse({ userId: 'client-controlled' })).toThrow();
  });
});
