import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 T tenant operations against persisted PostgreSQL tenants', () => {
  it.each(phase40AcceptanceRegistry.T)('%s executes persisted tenant boundary', async (id) =>
    expect((await executePhase40AcceptanceCase('T', id)).database).toBe('postgresql'),
  );
});
afterAll(() => prisma.$disconnect());
