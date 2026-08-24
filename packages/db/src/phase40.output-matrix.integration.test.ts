import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 G/O processGenerationRun output behavior', () => {
  it.each(phase40AcceptanceRegistry.G)(
    '%s invokes processGenerationRun and gateway outcome boundary',
    async (id) => expect((await executePhase40AcceptanceCase('G', id)).database).toBe('postgresql'),
  );
  it.each(phase40AcceptanceRegistry.O)(
    '%s invokes processGenerationRun and strict output boundary',
    async (id) => expect((await executePhase40AcceptanceCase('O', id)).database).toBe('postgresql'),
  );
});
afterAll(() => prisma.$disconnect());
