import { describe, expect, it } from 'vitest';
import { authorizeWorkspace, normalizeEmail, type AccessContext } from './index.js';

const base: AccessContext = {
  principal: {
    version: '1.0.0',
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'a@example.test',
    provider: 'test',
    providerSubject: 'a',
    platformAdmin: false,
  },
  organizationId: 'org-a',
  userStatus: 'ACTIVE',
  membershipStatus: 'ACTIVE',
  role: 'TEACHER',
  organizationStatus: 'ACTIVE',
  workspaceType: 'PERSONAL',
};

describe('identity and authorization', () => {
  it('normalizes email deterministically', () =>
    expect(normalizeEmail('  TEACHER@Example.COM ')).toBe('teacher@example.com'));
  it('allows active tenant members to read', () =>
    expect(() => authorizeWorkspace(base, 'org-a', 'READ_WORKSPACE_CONTEXT')).not.toThrow());
  it.each([
    [{ ...base, organizationId: 'org-b' }, 'org-a'],
    [{ ...base, membershipStatus: 'INACTIVE' as const }, 'org-a'],
    [{ ...base, userStatus: 'INACTIVE' as const }, 'org-a'],
    [{ ...base, organizationStatus: 'INACTIVE' as const }, 'org-a'],
  ])('denies invalid access', (context, org) =>
    expect(() => authorizeWorkspace(context, org, 'READ_WORKSPACE_CONTEXT')).toThrow(
      'Resource not found',
    ),
  );
  it('uses operation and workspace-specific rename roles', () => {
    expect(() => authorizeWorkspace(base, 'org-a', 'RENAME_WORKSPACE')).not.toThrow();
    expect(() =>
      authorizeWorkspace({ ...base, workspaceType: 'SCHOOL' }, 'org-a', 'RENAME_WORKSPACE'),
    ).toThrow();
    expect(() =>
      authorizeWorkspace(
        { ...base, workspaceType: 'SCHOOL', role: 'SCHOOL_ADMIN' },
        'org-a',
        'RENAME_WORKSPACE',
      ),
    ).not.toThrow();
    expect(() =>
      authorizeWorkspace({ ...base, role: 'PLATFORM_ADMIN' }, 'org-a', 'READ_WORKSPACE_CONTEXT'),
    ).toThrow();
  });
});
