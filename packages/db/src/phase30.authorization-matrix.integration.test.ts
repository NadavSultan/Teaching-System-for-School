import { afterAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@teach/contracts';
import {
  createKnowledgeSource,
  createPersonalWorkspace,
  getIngestionStatus,
  getKnowledgeItem,
  getKnowledgeSource,
  getSourceVersion,
  importCurriculumDraft,
  prisma,
  publishCurriculumVersion,
  recordPedagogicalReview,
  recordUsagePermission,
  registerSourceVersion,
  requestIngestion,
  resolvePlatformAccessContext,
  retrieveEligibleKnowledge,
  runIngestion,
  setSourceLifecycle,
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

async function publishedSkill(actorUserId: string) {
  const curriculum = await importCurriculumDraft({
    version: '1.0.0',
    code: `P30_ROLE_${Date.now()}`,
    educationSystemCode: 'IL',
    subjectCode: 'HE',
    displayName: 'Role matrix',
    versionNumber: 1,
    nodes: [
      {
        type: 'GRADE',
        code: 'G7',
        label: 'ז',
        sortOrder: 1,
        children: [
          {
            type: 'DOMAIN',
            code: 'D1',
            label: 'ד',
            sortOrder: 1,
            children: [
              {
                type: 'TOPIC',
                code: 'T1',
                label: 'נ',
                sortOrder: 1,
                children: [
                  {
                    type: 'SUBTOPIC',
                    code: 'ST1',
                    label: 'ת',
                    sortOrder: 1,
                    children: [
                      {
                        type: 'SKILL',
                        code: 'S1',
                        label: 'מיומנות',
                        sortOrder: 1,
                        difficulties: ['LOW'],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  await publishCurriculumVersion(curriculum.version.id, actorUserId);
  const node = await prisma.curriculumNode.findFirstOrThrow({
    where: { versionId: curriculum.version.id, code: 'S1' },
  });
  return { versionId: curriculum.version.id, nodeId: node.id };
}

describe('Phase 30 persisted authorization matrix', () => {
  afterAll(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.$disconnect();
  });

  it.each(['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'] as const)(
    'allows active %s membership to administer organization-private sources in its own organization',
    async (role) => {
      const { context: tenant } = await schoolContext(role);
      const curriculum = await publishedSkill(tenant.principal.userId);
      const source = await createKnowledgeSource(tenant, {
        version: '1.0.0',
        title: `private-${role}`,
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'matrix',
      });
      expect(source.visibility).toBe('ORGANIZATION_PRIVATE');
      const registration = {
        version: '1.0.0' as const,
        sourceId: source.id,
        idempotencyKey: `role-${role}`,
        content: `role ${role} expected text`,
        contentReference: `fixture://role-${role}`,
        contentMimeType: 'text/plain',
        metadata: {},
        curriculumVersionId: curriculum.versionId,
        curriculumNodeIds: [curriculum.nodeId],
      };
      const version = await registerSourceVersion(tenant, registration);
      expect(await registerSourceVersion(tenant, registration)).toEqual(version);
      expect(await getKnowledgeSource(tenant, source.id)).toMatchObject({ id: source.id });
      expect(await getSourceVersion(tenant, version.id)).toMatchObject({
        id: version.id,
        lifecycle: 'DRAFT',
      });
      await recordPedagogicalReview(tenant, {
        version: '1.0.0',
        sourceVersionId: version.id,
        decision: 'APPROVED',
        reason: 'role matrix',
      });
      await recordUsagePermission(tenant, {
        version: '1.0.0',
        sourceVersionId: version.id,
        decision: 'ALLOWED',
        evidenceReference: 'role matrix',
        scope: 'RETRIEVAL',
      });
      const run = await requestIngestion(tenant, {
        version: '1.0.0',
        sourceVersionId: version.id,
        pipelineVersion: 'plain-v1',
      });
      await runIngestion(run.id);
      await setSourceLifecycle(tenant, version.id, 'ACTIVE', 'role matrix active');
      expect(await getIngestionStatus(tenant, run.id)).toMatchObject({ status: 'SUCCEEDED' });
      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { sourceVersionId: version.id },
      });
      expect(await getKnowledgeItem(tenant, item.id)).toMatchObject({
        sourceVersionId: version.id,
      });
      expect(
        (
          await retrieveEligibleKnowledge(tenant, {
            version: '1.0.0',
            query: 'expected',
            organizationId: tenant.organizationId,
            curriculumVersionId: curriculum.versionId,
            curriculumNodeIds: [curriculum.nodeId],
            limit: 10,
          })
        ).items,
      ).toHaveLength(1);
      await setSourceLifecycle(tenant, version.id, 'SUSPENDED', 'role matrix suspended');
      expect(
        (
          await retrieveEligibleKnowledge(tenant, {
            version: '1.0.0',
            query: 'expected',
            organizationId: tenant.organizationId,
            curriculumVersionId: curriculum.versionId,
            curriculumNodeIds: [curriculum.nodeId],
            limit: 10,
          })
        ).items,
      ).toHaveLength(0);
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
    const platform = await resolvePlatformAccessContext({
      version: CONTRACT_VERSION,
      userId: curator.user.id,
      email: curator.user.normalizedEmail,
      provider: 'development',
      providerSubject: `dev:${curator.user.id}`,
      platformAdmin: false,
    });
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

    const platformOnly = await prisma.user.create({
      data: {
        normalizedEmail: `p30-platform-only-${Date.now()}@example.test`,
        platformAdmin: true,
      },
    });
    expect(await prisma.membership.count({ where: { userId: platformOnly.id } })).toBe(0);
    const platformOnlyContext = await resolvePlatformAccessContext({
      version: CONTRACT_VERSION,
      userId: platformOnly.id,
      email: platformOnly.normalizedEmail,
      provider: 'development',
      providerSubject: `dev:${platformOnly.id}`,
      platformAdmin: false,
    });
    expect(
      await createKnowledgeSource(platformOnlyContext, {
        version: '1.0.0',
        title: 'platform-only curation',
        visibility: 'PLATFORM_SHARED',
        origin: 'matrix',
      }),
    ).toMatchObject({ organizationId: null });

    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `P30_PLATFORM_${Date.now()}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Platform',
      versionNumber: 1,
      nodes: [
        {
          type: 'GRADE',
          code: 'G7',
          label: 'ז',
          sortOrder: 1,
          children: [
            {
              type: 'DOMAIN',
              code: 'D1',
              label: 'ד',
              sortOrder: 1,
              children: [
                {
                  type: 'TOPIC',
                  code: 'T1',
                  label: 'נ',
                  sortOrder: 1,
                  children: [
                    {
                      type: 'SUBTOPIC',
                      code: 'ST1',
                      label: 'ת',
                      sortOrder: 1,
                      children: [
                        {
                          type: 'SKILL',
                          code: 'S1',
                          label: 'מיומנות',
                          sortOrder: 1,
                          difficulties: ['LOW'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await publishCurriculumVersion(curriculum.version.id, platformOnly.id);
    const node = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id, code: 'S1' },
    });
    const platformOnlySource = await createKnowledgeSource(platformOnlyContext, {
      version: '1.0.0',
      title: 'platform-only full flow',
      visibility: 'PLATFORM_SHARED',
      origin: 'matrix',
    });
    const registration = {
      version: '1.0.0' as const,
      sourceId: platformOnlySource.id,
      idempotencyKey: 'platform-only-v1',
      content: 'platform only text',
      contentReference: 'fixture://platform-only',
      contentMimeType: 'text/plain',
      metadata: {},
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [node.id],
    };
    const platformOnlyVersion = await registerSourceVersion(platformOnlyContext, registration);
    expect(await registerSourceVersion(platformOnlyContext, registration)).toEqual(
      platformOnlyVersion,
    );
    await recordPedagogicalReview(platformOnlyContext, {
      version: '1.0.0',
      sourceVersionId: platformOnlyVersion.id,
      decision: 'APPROVED',
      reason: 'platform-only',
    });
    await recordUsagePermission(platformOnlyContext, {
      version: '1.0.0',
      sourceVersionId: platformOnlyVersion.id,
      decision: 'ALLOWED',
      evidenceReference: 'platform-only',
      scope: 'RETRIEVAL',
    });
    const platformOnlyRun = await requestIngestion(platformOnlyContext, {
      version: '1.0.0',
      sourceVersionId: platformOnlyVersion.id,
      pipelineVersion: 'plain-v1',
    });
    await runIngestion(platformOnlyRun.id);
    await setSourceLifecycle(
      platformOnlyContext,
      platformOnlyVersion.id,
      'ACTIVE',
      'platform-only',
    );
    expect(await getSourceVersion(platformOnlyContext, platformOnlyVersion.id)).toMatchObject({
      lifecycle: 'ACTIVE',
    });
    expect(await getIngestionStatus(platformOnlyContext, platformOnlyRun.id)).toMatchObject({
      status: 'SUCCEEDED',
    });
    const platformOnlyItem = await prisma.knowledgeItem.findFirstOrThrow({
      where: { sourceVersionId: platformOnlyVersion.id },
    });
    expect(await getKnowledgeItem(platformOnlyContext, platformOnlyItem.id)).toMatchObject({
      sourceVersionId: platformOnlyVersion.id,
    });
    expect(
      (
        await retrieveEligibleKnowledge(tenantContext, {
          version: '1.0.0',
          query: 'platform only',
          organizationId: tenantContext.organizationId,
          curriculumVersionId: curriculum.version.id,
          curriculumNodeIds: [node.id],
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);

    for (const role of ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'] as const) {
      const { context: tenantRole } = await schoolContext(role);
      await expect(
        createKnowledgeSource(tenantRole, {
          version: '1.0.0',
          title: 'tenant shared denied',
          visibility: 'PLATFORM_SHARED',
          origin: 'matrix',
        }),
      ).rejects.toThrow('Resource not found or unavailable');
      await expect(registerSourceVersion(tenantRole, registration)).rejects.toThrow(
        'Resource not found or unavailable',
      );
      await expect(
        recordPedagogicalReview(tenantRole, {
          version: '1.0.0',
          sourceVersionId: platformOnlyVersion.id,
          decision: 'REJECTED',
          reason: 'tenant denied',
        }),
      ).rejects.toThrow('Resource not found or unavailable');
      await expect(
        recordUsagePermission(tenantRole, {
          version: '1.0.0',
          sourceVersionId: platformOnlyVersion.id,
          decision: 'DENIED',
          evidenceReference: 'tenant denied',
          scope: 'RETRIEVAL',
        }),
      ).rejects.toThrow('Resource not found or unavailable');
      await expect(
        requestIngestion(tenantRole, {
          version: '1.0.0',
          sourceVersionId: platformOnlyVersion.id,
          pipelineVersion: 'plain-v1',
        }),
      ).rejects.toThrow('Resource not found or unavailable');
      await expect(
        setSourceLifecycle(tenantRole, platformOnlyVersion.id, 'SUSPENDED', 'tenant denied'),
      ).rejects.toThrow('Resource not found or unavailable');
      expect(await getKnowledgeSource(tenantRole, platformOnlySource.id)).toMatchObject({
        id: platformOnlySource.id,
      });
      expect(await getSourceVersion(tenantRole, platformOnlyVersion.id)).toMatchObject({
        id: platformOnlyVersion.id,
      });
      expect(await getKnowledgeItem(tenantRole, platformOnlyItem.id)).toMatchObject({
        sourceVersionId: platformOnlyVersion.id,
      });
      expect(await getIngestionStatus(tenantRole, platformOnlyRun.id)).toMatchObject({
        status: 'SUCCEEDED',
      });
      expect(
        (
          await retrieveEligibleKnowledge(tenantRole, {
            version: '1.0.0',
            query: 'platform only',
            organizationId: tenantRole.organizationId,
            curriculumVersionId: curriculum.version.id,
            curriculumNodeIds: [node.id],
            limit: 10,
          })
        ).items,
      ).toHaveLength(1);
    }

    const privateSource = await createKnowledgeSource(tenantContext, {
      version: '1.0.0',
      title: 'tenant private',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'matrix',
    });
    const privateVersion = await registerSourceVersion(tenantContext, {
      version: '1.0.0',
      sourceId: privateSource.id,
      idempotencyKey: 'private-platform-denial',
      content: 'private',
      contentReference: 'fixture://private-platform',
      contentMimeType: 'text/plain',
      metadata: {},
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [node.id],
    });
    await recordPedagogicalReview(tenantContext, {
      version: '1.0.0',
      sourceVersionId: privateVersion.id,
      decision: 'APPROVED',
      reason: 'private fixture',
    });
    await recordUsagePermission(tenantContext, {
      version: '1.0.0',
      sourceVersionId: privateVersion.id,
      decision: 'ALLOWED',
      evidenceReference: 'private fixture',
      scope: 'RETRIEVAL',
    });
    const privateRun = await requestIngestion(tenantContext, {
      version: '1.0.0',
      sourceVersionId: privateVersion.id,
      pipelineVersion: 'plain-v1',
    });
    await runIngestion(privateRun.id);
    await setSourceLifecycle(tenantContext, privateVersion.id, 'ACTIVE', 'private fixture');
    const privateItem = await prisma.knowledgeItem.findFirstOrThrow({
      where: { sourceVersionId: privateVersion.id },
    });
    await expect(
      createKnowledgeSource(platformOnlyContext, {
        version: '1.0.0',
        title: 'platform private denied',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'matrix',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    expect(await getKnowledgeSource(platformOnlyContext, privateSource.id)).toBeNull();
    expect(await getSourceVersion(platformOnlyContext, privateVersion.id)).toBeNull();
    expect(await getKnowledgeItem(platformOnlyContext, privateItem.id)).toBeNull();
    expect(await getIngestionStatus(platformOnlyContext, privateRun.id)).toBeNull();
    await expect(
      registerSourceVersion(platformOnlyContext, {
        ...registration,
        sourceId: privateSource.id,
        idempotencyKey: 'platform-private-version',
        content: 'private2',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      recordPedagogicalReview(platformOnlyContext, {
        version: '1.0.0',
        sourceVersionId: privateVersion.id,
        decision: 'REJECTED',
        reason: 'platform private denied',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      recordUsagePermission(platformOnlyContext, {
        version: '1.0.0',
        sourceVersionId: privateVersion.id,
        decision: 'DENIED',
        evidenceReference: 'platform private denied',
        scope: 'RETRIEVAL',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      requestIngestion(platformOnlyContext, {
        version: '1.0.0',
        sourceVersionId: privateVersion.id,
        pipelineVersion: 'plain-v1',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      setSourceLifecycle(
        platformOnlyContext,
        privateVersion.id,
        'SUSPENDED',
        'platform private denied',
      ),
    ).rejects.toThrow('Resource not found or unavailable');
    expect(await getKnowledgeSource(platform, privateSource.id)).toBeNull();
  });
});
