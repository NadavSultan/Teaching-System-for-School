import { afterAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@teach/contracts';
import {
  createPersonalWorkspace,
  createKnowledgeSource,
  registerSourceVersion,
  recordPedagogicalReview,
  recordUsagePermission,
  setSourceLifecycle,
  requestIngestion,
  runIngestion,
  retrieveEligibleKnowledge,
  prisma,
  importCurriculumDraft,
  publishCurriculumVersion,
  IdempotencyConflictError,
} from './index.js';

describe('Phase 30 source registry and controlled knowledge', () => {
  afterAll(() => prisma.$disconnect());
  it('keeps review and permission independent, ingests idempotently, and retrieves exact eligible provenance', async () => {
    const workspace = await createPersonalWorkspace({
      email: `phase30-${Date.now()}@example.test`,
      workspaceName: 'Phase 30',
    });
    const context = {
      principal: {
        version: CONTRACT_VERSION,
        userId: workspace.user.id,
        email: workspace.user.normalizedEmail,
        provider: 'development',
        providerSubject: 'dev',
        platformAdmin: false,
      },
      organizationId: workspace.organization.id,
      userStatus: 'ACTIVE' as const,
      membershipStatus: 'ACTIVE' as const,
      role: 'SCHOOL_ADMIN' as const,
      organizationStatus: 'ACTIVE' as const,
      workspaceType: 'PERSONAL' as const,
    };
    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `P30_${Date.now()}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Hebrew',
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
              label: 'דקדוק',
              sortOrder: 1,
              children: [
                {
                  type: 'TOPIC',
                  code: 'T1',
                  label: 'פעלים',
                  sortOrder: 1,
                  children: [
                    {
                      type: 'SUBTOPIC',
                      code: 'S1',
                      label: 'זמן',
                      sortOrder: 1,
                      children: [
                        {
                          type: 'SKILL',
                          code: 'K1',
                          label: 'עבר',
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
    const skill = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id, code: 'K1' },
    });
    const source = await createKnowledgeSource(context, {
      version: '1.0.0',
      title: 'מקור בדיקה',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'test-fixture',
    });
    const otherWorkspace = await createPersonalWorkspace({
      email: `phase30-other-${Date.now()}@example.test`,
      workspaceName: 'Other',
    });
    const otherContext = {
      ...context,
      principal: {
        ...context.principal,
        userId: otherWorkspace.user.id,
        email: otherWorkspace.user.normalizedEmail,
      },
      organizationId: otherWorkspace.organization.id,
      role: 'TEACHER' as const,
    };
    const registration = {
      version: '1.0.0',
      sourceId: source.id,
      idempotencyKey: 'v1',
      content: 'שלום עולם\n\nזה קטע פדגוגי',
      contentReference: 'fixture://phase30',
      contentMimeType: 'text/plain',
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [skill.id],
    };
    const version = await registerSourceVersion(context, registration);
    await expect(registerSourceVersion(otherContext, registration)).rejects.toThrow(
      'Resource not found or unavailable',
    );
    await expect(
      recordPedagogicalReview(otherContext, {
        version: '1.0.0',
        sourceVersionId: version.id,
        decision: 'APPROVED',
        reason: 'foreign',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    expect(await registerSourceVersion(context, registration)).toMatchObject({ id: version.id });
    await expect(
      registerSourceVersion(context, { ...registration, content: 'תוכן אחר' }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    const pending = await requestIngestion(context, {
      version: '1.0.0',
      sourceVersionId: version.id,
      pipelineVersion: 'plain-v1',
    });
    expect(pending.status).toBe('PENDING');
    await expect(
      retrieveEligibleKnowledge(context, {
        version: '1.0.0',
        query: 'שלום',
        organizationId: context.organizationId,
        curriculumVersionId: curriculum.version.id,
        curriculumNodeIds: [skill.id],
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [] });
    await recordPedagogicalReview(context, {
      version: '1.0.0',
      sourceVersionId: version.id,
      decision: 'APPROVED',
      reason: 'Reviewed fixture',
    });
    await recordUsagePermission(context, {
      version: '1.0.0',
      sourceVersionId: version.id,
      decision: 'ALLOWED',
      evidenceReference: 'test-rights-001',
      scope: 'AI_GENERATION',
    });
    await setSourceLifecycle(
      context,
      version.id,
      'ACTIVE',
      'Approved for controlled test ingestion',
    );
    await runIngestion(pending.id);
    await runIngestion(pending.id);
    const result = await retrieveEligibleKnowledge(context, {
      version: '1.0.0',
      query: 'שלום',
      organizationId: context.organizationId,
      curriculumVersionId: curriculum.version.id,
      curriculumNodeIds: [skill.id],
      limit: 10,
    });
    expect(
      (
        await retrieveEligibleKnowledge(otherContext, {
          version: '1.0.0',
          query: 'שלום',
          organizationId: otherContext.organizationId,
          curriculumVersionId: curriculum.version.id,
          curriculumNodeIds: [skill.id],
          limit: 10,
        })
      ).items,
    ).toHaveLength(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceVersionId: version.id,
      locator: 'paragraph:1',
      curriculumVersionId: curriculum.version.id,
      curriculumNodeId: skill.id,
    });
    const firstItem = result.items[0];
    expect(firstItem).toBeDefined();
    await expect(
      prisma.sourceVersion.update({
        where: { id: version.id },
        data: { contentHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.knowledgeItem.update({
        where: { id: firstItem!.id },
        data: { normalizedText: 'tampered' },
      }),
    ).rejects.toThrow('immutable');
    await setSourceLifecycle(context, version.id, 'SUSPENDED', 'Rights review');
    expect(
      (
        await retrieveEligibleKnowledge(context, {
          version: '1.0.0',
          query: 'שלום',
          organizationId: context.organizationId,
          curriculumVersionId: curriculum.version.id,
          curriculumNodeIds: [skill.id],
          limit: 10,
        })
      ).items,
    ).toHaveLength(0);
    const version2 = await registerSourceVersion(context, {
      ...registration,
      idempotencyKey: 'v2',
      content: 'חדש',
      contentReference: 'fixture://phase30-v2',
    });
    expect(version2.id).not.toBe(version.id);
  });
});
