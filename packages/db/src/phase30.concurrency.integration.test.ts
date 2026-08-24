import { afterAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@teach/contracts';
import {
  createKnowledgeSource,
  createPersonalWorkspace,
  importCurriculumDraft,
  prisma,
  publishCurriculumVersion,
  registerSourceVersion,
} from './index.js';

describe('Phase 30 concurrent SourceVersion numbering', () => {
  afterAll(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.$disconnect();
  });
  it('serializes different version registrations on one source', async () => {
    const workspace = await createPersonalWorkspace({
      email: `p30-concurrent-${Date.now()}@example.test`,
      workspaceName: 'Concurrent',
    });
    const context = {
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
    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `P30_CONCURRENT_${Date.now()}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Concurrent',
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
    await publishCurriculumVersion(curriculum.version.id, workspace.user.id);
    const node = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id, code: 'S1' },
    });
    const source = await createKnowledgeSource(context, {
      version: '1.0.0',
      title: 'Concurrent source',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'concurrency',
    });
    const input = (key: string, content: string) => ({
      version: '1.0.0' as const,
      sourceId: source.id,
      idempotencyKey: key,
      content,
      contentReference: `fixture://${key}`,
      contentMimeType: 'text/plain',
      metadata: {},
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [node.id],
    });
    const [first, second] = await Promise.all([
      registerSourceVersion(context, input('concurrent-a', 'first hash')),
      registerSourceVersion(context, input('concurrent-b', 'second hash')),
    ]);
    expect(new Set([first.id, second.id]).size).toBe(2);
    expect(new Set([first.versionNumber, second.versionNumber]).size).toBe(2);
    expect([first.versionNumber, second.versionNumber].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(new Set([first.contentHash, second.contentHash]).size).toBe(2);
    const versions = await prisma.sourceVersion.findMany({
      where: { sourceId: source.id },
      orderBy: { versionNumber: 'asc' },
      include: { lifecycleEvents: true },
    });
    expect(versions.map((row) => row.versionNumber)).toEqual([1, 2]);
    expect(
      versions.every((row) =>
        row.lifecycleEvents.some(
          (event) => event.fromStatus === null && event.toStatus === 'DRAFT',
        ),
      ),
    ).toBe(true);
    expect(await registerSourceVersion(context, input('concurrent-a', 'first hash'))).toEqual(
      first,
    );
  });
});
