import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 Q regeneration isolation', () => {
  it.each(phase40AcceptanceRegistry.Q)(
    '%s executes regeneration result/provenance boundary',
    async (id) => expect((await executePhase40AcceptanceCase('Q', id)).database).toBe('postgresql'),
  );
});
afterAll(() => prisma.$disconnect());
