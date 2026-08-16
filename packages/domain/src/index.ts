import type { AuthenticatedPrincipal } from '@teach/contracts';

export type MembershipRole = 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN' | 'PLATFORM_ADMIN';
export type WorkspaceType = 'PERSONAL' | 'SCHOOL';
export type WorkspaceOperation = 'READ_WORKSPACE_CONTEXT' | 'RENAME_WORKSPACE';
export type AccessContext = {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  userStatus: 'ACTIVE' | 'INACTIVE';
  membershipStatus: 'ACTIVE' | 'INACTIVE';
  role: MembershipRole;
  organizationStatus: 'ACTIVE' | 'INACTIVE';
  workspaceType: WorkspaceType;
};

export class AccessDeniedError extends Error {
  constructor() {
    super('Resource not found or unavailable');
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export function authorizeWorkspace(
  context: AccessContext,
  trustedOrganizationId: string,
  operation: WorkspaceOperation,
): void {
  const allowed: readonly MembershipRole[] =
    operation === 'READ_WORKSPACE_CONTEXT'
      ? ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN']
      : context.workspaceType === 'PERSONAL'
        ? ['TEACHER']
        : ['SCHOOL_ADMIN'];
  if (
    context.userStatus !== 'ACTIVE' ||
    context.membershipStatus !== 'ACTIVE' ||
    context.organizationStatus !== 'ACTIVE' ||
    context.organizationId !== trustedOrganizationId ||
    context.role === 'PLATFORM_ADMIN' ||
    !allowed.includes(context.role)
  ) {
    throw new AccessDeniedError();
  }
}

export function assertPersonalWorkspaceMembers(activeMembers: number): void {
  if (activeMembers !== 1)
    throw new Error('A personal workspace must have exactly one active member');
}
