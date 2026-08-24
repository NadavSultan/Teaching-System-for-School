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
  retrieveEligibleKnowledge,
  runIngestion,
  setSourceLifecycle,
} from './index.js';

const states = [
  'inactive-user',
  'inactive-membership',
  'inactive-organization',
  'platform-membership',
  'missing-membership',
  'organization-mismatch',
] as const;

function makeContext(
  actor: any,
  organizationId: string,
  role: 'TEACHER' | 'PLATFORM_ADMIN' = 'TEACHER',
) {
  return {
    principal: {
      version: CONTRACT_VERSION,
      userId: actor.user.id,
      email: actor.user.normalizedEmail,
      provider: 'development',
      providerSubject: `dev:${actor.user.id}`,
      platformAdmin: false,
    },
    organizationId,
    userStatus: 'ACTIVE' as const,
    membershipStatus: 'ACTIVE' as const,
    role,
    organizationStatus: 'ACTIVE' as const,
    workspaceType: 'SCHOOL' as const,
  };
}

async function completePrivateFixture() {
  const actor = await createPersonalWorkspace({
    email: `p30-state-${Date.now()}@example.test`,
    workspaceName: 'State',
  });
  const organization = await prisma.organization.create({
    data: { name: `State ${Date.now()}`, workspaceType: 'SCHOOL' },
  });
  const membership = await prisma.membership.create({
    data: { userId: actor.user.id, organizationId: organization.id, role: 'TEACHER' },
  });
  const context = makeContext(actor, organization.id);
  const curriculum = await importCurriculumDraft({
    version: '1.0.0',
    code: `P30_STATE_${Date.now()}`,
    educationSystemCode: 'IL',
    subjectCode: 'HE',
    displayName: 'State',
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
  await publishCurriculumVersion(curriculum.version.id, actor.user.id);
  const node = await prisma.curriculumNode.findFirstOrThrow({
    where: { versionId: curriculum.version.id, code: 'S1' },
  });
  const source = await createKnowledgeSource(context, {
    version: '1.0.0',
    title: 'state private',
    visibility: 'ORGANIZATION_PRIVATE',
    origin: 'state',
  });
  const version = await registerSourceVersion(context, {
    version: '1.0.0',
    sourceId: source.id,
    idempotencyKey: 'state-v1',
    content: 'state text',
    contentReference: 'fixture://state',
    contentMimeType: 'text/plain',
    metadata: {},
    curriculumVersionId: curriculum.version.id,
    curriculumNodeIds: [node.id],
  });
  await recordPedagogicalReview(context, {
    version: '1.0.0',
    sourceVersionId: version.id,
    decision: 'APPROVED',
    reason: 'state',
  });
  await recordUsagePermission(context, {
    version: '1.0.0',
    sourceVersionId: version.id,
    decision: 'ALLOWED',
    evidenceReference: 'state',
    scope: 'RETRIEVAL',
  });
  const run = await requestIngestion(context, {
    version: '1.0.0',
    sourceVersionId: version.id,
    pipelineVersion: 'plain-v1',
  });
  await runIngestion(run.id);
  await setSourceLifecycle(context, version.id, 'ACTIVE', 'state');
  const item = await prisma.knowledgeItem.findFirstOrThrow({
    where: { sourceVersionId: version.id },
  });
  return {
    actor,
    organization,
    membership,
    context,
    source,
    version,
    run,
    item,
    curriculumVersionId: curriculum.version.id,
    curriculumNodeId: node.id,
  };
}

describe('Phase 30 persisted-state denial matrix', () => {
  afterAll(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.$disconnect();
  });
  it.each(states)('%s denies every private Phase 30 operation', async (state) => {
    const fixture = await completePrivateFixture();
    let context = fixture.context;
    if (state === 'inactive-user')
      await prisma.user.update({
        where: { id: fixture.actor.user.id },
        data: { status: 'INACTIVE' },
      });
    if (state === 'inactive-membership')
      await prisma.membership.update({
        where: { id: fixture.membership.id },
        data: { status: 'INACTIVE' },
      });
    if (state === 'inactive-organization')
      await prisma.organization.update({
        where: { id: fixture.organization.id },
        data: { status: 'INACTIVE' },
      });
    if (state === 'platform-membership') {
      await prisma.membership.update({
        where: { id: fixture.membership.id },
        data: { role: 'PLATFORM_ADMIN' },
      });
      context = makeContext(fixture.actor, fixture.organization.id, 'PLATFORM_ADMIN');
    }
    if (state === 'missing-membership')
      await prisma.membership.delete({ where: { id: fixture.membership.id } });
    if (state === 'organization-mismatch') {
      const other = await prisma.organization.create({
        data: { name: `Mismatch ${Date.now()}`, workspaceType: 'SCHOOL' },
      });
      context = makeContext(fixture.actor, other.id);
    }
    const registration = {
      version: '1.0.0' as const,
      sourceId: fixture.source.id,
      idempotencyKey: `denied-${state}`,
      content: 'denied',
      contentReference: `fixture://denied-${state}`,
      contentMimeType: 'text/plain',
      metadata: {},
      curriculumVersionId: fixture.curriculumVersionId,
      curriculumNodeIds: [fixture.curriculumNodeId],
    };
    await expect(
      createKnowledgeSource(context, {
        version: '1.0.0',
        title: 'denied',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'state',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(getKnowledgeSource(context, fixture.source.id)).resolves.toBeNull();
    await expect(getSourceVersion(context, fixture.version.id)).resolves.toBeNull();
    await expect(getKnowledgeItem(context, fixture.item.id)).resolves.toBeNull();
    await expect(getIngestionStatus(context, fixture.run.id)).resolves.toBeNull();
    await expect(registerSourceVersion(context, registration)).rejects.toThrow(
      'Resource not found or unavailable',
    );
    await expect(
      recordPedagogicalReview(context, {
        version: '1.0.0',
        sourceVersionId: fixture.version.id,
        decision: 'REJECTED',
        reason: 'denied',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      recordUsagePermission(context, {
        version: '1.0.0',
        sourceVersionId: fixture.version.id,
        decision: 'DENIED',
        evidenceReference: 'denied',
        scope: 'RETRIEVAL',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      requestIngestion(context, {
        version: '1.0.0',
        sourceVersionId: fixture.version.id,
        pipelineVersion: 'plain-v1',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      setSourceLifecycle(context, fixture.version.id, 'SUSPENDED', 'denied'),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      retrieveEligibleKnowledge(context, {
        version: '1.0.0',
        query: 'state',
        organizationId: context.organizationId,
        curriculumVersionId: fixture.curriculumVersionId,
        curriculumNodeIds: [fixture.curriculumNodeId],
        limit: 10,
      }),
    ).rejects.toThrow('Resource not found or unavailable');
  });
});
