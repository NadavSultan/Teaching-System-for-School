import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 C/A/D/L concurrency, redaction, and direct database enforcement', () => {
  it.each([
    ...phase40AcceptanceRegistry.C,
    ...phase40AcceptanceRegistry.A,
    ...phase40AcceptanceRegistry.D,
    ...phase40AcceptanceRegistry.L,
  ])('%s executes the PostgreSQL enforcement boundary', async (id) => {
    const matrix = id.includes('->')
      ? 'L'
      : phase40AcceptanceRegistry.A.includes(id as never)
        ? 'A'
        : phase40AcceptanceRegistry.C.includes(id as never)
          ? 'C'
          : 'D';
    expect((await executePhase40AcceptanceCase(matrix, id)).database).toBe('postgresql');
  });
});
afterAll(() => prisma.$disconnect());
