import { afterAll, describe, expect, it } from 'vitest';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { executePhase40AcceptanceCase } from './phase40.acceptance.integration.helpers.js';
import { prisma } from './index.js';
describe('Phase 40 R/S persisted operation matrix', () => {
  it.each([...phase40AcceptanceRegistry.R, ...phase40AcceptanceRegistry.S])(
    '%s executes persisted operation boundary',
    async (id) =>
      expect(
        (
          await executePhase40AcceptanceCase(
            id.split(':').length === 2 &&
              ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'].includes(id.split(':')[0]!)
              ? 'R'
              : 'S',
            id,
          )
        ).operation,
      ).toContain(':'),
  );
});
afterAll(() => prisma.$disconnect());
