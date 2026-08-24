import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 E2 concurrent pre-commit invalidation dimensions', () => {
  it.each(phase40AcceptanceRegistry.E2)(
    '%s executes the generation revalidation boundary',
    async (id) =>
      expect((await executePhase40AcceptanceCase('E2', id)).database).toBe('postgresql'),
  );
});
afterAll(() => prisma.$disconnect());
