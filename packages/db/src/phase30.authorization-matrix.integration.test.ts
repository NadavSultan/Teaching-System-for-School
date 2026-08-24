import { afterAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@teach/contracts';
import {
  createKnowledgeSource,
  createPersonalWorkspace,
  getKnowledgeSource,
  prisma,
} from './index.js';

function context(
  workspace: any,
  role: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN' | 'PLATFORM_ADMIN' = 'TEACHER',
  organizationId = workspace.organization.id,
  workspaceType: 'PERSONAL' | 'SCHOOL' = 'PERSONAL',
) {
  return {
    principal: {
      version: CONTRACT_VERSION,
      userId: workspace.user.id,
      email: workspace.user.normalizedEmail,
      provider: 'development',
      providerSubject: `dev:${workspace.user.id}`,
      platformAdmin: false,
    },
    organizationId,
    userStatus: 'ACTIVE' as const,
    membershipStatus: 'ACTIVE' as const,
    role,
    organizationStatus: 'ACTIVE' as const,
    workspaceType,
  };
}

async function schoolContext(role: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN') {
  const actor = await createPersonalWorkspace({
    email: `p30-role-${role}-${Date.now()}@example.test`,
    workspaceName: role,
  });
  const organization = await prisma.organization.create({
    data: { name: role, workspaceType: 'SCHOOL' },
  });
  await prisma.membership.create({
    data: { userId: actor.user.id, organizationId: organization.id, role },
  });
  return { actor, context: context(actor, role, organization.id, 'SCHOOL') };
}

describe('Phase 30 persisted authorization matrix', () => {
  afterAll(() => prisma.$disconnect());

  it.each(['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'] as const)(
    'allows active %s membership to administer organization-private sources in its own organization',
    async (role) => {
      const { context: tenant } = await schoolContext(role);
      const source = await createKnowledgeSource(tenant, {
        version: '1.0.0',
        title: `private-${role}`,
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'matrix',
      });
      expect(source.visibility).toBe('ORGANIZATION_PRIVATE');
    },
  );

  it('enforces both tenant directions, exact-owner private access, and persisted state', async () => {
    const a = await createPersonalWorkspace({
      email: `p30-matrix-a-${Date.now()}@example.test`,
      workspaceName: 'A',
    });
    const b = await createPersonalWorkspace({
      email: `p30-matrix-b-${Date.now()}@example.test`,
      workspaceName: 'B',
    });
    const tenantA = context(a);
    const tenantB = context(b);
    const sourceA = await createKnowledgeSource(tenantA, {
      version: '1.0.0',
      title: 'A private',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'matrix',
    });
    const sourceB = await createKnowledgeSource(tenantB, {
      version: '1.0.0',
      title: 'B private',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'matrix',
    });
    expect(await getKnowledgeSource(tenantB, sourceA.id)).toBeNull();
    expect(await getKnowledgeSource(tenantA, sourceB.id)).toBeNull();
    await expect(
      createKnowledgeSource(
        { ...tenantA, role: 'PLATFORM_ADMIN' },
        {
          version: '1.0.0',
          title: 'forged role ignored',
          visibility: 'ORGANIZATION_PRIVATE',
          origin: 'matrix',
        },
      ),
    ).resolves.toMatchObject({ visibility: 'ORGANIZATION_PRIVATE' });

    const inactiveMembership = await schoolContext('TEACHER');
    await prisma.membership.update({
      where: {
        userId_organizationId: {
          userId: inactiveMembership.actor.user.id,
          organizationId: inactiveMembership.context.organizationId,
        },
      },
      data: { status: 'INACTIVE' },
    });
    await expect(
      createKnowledgeSource(inactiveMembership.context, {
        version: '1.0.0',
        title: 'inactive membership',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'matrix',
      }),
    ).rejects.toThrow('Resource not found or unavailable');

    const inactiveUser = await schoolContext('TEACHER');
    await prisma.user.update({
      where: { id: inactiveUser.actor.user.id },
      data: { status: 'INACTIVE' },
    });
    await expect(
      createKnowledgeSource(inactiveUser.context, {
        version: '1.0.0',
        title: 'inactive user',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'matrix',
      }),
    ).rejects.toThrow('Resource not found or unavailable');

    const inactiveOrg = await schoolContext('TEACHER');
    await prisma.organization.update({
      where: { id: inactiveOrg.context.organizationId },
      data: { status: 'INACTIVE' },
    });
    await expect(
      createKnowledgeSource(inactiveOrg.context, {
        version: '1.0.0',
        title: 'inactive org',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'matrix',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
  });

  it('requires persisted platform curation and grants no private-tenant authority', async () => {
    const curator = await createPersonalWorkspace({
      email: `p30-curator-${Date.now()}@example.test`,
      workspaceName: 'Curator',
    });
    await prisma.user.update({ where: { id: curator.user.id }, data: { platformAdmin: true } });
    const platform = context(curator);
    const shared = await createKnowledgeSource(platform, {
      version: '1.0.0',
      title: 'platform shared',
      visibility: 'PLATFORM_SHARED',
      origin: 'matrix',
    });
    expect(shared.organizationId).toBeNull();

    const tenant = await createPersonalWorkspace({
      email: `p30-shared-tenant-${Date.now()}@example.test`,
      workspaceName: 'Tenant',
    });
    const tenantContext = context(tenant);
    await expect(
      createKnowledgeSource(tenantContext, {
        version: '1.0.0',
        title: 'tenant shared',
        visibility: 'PLATFORM_SHARED',
        origin: 'matrix',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    expect(await getKnowledgeSource(tenantContext, shared.id)).toMatchObject({
      id: shared.id,
      visibility: 'PLATFORM_SHARED',
    });

    await prisma.user.update({ where: { id: curator.user.id }, data: { status: 'INACTIVE' } });
    await expect(
      createKnowledgeSource(platform, {
        version: '1.0.0',
        title: 'inactive curator',
        visibility: 'PLATFORM_SHARED',
        origin: 'matrix',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await prisma.user.update({
      where: { id: curator.user.id },
      data: { status: 'ACTIVE', platformAdmin: false },
    });
    await expect(
      createKnowledgeSource(
        { ...platform, principal: { ...platform.principal, platformAdmin: true } },
        {
          version: '1.0.0',
          title: 'forged boolean',
          visibility: 'PLATFORM_SHARED',
          origin: 'matrix',
        },
      ),
    ).rejects.toThrow('Resource not found or unavailable');

    const platformOnly = await createPersonalWorkspace({
      email: `p30-platform-only-${Date.now()}@example.test`,
      workspaceName: 'Platform only',
    });
    const school = await prisma.organization.create({
      data: { name: 'Platform-only school', workspaceType: 'SCHOOL' },
    });
    await prisma.membership.create({
      data: {
        userId: platformOnly.user.id,
        organizationId: school.id,
        role: 'PLATFORM_ADMIN',
        status: 'INACTIVE',
      },
    });
    await prisma.user.update({
      where: { id: platformOnly.user.id },
      data: { platformAdmin: true },
    });
    expect(
      await createKnowledgeSource(context(platformOnly, 'PLATFORM_ADMIN', school.id, 'SCHOOL'), {
        version: '1.0.0',
        title: 'platform-only curation',
        visibility: 'PLATFORM_SHARED',
        origin: 'matrix',
      }),
    ).toMatchObject({ organizationId: null });

    const privateSource = await createKnowledgeSource(tenantContext, {
      version: '1.0.0',
      title: 'tenant private',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'matrix',
    });
    expect(await getKnowledgeSource(platform, privateSource.id)).toBeNull();
  });
});
