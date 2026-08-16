import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  apiErrorSchema,
  authenticatedPrincipalSchema,
  healthSchema,
  membershipSummarySchema,
  organizationSummarySchema,
  workspaceContextSchema,
} from './index.js';

const principal = {
  version: CONTRACT_VERSION,
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'a@example.test',
  provider: 'test',
  providerSubject: 'a',
  platformAdmin: false,
};
const organization = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'אישי',
  workspaceType: 'PERSONAL' as const,
};
const membership = {
  organizationId: organization.id,
  role: 'TEACHER' as const,
  status: 'ACTIVE' as const,
};

describe('all generated JSON Schema snapshots', () => {
  it.each([
    [
      'health-readiness.v1.json',
      healthSchema,
      { version: CONTRACT_VERSION, status: 'ok', service: 'api', requestId: 'r1' },
    ],
    ['authenticated-principal.v1.json', authenticatedPrincipalSchema, principal],
    ['organization-summary.v1.json', organizationSummarySchema, organization],
    ['membership-summary.v1.json', membershipSummarySchema, membership],
    [
      'workspace-context.v1.json',
      workspaceContextSchema,
      { version: CONTRACT_VERSION, principal, organization, membership },
    ],
    [
      'api-error.v1.json',
      apiErrorSchema,
      {
        version: CONTRACT_VERSION,
        error: { code: 'NOT_FOUND', message: 'Unavailable', requestId: 'r1' },
      },
    ],
  ])('%s exists and its runtime fixture parses', (file, runtime, fixture) => {
    expect(() =>
      JSON.parse(readFileSync(resolve(__dirname, '..', 'schemas', file), 'utf8')),
    ).not.toThrow();
    expect(runtime.parse(fixture)).toEqual(fixture);
  });
});
