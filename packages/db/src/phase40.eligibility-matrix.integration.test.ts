import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 E1 current eligibility dimensions', () => {
  it.each(phase40AcceptanceRegistry.E1)(
    '%s executes selectGenerationContext against PostgreSQL',
    async (id) =>
      expect((await executePhase40AcceptanceCase('E1', id)).database).toBe('postgresql'),
  );
});
afterAll(() => prisma.$disconnect());
