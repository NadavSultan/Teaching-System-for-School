import { CONTRACT_VERSION } from '@teach/contracts';
import { createHash } from 'node:crypto';
import type { AccessContext } from '@teach/domain';
import {
  createAssessment,
  createKnowledgeSource,
  createPersonalWorkspace,
  importCurriculumDraft,
  prisma,
  publishCurriculumVersion,
  recordPedagogicalReview,
  recordUsagePermission,
  registerSourceVersion,
  requestIngestion,
  runIngestion,
  setSourceLifecycle,
  resolveAccessContext,
} from './index.js';

export type GenerationFixture = {
  context: AccessContext;
  workspace: Awaited<ReturnType<typeof createPersonalWorkspace>>;
  curriculumVersionId: string;
  curriculumNodeId: string;
  sourceId: string;
  sourceVersionId: string;
  assessmentId: string;
  ingestionRunId: string;
  knowledgeItemId: string;
  generationRunId: string;
};

export async function createGenerationFixture(
  options: {
    role?: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN';
    review?: 'APPROVED' | 'REJECTED' | null;
    permission?: 'ALLOWED' | 'DENIED' | null;
    lifecycle?: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'DEPRECATED' | 'FAILED' | 'NEEDS_RE_REVIEW';
    permissionValidUntil?: string;
    wrongRequestedNode?: boolean;
    wrongRequestedCurriculum?: boolean;
    multiQuestion?: boolean;
    inactiveItem?: boolean;
    crossTenantPrivate?: boolean;
    visibility?: 'ORGANIZATION_PRIVATE' | 'PLATFORM_SHARED';
    secondTenant?: boolean;
    query?: string;
  } = {},
): Promise<GenerationFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workspace = await createPersonalWorkspace({
    email: `p40-case-${suffix}@example.test`,
    workspaceName: `Phase 40 case ${suffix}`,
  });
  const role = options.role ?? 'TEACHER';
  const organization = await prisma.organization.create({
    data: { name: `Phase 40 school ${suffix}`, workspaceType: 'SCHOOL' },
  });
  const membership = await prisma.membership.create({
    data: { userId: workspace.user.id, organizationId: organization.id, role },
  });
  const schoolWorkspace = { ...workspace, organization, membership };
  const principal = {
    version: CONTRACT_VERSION,
    userId: workspace.user.id,
    email: workspace.user.normalizedEmail,
    provider: 'development',
    providerSubject: `dev:${workspace.user.id}`,
    platformAdmin: false,
  } as const;
  let context = await resolveAccessContext(principal, organization.id);
  const imported = await importCurriculumDraft({
    version: '1.0.0',
    code: `P40CASE${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
    educationSystemCode: 'IL',
    subjectCode: 'HE',
    displayName: 'עברית',
    versionNumber: 1,
    nodes: [{ type: 'GRADE', code: 'G7', label: 'ז', sortOrder: 0 }],
  });
  const node = await prisma.curriculumNode.findFirstOrThrow({
    where: { versionId: imported.version.id },
  });
  let requestedCurriculumVersionId = imported.version.id;
  let requestedNodeIds = [node.id];
  if (options.wrongRequestedNode) {
    const extra = await prisma.curriculumNode.create({
      data: { versionId: imported.version.id, type: 'GRADE', code: 'G8', label: 'ח', sortOrder: 1 },
    });
    requestedNodeIds = [extra.id];
  }
  await publishCurriculumVersion(imported.version.id, workspace.user.id);
  if (options.wrongRequestedCurriculum) {
    const other = await importCurriculumDraft({
      version: '1.0.0',
      code: `P40OTHER${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'עברית אחרת',
      versionNumber: 1,
      nodes: [{ type: 'GRADE', code: 'G9', label: 'ט', sortOrder: 0 }],
    });
    await publishCurriculumVersion(other.version.id, workspace.user.id);
    requestedCurriculumVersionId = other.version.id;
    requestedNodeIds = [
      (await prisma.curriculumNode.findFirstOrThrow({ where: { versionId: other.version.id } })).id,
    ];
  }
  const source = await createKnowledgeSource(context, {
    version: '1.0.0',
    title: 'מקור בדיקה',
    visibility: options.visibility ?? 'ORGANIZATION_PRIVATE',
    origin: 'phase40-acceptance',
  });
  const registered = await registerSourceVersion(context, {
    version: '1.0.0',
    sourceId: source.id,
    idempotencyKey: `version-${suffix}`,
    content: 'שלום עולם. זהו מקור עברי לבדיקת יצירת דף עבודה.',
    contentReference: `fixture://phase40/${suffix}`,
    contentMimeType: 'text/plain',
    curriculumVersionId: imported.version.id,
    curriculumNodeIds: [node.id],
  });
  if (options.review !== null) {
    await recordPedagogicalReview(context, {
      version: '1.0.0',
      sourceVersionId: registered.id,
      decision: options.review ?? 'APPROVED',
      reason: 'case evidence',
    });
  }
  if (options.permission !== null) {
    await recordUsagePermission(context, {
      version: '1.0.0',
      sourceVersionId: registered.id,
      decision: options.permission ?? 'ALLOWED',
      evidenceReference: 'case evidence',
      scope: 'AI_GENERATION',
      validUntil: options.permissionValidUntil,
    });
  }
  if (options.lifecycle === 'DRAFT') {
    // Keep the immutable initial DRAFT lifecycle evidence.
  } else if (options.lifecycle && options.lifecycle !== 'ACTIVE') {
    await setSourceLifecycle(context, registered.id, options.lifecycle, 'case lifecycle');
  } else {
    await setSourceLifecycle(context, registered.id, 'ACTIVE', 'case active');
  }
  const ingestion = await requestIngestion(context, {
    version: '1.0.0',
    sourceVersionId: registered.id,
    pipelineVersion: `plain-v1-${suffix}`,
  });
  const completedIngestion = await runIngestion(ingestion.id);
  let item = await prisma.knowledgeItem.findFirstOrThrow({
    where: { ingestionRunId: completedIngestion.id },
  });
  if (options.inactiveItem) {
    const normalizedText = `${item.normalizedText} פריט לא פעיל`;
    const textHash = createHash('sha256').update(normalizedText, 'utf8').digest('hex');
    item = await prisma.knowledgeItem.create({
      data: {
        sourceVersionId: item.sourceVersionId,
        ingestionRunId: item.ingestionRunId,
        organizationId: item.organizationId,
        visibility: item.visibility,
        locator: `${item.locator}-inactive`,
        normalizedText,
        textHash,
        metadata: {},
        pipelineVersion: item.pipelineVersion,
        parserVersion: item.parserVersion,
        status: 'SUSPENDED',
        curriculumLinks: {
          create: { curriculumVersionId: imported.version.id, curriculumNodeId: node.id },
        },
      },
    });
  }
  if (options.crossTenantPrivate) {
    const otherWorkspace = await createPersonalWorkspace({
      email: `p40-cross-${suffix}@example.test`,
      workspaceName: `Phase 40 cross tenant ${suffix}`,
    });
    const otherOrganization = await prisma.organization.create({
      data: { name: `Phase 40 cross school ${suffix}`, workspaceType: 'SCHOOL' },
    });
    await prisma.membership.create({
      data: {
        userId: otherWorkspace.user.id,
        organizationId: otherOrganization.id,
        role: 'TEACHER',
      },
    });
    context = await resolveAccessContext(
      {
        version: CONTRACT_VERSION,
        userId: otherWorkspace.user.id,
        email: otherWorkspace.user.normalizedEmail,
        provider: 'development',
        providerSubject: `dev:${otherWorkspace.user.id}`,
        platformAdmin: false,
      },
      otherOrganization.id,
    );
  }
  const assessment = await createAssessment(context, {
    version: '1.0.0',
    type: 'WORKSHEET',
    title: 'דף בדיקה',
  });
  const generation = await (
    await import('./generation.js')
  ).requestDraftGeneration(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `draft-${suffix}`,
    curriculumVersionId: requestedCurriculumVersionId,
    curriculumNodeIds: requestedNodeIds,
    scoringMode: 'NONE',
    totalScoreUnits: null,
    query: options.query ?? (options.inactiveItem ? 'פריט לא פעיל' : 'שלום'),
    sections: options.multiQuestion
      ? [
          {
            key: 's1',
            title: 'קטע ראשון',
            order: 0,
            scoreUnits: null,
            questions: [
              {
                key: 'q1',
                order: 0,
                type: 'OPEN',
                difficulty: 'LOW',
                scoreUnits: null,
                instructions: '',
                emphasis: '',
              },
              {
                key: 'q2',
                order: 1,
                type: 'OPEN',
                difficulty: 'LOW',
                scoreUnits: null,
                instructions: '',
                emphasis: '',
              },
            ],
          },
          {
            key: 's2',
            title: 'קטע שני',
            order: 1,
            scoreUnits: null,
            questions: [
              {
                key: 'q3',
                order: 0,
                type: 'OPEN',
                difficulty: 'LOW',
                scoreUnits: null,
                instructions: '',
                emphasis: '',
              },
            ],
          },
        ]
      : [
          {
            key: 's1',
            title: 'קטע',
            order: 0,
            scoreUnits: null,
            questions: [
              {
                key: 'q1',
                order: 0,
                type: 'OPEN',
                difficulty: 'LOW',
                scoreUnits: null,
                instructions: '',
                emphasis: '',
              },
            ],
          },
        ],
  });
  return {
    context,
    workspace: schoolWorkspace,
    curriculumVersionId: imported.version.id,
    curriculumNodeId: node.id,
    sourceId: source.id,
    sourceVersionId: registered.id,
    assessmentId: assessment.id,
    ingestionRunId: completedIngestion.id,
    knowledgeItemId: item.id,
    generationRunId: generation.id,
  };
}
