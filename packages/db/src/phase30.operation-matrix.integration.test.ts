import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

type Tenant = ReturnType<typeof tenantContext>;
type Fixture = {
  a: Tenant;
  b: Tenant;
  sourceA: { id: string };
  sourceB: { id: string };
  versionA: { id: string };
  versionB: { id: string };
  runA: { id: string };
  runB: { id: string };
  itemA: { id: string };
  itemB: { id: string };
  curriculumVersionId: string;
  curriculumNodeId: string;
};

function tenantContext(workspace: any) {
  return {
    principal: {
      version: CONTRACT_VERSION,
      userId: workspace.user.id,
      email: workspace.user.normalizedEmail,
      provider: 'development',
      providerSubject: `dev:${workspace.user.id}`,
      platformAdmin: false,
    },
    organizationId: workspace.organization.id,
    userStatus: 'ACTIVE' as const,
    membershipStatus: 'ACTIVE' as const,
    role: 'TEACHER' as const,
    organizationStatus: 'ACTIVE' as const,
    workspaceType: 'PERSONAL' as const,
  };
}

async function createCompleteFixture(): Promise<Fixture> {
  const a = tenantContext(
    await createPersonalWorkspace({
      email: `p30-op-a-${Date.now()}@example.test`,
      workspaceName: 'A',
    }),
  );
  const b = tenantContext(
    await createPersonalWorkspace({
      email: `p30-op-b-${Date.now()}@example.test`,
      workspaceName: 'B',
    }),
  );
  const curriculum = await importCurriculumDraft({
    version: '1.0.0',
    code: `P30_OP_${Date.now()}`,
    educationSystemCode: 'IL',
    subjectCode: 'HE',
    displayName: 'Operation matrix',
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
  await publishCurriculumVersion(curriculum.version.id, a.principal.userId);
  const node = await prisma.curriculumNode.findFirstOrThrow({
    where: { versionId: curriculum.version.id, code: 'S1' },
  });
  const sourceA = await createKnowledgeSource(a, {
    version: '1.0.0',
    title: 'A private',
    visibility: 'ORGANIZATION_PRIVATE',
    origin: 'matrix',
  });
  const sourceB = await createKnowledgeSource(b, {
    version: '1.0.0',
    title: 'B private',
    visibility: 'ORGANIZATION_PRIVATE',
    origin: 'matrix',
  });
  const registration = (sourceId: string, key: string, content: string) => ({
    version: '1.0.0' as const,
    sourceId,
    idempotencyKey: key,
    content,
    contentReference: `fixture://${key}`,
    contentMimeType: 'text/plain',
    curriculumVersionId: curriculum.version.id,
    curriculumNodeIds: [node.id],
  });
  const versionA = await registerSourceVersion(
    a,
    registration(sourceA.id, 'a-v1', 'A matrix text'),
  );
  const versionB = await registerSourceVersion(
    b,
    registration(sourceB.id, 'b-v1', 'B matrix text'),
  );
  for (const [context, version] of [
    [a, versionA],
    [b, versionB],
  ] as const) {
    await recordPedagogicalReview(context, {
      version: '1.0.0',
      sourceVersionId: version.id,
      decision: 'APPROVED',
      reason: 'matrix',
    });
    await recordUsagePermission(context, {
      version: '1.0.0',
      sourceVersionId: version.id,
      decision: 'ALLOWED',
      evidenceReference: 'matrix',
      scope: 'RETRIEVAL',
    });
  }
  const runA = await requestIngestion(a, {
    version: '1.0.0',
    sourceVersionId: versionA.id,
    pipelineVersion: 'plain-v1',
  });
  const runB = await requestIngestion(b, {
    version: '1.0.0',
    sourceVersionId: versionB.id,
    pipelineVersion: 'plain-v1',
  });
  await runIngestion(runA.id);
  await runIngestion(runB.id);
  await setSourceLifecycle(a, versionA.id, 'ACTIVE', 'matrix active');
  await setSourceLifecycle(b, versionB.id, 'ACTIVE', 'matrix active');
  const itemA = await prisma.knowledgeItem.findFirstOrThrow({
    where: { sourceVersionId: versionA.id },
  });
  const itemB = await prisma.knowledgeItem.findFirstOrThrow({
    where: { sourceVersionId: versionB.id },
  });
  return {
    a,
    b,
    sourceA,
    sourceB,
    versionA,
    versionB,
    runA,
    runB,
    itemA,
    itemB,
    curriculumVersionId: curriculum.version.id,
    curriculumNodeId: node.id,
  };
}

describe('Phase 30 complete bidirectional tenant operation matrix', () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await createCompleteFixture();
  });
  afterAll(() => prisma.$disconnect());

  const operations = [
    [
      'createKnowledgeSource',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        createKnowledgeSource(
          {
            ...target,
            organizationId: foreign === 'A' ? resource.a.organizationId : resource.b.organizationId,
          },
          {
            version: '1.0.0',
            title: 'foreign create',
            visibility: 'ORGANIZATION_PRIVATE',
            origin: 'matrix',
          },
        ),
    ],
    [
      'getKnowledgeSource',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        getKnowledgeSource(target, foreign === 'A' ? resource.sourceA.id : resource.sourceB.id),
    ],
    [
      'getSourceVersion',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        getSourceVersion(target, foreign === 'A' ? resource.versionA.id : resource.versionB.id),
    ],
    [
      'getKnowledgeItem',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        getKnowledgeItem(target, foreign === 'A' ? resource.itemA.id : resource.itemB.id),
    ],
    [
      'getIngestionStatus',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        getIngestionStatus(target, foreign === 'A' ? resource.runA.id : resource.runB.id),
    ],
    [
      'registerSourceVersion',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        registerSourceVersion(target, {
          version: '1.0.0',
          sourceId: foreign === 'A' ? resource.sourceA.id : resource.sourceB.id,
          idempotencyKey: `foreign-${foreign}`,
          content: 'foreign',
          contentReference: 'fixture://foreign',
          contentMimeType: 'text/plain',
          curriculumVersionId: resource.curriculumVersionId,
          curriculumNodeIds: [resource.curriculumNodeId],
        }),
    ],
    [
      'recordPedagogicalReview',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        recordPedagogicalReview(target, {
          version: '1.0.0',
          sourceVersionId: foreign === 'A' ? resource.versionA.id : resource.versionB.id,
          decision: 'REJECTED',
          reason: 'foreign',
        }),
    ],
    [
      'recordUsagePermission',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        recordUsagePermission(target, {
          version: '1.0.0',
          sourceVersionId: foreign === 'A' ? resource.versionA.id : resource.versionB.id,
          decision: 'DENIED',
          evidenceReference: 'foreign',
          scope: 'RETRIEVAL',
        }),
    ],
    [
      'requestIngestion',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        requestIngestion(target, {
          version: '1.0.0',
          sourceVersionId: foreign === 'A' ? resource.versionA.id : resource.versionB.id,
          pipelineVersion: 'plain-v1',
        }),
    ],
    [
      'setSourceLifecycle',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') =>
        setSourceLifecycle(
          target,
          foreign === 'A' ? resource.versionA.id : resource.versionB.id,
          'SUSPENDED',
          'foreign',
        ),
    ],
    [
      'retrieveEligibleKnowledge',
      async (target: Tenant, resource: Fixture, foreign: 'A' | 'B') => {
        void foreign;
        return retrieveEligibleKnowledge(target, {
          version: '1.0.0',
          query: 'matrix',
          organizationId: target.organizationId,
          curriculumVersionId: resource.curriculumVersionId,
          curriculumNodeIds: [resource.curriculumNodeId],
          limit: 10,
        });
      },
    ],
  ] as const;

  it.each(operations)('%s denies A targeting B and B targeting A', async (_name, operation) => {
    const attempts = [
      [fixture.a, 'B' as const],
      [fixture.b, 'A' as const],
    ] as const;
    for (const [target, foreign] of attempts) {
      if (
        [
          'getKnowledgeSource',
          'getSourceVersion',
          'getKnowledgeItem',
          'getIngestionStatus',
        ].includes(_name)
      ) {
        await expect(operation(target, fixture, foreign)).resolves.toBeNull();
      } else if (_name === 'retrieveEligibleKnowledge') {
        const result = (await operation(target, fixture, foreign)) as {
          items: Array<{ id: string }>;
        };
        expect(
          result.items.some(
            (item) => item.id === (foreign === 'A' ? fixture.itemA.id : fixture.itemB.id),
          ),
        ).toBe(false);
      } else {
        await expect(operation(target, fixture, foreign)).rejects.toThrow(
          'Resource not found or unavailable',
        );
      }
    }
  });

  it('rejects a forged organization context for private creation', async () => {
    await expect(
      createKnowledgeSource(
        { ...fixture.a, organizationId: fixture.b.organizationId },
        {
          version: '1.0.0',
          title: 'forged',
          visibility: 'ORGANIZATION_PRIVATE',
          origin: 'matrix',
        },
      ),
    ).rejects.toThrow('Resource not found or unavailable');
  });
});
