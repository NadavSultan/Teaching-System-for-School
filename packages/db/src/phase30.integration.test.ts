import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
  getKnowledgeSource,
  getSourceVersion,
  getKnowledgeItem,
  getIngestionStatus,
  resolvePlatformAccessContext,
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
    const initialLifecycleEvents = await prisma.sourceLifecycleEvent.findMany({
      where: { sourceVersionId: version.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(initialLifecycleEvents).toHaveLength(1);
    expect(initialLifecycleEvents[0]).toMatchObject({ fromStatus: null, toStatus: 'DRAFT' });
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
    const queryPlan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<
        Array<{ 'QUERY PLAN': unknown }>
      >`EXPLAIN (FORMAT JSON) SELECT id FROM knowledge_items WHERE search_vector @@ plainto_tsquery('simple', ${'שלום'})`;
    });
    expect(JSON.stringify(queryPlan)).toContain('knowledge_items_search_idx');
    const tieTime = new Date('2099-01-01T00:00:00.000Z');
    await prisma.pedagogicalReview.create({
      data: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'REJECTED',
        reason: 'tie reject',
        evidenceMetadata: {},
        createdAt: tieTime,
      },
    });
    await prisma.pedagogicalReview.create({
      data: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'APPROVED',
        reason: 'tie approve',
        evidenceMetadata: {},
        createdAt: tieTime,
      },
    });
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
    ).toHaveLength(1);
    await prisma.pedagogicalReview.create({
      data: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'REJECTED',
        reason: 'latest tie reject',
        evidenceMetadata: {},
        createdAt: tieTime,
      },
    });
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
    await prisma.pedagogicalReview.create({
      data: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'APPROVED',
        reason: 'restore for permission tie',
        evidenceMetadata: {},
        createdAt: new Date('2100-01-01T00:00:00.000Z'),
      },
    });
    const permissionTieTime = new Date('2100-01-01T00:00:00.000Z');
    await prisma.usagePermission.create({
      data: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'DENIED',
        evidenceReference: 'tie-deny',
        scope: 'AI_GENERATION',
        createdAt: permissionTieTime,
      },
    });
    await prisma.usagePermission.create({
      data: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'ALLOWED',
        evidenceReference: 'tie-allow',
        scope: 'AI_GENERATION',
        createdAt: permissionTieTime,
      },
    });
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
    ).toHaveLength(1);
    await prisma.usagePermission.create({
      data: {
        id: 'ffffffff-ffff-4fff-8fff-fffffffffff0',
        sourceVersionId: version.id,
        reviewerUserId: workspace.user.id,
        decision: 'DENIED',
        evidenceReference: 'latest-tie-deny',
        scope: 'AI_GENERATION',
        createdAt: permissionTieTime,
      },
    });
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
    await expect(
      prisma.sourceVersion.update({
        where: { id: version.id },
        data: { contentHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.sourceVersion.update({ where: { id: version.id }, data: { lifecycle: 'ACTIVE' } }),
    ).rejects.toThrow('source lifecycle is controlled');
    await expect(
      prisma.knowledgeItem.update({
        where: { id: firstItem!.id },
        data: { normalizedText: 'tampered' },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.knowledgeItem.update({ where: { id: firstItem!.id }, data: { status: 'SUSPENDED' } }),
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
    for (const status of ['DEPRECATED', 'FAILED', 'NEEDS_RE_REVIEW'] as const) {
      await setSourceLifecycle(context, version.id, status, `eligibility ${status}`);
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
    }
    const lifecycleHistory = await prisma.sourceLifecycleEvent.findMany({
      where: { sourceVersionId: version.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(lifecycleHistory.at(-1)?.toStatus).toBe('NEEDS_RE_REVIEW');
    expect(
      lifecycleHistory.every(
        (event, index) => index === 0 || event.fromStatus === lifecycleHistory[index - 1]?.toStatus,
      ),
    ).toBe(true);
    const version2 = await registerSourceVersion(context, {
      ...registration,
      idempotencyKey: 'v2',
      content: 'חדש',
      contentReference: 'fixture://phase30-v2',
    });
    expect(version2.id).not.toBe(version.id);
    await Promise.all([
      setSourceLifecycle(context, version2.id, 'ACTIVE', 'concurrent activate'),
      setSourceLifecycle(context, version2.id, 'SUSPENDED', 'concurrent suspend'),
    ]);
    const concurrentHistory = await prisma.sourceLifecycleEvent.findMany({
      where: { sourceVersionId: version2.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(concurrentHistory).toHaveLength(3);
    expect(
      concurrentHistory.every(
        (event, index) =>
          index === 0 || event.fromStatus === concurrentHistory[index - 1]?.toStatus,
      ),
    ).toBe(true);

    const otherSource = await createKnowledgeSource(otherContext, {
      version: '1.0.0',
      title: 'Other same bytes',
      visibility: 'ORGANIZATION_PRIVATE',
      origin: 'test-fixture',
    });
    const otherVersion = await registerSourceVersion(otherContext, {
      ...registration,
      sourceId: otherSource.id,
      idempotencyKey: 'other-v1',
    });
    const otherRun = await requestIngestion(otherContext, {
      version: '1.0.0',
      sourceVersionId: otherVersion.id,
      pipelineVersion: 'plain-v1',
    });
    expect(otherRun.id).not.toBe(pending.id);
    expect((await getIngestionStatus(otherContext, otherRun.id))?.sourceVersionId).toBe(
      otherVersion.id,
    );
    expect(await getKnowledgeSource(context, source.id)).toMatchObject({
      id: source.id,
      visibility: 'ORGANIZATION_PRIVATE',
    });
    expect(await getSourceVersion(otherContext, version.id)).toBeNull();
    expect(await getKnowledgeItem(otherContext, firstItem!.id)).toBeNull();

    await expect(
      prisma.sourceVersionContent.update({
        where: { sourceVersionId: version.id },
        data: { content: 'tampered' },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.sourceVersionContent.delete({ where: { sourceVersionId: version.id } }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.sourceVersion.update({
        where: { id: version.id },
        data: { metadata: { changed: true } },
      }),
    ).rejects.toThrow('immutable');
    const review = await prisma.pedagogicalReview.findFirstOrThrow({
      where: { sourceVersionId: version.id },
    });
    const permission = await prisma.usagePermission.findFirstOrThrow({
      where: { sourceVersionId: version.id },
    });
    const lifecycle = await prisma.sourceLifecycleEvent.findFirstOrThrow({
      where: { sourceVersionId: version.id },
    });
    await expect(
      prisma.pedagogicalReview.update({ where: { id: review.id }, data: { reason: 'tampered' } }),
    ).rejects.toThrow('append-only');
    await expect(prisma.pedagogicalReview.delete({ where: { id: review.id } })).rejects.toThrow(
      'append-only',
    );
    await expect(
      prisma.usagePermission.update({ where: { id: permission.id }, data: { scope: 'tampered' } }),
    ).rejects.toThrow('append-only');
    await expect(prisma.usagePermission.delete({ where: { id: permission.id } })).rejects.toThrow(
      'append-only',
    );
    await expect(
      prisma.sourceLifecycleEvent.update({
        where: { id: lifecycle.id },
        data: { reason: 'tampered' },
      }),
    ).rejects.toThrow('append-only');
    await expect(
      prisma.sourceLifecycleEvent.delete({ where: { id: lifecycle.id } }),
    ).rejects.toThrow('append-only');
    await expect(prisma.knowledgeItem.delete({ where: { id: firstItem!.id } })).rejects.toThrow(
      'immutable',
    );
    const link = await prisma.knowledgeItemCurriculumNodeLink.findFirstOrThrow({
      where: { knowledgeItemId: firstItem!.id },
    });
    const grade = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id, code: 'G7' },
    });
    await prisma.knowledgeItemCurriculumNodeLink.create({
      data: {
        knowledgeItemId: firstItem!.id,
        curriculumVersionId: curriculum.version.id,
        curriculumNodeId: grade.id,
      },
    });
    expect((await getKnowledgeItem(context, firstItem!.id))?.curriculumLineage).toHaveLength(2);
    await expect(
      prisma.knowledgeItemCurriculumNodeLink.delete({ where: { id: link.id } }),
    ).rejects.toThrow('append-only');
    await expect(
      prisma.knowledgeItemCurriculumNodeLink.update({
        where: { id: link.id },
        data: { curriculumNodeId: skill.id },
      }),
    ).rejects.toThrow('append-only');
    const retrievalSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(retrievalSource).toContain('ki.search_vector @@ plainto_tsquery');
    expect(retrievalSource).toContain('source_lifecycle_events');
    expect(retrievalSource).not.toContain('sv.lifecycle');
    expect(retrievalSource).not.toContain("to_tsvector('simple'");
    const finalMigration = readFileSync(
      new URL(
        '../prisma/migrations/20260824003200_phase30_final_remediation/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const previousMigration = readFileSync(
      new URL(
        '../prisma/migrations/20260824003100_phase30_remediation/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(`${retrievalSource}\n${finalMigration}\n${previousMigration}`).not.toContain(
      'phase30.' + 'lifecycle_transition',
    );
    const sourceLink = await prisma.sourceVersionCurriculumNodeLink.findFirstOrThrow({
      where: { sourceVersionId: version.id },
    });
    await expect(
      prisma.sourceVersionCurriculumNodeLink.update({
        where: { id: sourceLink.id },
        data: { curriculumNodeId: skill.id },
      }),
    ).rejects.toThrow('append-only');
    await expect(
      prisma.sourceVersionCurriculumNodeLink.delete({ where: { id: sourceLink.id } }),
    ).rejects.toThrow('append-only');

    await prisma.user.update({ where: { id: workspace.user.id }, data: { platformAdmin: true } });
    const platformContext = await resolvePlatformAccessContext(context.principal);
    expect('organizationId' in platformContext).toBe(false);
    const shared = await createKnowledgeSource(platformContext, {
      version: '1.0.0',
      title: 'Shared',
      visibility: 'PLATFORM_SHARED',
      origin: 'test-fixture',
    });
    const sharedRegistration = {
      ...registration,
      sourceId: shared.id,
      idempotencyKey: 'shared-v1',
      content: 'תוכן משותף',
    };
    const sharedVersion = await registerSourceVersion(platformContext, sharedRegistration);
    const sharedAudit = await prisma.auditEvent.findMany({
      where: { targetId: { in: [shared.id, sharedVersion.id] } },
    });
    expect(sharedAudit.length).toBeGreaterThanOrEqual(2);
    expect(sharedAudit.every((event) => event.organizationId === null)).toBe(true);
    await recordPedagogicalReview(platformContext, {
      version: '1.0.0',
      sourceVersionId: sharedVersion.id,
      decision: 'APPROVED',
      reason: 'platform review',
    });
    await recordUsagePermission(platformContext, {
      version: '1.0.0',
      sourceVersionId: sharedVersion.id,
      decision: 'ALLOWED',
      evidenceReference: 'platform permission',
      scope: 'RETRIEVAL',
    });
    const sharedRun = await requestIngestion(platformContext, {
      version: '1.0.0',
      sourceVersionId: sharedVersion.id,
      pipelineVersion: 'plain-v1',
    });
    await runIngestion(sharedRun.id);
    await setSourceLifecycle(platformContext, sharedVersion.id, 'ACTIVE', 'platform activation');
    const sharedLifecycle = await prisma.sourceLifecycleEvent.findMany({
      where: { sourceVersionId: sharedVersion.id },
    });
    const sharedOutbox = await prisma.outboxEvent.findMany({
      where: { payload: { path: ['ingestionRunId'], equals: sharedRun.id } },
    });
    expect(sharedLifecycle.every((event) => event.organizationId === null)).toBe(true);
    expect(sharedOutbox.every((event) => event.organizationId === null)).toBe(true);
    expect(await getSourceVersion(platformContext, sharedVersion.id)).toMatchObject({
      lifecycle: 'ACTIVE',
    });
    expect(await getIngestionStatus(platformContext, sharedRun.id)).toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(await getKnowledgeSource(otherContext, shared.id)).toMatchObject({ id: shared.id });
    await expect(
      recordPedagogicalReview(otherContext, {
        version: '1.0.0',
        sourceVersionId: sharedVersion.id,
        decision: 'APPROVED',
        reason: 'tenant cannot administer',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      recordUsagePermission(otherContext, {
        version: '1.0.0',
        sourceVersionId: sharedVersion.id,
        decision: 'ALLOWED',
        evidenceReference: 'x',
        scope: 'AI_GENERATION',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      requestIngestion(otherContext, {
        version: '1.0.0',
        sourceVersionId: sharedVersion.id,
        pipelineVersion: 'plain-v1',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    await expect(
      setSourceLifecycle(otherContext, sharedVersion.id, 'SUSPENDED', 'tenant cannot administer'),
    ).rejects.toThrow('Resource not found or unavailable');
    await prisma.user.update({
      where: { id: workspace.user.id },
      data: { platformAdmin: false, status: 'INACTIVE' },
    });
    await expect(
      createKnowledgeSource(context, {
        version: '1.0.0',
        title: 'Inactive',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'x',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
  });
});
