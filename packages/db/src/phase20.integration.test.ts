import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessment,
  createAssessmentRevision,
  deprecateCurriculumVersion,
  getAssessmentRevision,
  importCurriculumDraft,
  prisma,
  publishCurriculumVersion,
} from './index.js';

describe('Phase 20 curriculum persistence', () => {
  afterAll(() => prisma.$disconnect());

  it('imports a draft atomically, publishes it, and rejects late content writes', async () => {
    const suffix = String(Date.now());
    const result = await importCurriculumDraft({
      version: '1.0.0',
      code: `HEBREW_${suffix}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'עברית',
      versionNumber: 1,
      nodes: [
        {
          type: 'GRADE',
          code: `G7_${suffix}`,
          label: 'ז',
          sortOrder: 0,
          children: [
            {
              type: 'DOMAIN',
              code: `LANG_${suffix}`,
              label: 'לשון',
              sortOrder: 0,
              children: [
                {
                  type: 'TOPIC',
                  code: `TOP_${suffix}`,
                  label: 'נושא',
                  sortOrder: 0,
                  children: [
                    {
                      type: 'SUBTOPIC',
                      code: `SUB_${suffix}`,
                      label: 'תת נושא',
                      sortOrder: 0,
                      children: [
                        {
                          type: 'SKILL',
                          code: `SKILL_${suffix}`,
                          label: 'מיומנות',
                          sortOrder: 0,
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
    await expect(publishCurriculumVersion(result.version.id)).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: result.version.id,
          type: 'GRADE',
          code: `LATE_${suffix}`,
          label: 'מאוחר',
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(deprecateCurriculumVersion(result.version.id)).resolves.toMatchObject({
      status: 'DEPRECATED',
    });
    const existing = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: result.version.id },
    });
    await expect(
      prisma.curriculumNode.update({ where: { id: existing.id }, data: { label: 'changed' } }),
    ).rejects.toThrow();
  });

  it('rejects an invalid parent transition directly in PostgreSQL', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `RAW_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'raw',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    const grade = await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'ז', sortOrder: 0 },
    });
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: version.id,
          parentId: grade.id,
          type: 'SKILL',
          code: `BAD_${suffix}`,
          label: 'bad',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a BUILDING revision at transaction commit', async () => {
    const suffix = String(Date.now());
    const organization = await prisma.organization.create({
      data: { name: `Build ${suffix}`, workspaceType: 'SCHOOL' },
    });
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `BUILD_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'build',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    const assessment = await prisma.assessment.create({
      data: { organizationId: organization.id, type: 'WORKSHEET', title: 'build' },
    });
    await expect(
      prisma.assessmentRevision.create({
        data: {
          assessmentId: assessment.id,
          revisionNumber: 1,
          idempotencyKey: `building-${suffix}`,
          requestFingerprint: '0'.repeat(64),
          curriculumVersionId: version.id,
          scoringMode: 'NONE',
          totalScoreUnits: null,
          state: 'BUILDING',
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces draft-only creation, complete publication, and skill-only difficulties directly in PostgreSQL', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `LIFE_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'lifecycle',
      },
    });
    await expect(
      prisma.curriculumVersion.create({
        data: { curriculumId: curriculum.id, versionNumber: 1, status: 'PUBLISHED' },
      }),
    ).rejects.toThrow('created as DRAFT');
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    const emptyVersion = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 2 },
    });
    const grade = await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'ז', sortOrder: 0 },
    });
    await expect(
      prisma.curriculumSkillDifficulty.create({ data: { nodeId: grade.id, band: 'LOW' } }),
    ).rejects.toThrow('SKILL');
    await expect(
      prisma.curriculumVersion.update({
        where: { id: emptyVersion.id },
        data: { status: 'PUBLISHED' },
      }),
    ).rejects.toThrow('incomplete curriculum hierarchy');
  });

  it('persists a finalized revision graph and returns an idempotent retry', async () => {
    const suffix = String(Date.now());
    const organization = await prisma.organization.create({
      data: { name: `School ${suffix}`, workspaceType: 'SCHOOL' },
    });
    const user = await prisma.user.create({
      data: { normalizedEmail: `phase20-${suffix}@example.test` },
    });
    await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'TEACHER' },
    });
    const context = {
      principal: {
        version: '1.0.0' as const,
        userId: user.id,
        email: `phase20-${suffix}@example.test`,
        provider: 'test',
        providerSubject: user.id,
        platformAdmin: false,
      },
      organizationId: organization.id,
      userStatus: 'ACTIVE' as const,
      membershipStatus: 'ACTIVE' as const,
      role: 'TEACHER' as const,
      organizationStatus: 'ACTIVE' as const,
      workspaceType: 'SCHOOL' as const,
    };
    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `GRAPH_${suffix}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'עברית',
      versionNumber: 1,
      nodes: [{ type: 'GRADE', code: `G_${suffix}`, label: 'ז', sortOrder: 0 }],
    });
    await publishCurriculumVersion(curriculum.version.id);
    const node = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id },
    });
    const assessment = await createAssessment(context, {
      version: '1.0.0',
      type: 'TEST',
      title: 'מבחן',
    });
    const input = {
      version: '1.0.0' as const,
      assessmentId: assessment.id,
      idempotencyKey: `retry-${suffix}`,
      curriculumVersionId: curriculum.version.id,
      scoringMode: 'POINTS' as const,
      totalScoreUnits: 10000,
      curriculumNodeIds: [node.id],
      sections: [
        {
          key: 's1',
          title: 'א',
          order: 0,
          scoreUnits: 10000,
          questions: [
            {
              key: 'q1',
              type: 'SHORT',
              prompt: 'שאלה',
              order: 0,
              scoreUnits: 10000,
              subQuestions: [
                {
                  key: 'sq1',
                  prompt: 'תת שאלה',
                  order: 0,
                  scoreUnits: 10000,
                  answers: [{ key: 'sa1', order: 0, text: 'תשובת משנה' }],
                  rubrics: [{ key: 'sr1', description: 'דיוק', order: 0, scoreUnits: 10000 }],
                },
              ],
              answers: [{ key: 'a1', order: 0, text: 'תשובה' }],
              rubrics: [{ key: 'r1', description: 'דיוק', order: 0, scoreUnits: 10000 }],
            },
          ],
        },
      ],
    };
    const first = await createAssessmentRevision(context, input);
    const retry = await createAssessmentRevision(context, input);
    expect(retry.id).toBe(first.id);
    await expect(
      createAssessmentRevision(context, {
        ...input,
        sections: [
          {
            ...input.sections[0]!,
            questions: [{ ...input.sections[0]!.questions[0]!, prompt: 'שונה' }],
          },
        ],
      }),
    ).rejects.toThrow('Idempotency key');
    const concurrent = await Promise.all([
      createAssessmentRevision(context, { ...input, idempotencyKey: `concurrent-a-${suffix}` }),
      createAssessmentRevision(context, { ...input, idempotencyKey: `concurrent-b-${suffix}` }),
    ]);
    expect(concurrent.map((revision) => revision.revisionNumber).sort()).toEqual([2, 3]);
    const { totalScoreUnits: _explicitTotal, ...defaultedInput } = input;
    expect(
      (
        await createAssessmentRevision(context, {
          ...defaultedInput,
          idempotencyKey: `default-test-total-${suffix}`,
        })
      ).totalScoreUnits,
    ).toBe(10_000);
    const loaded = await getAssessmentRevision(context, assessment.id, 1);
    expect(loaded?.sections[0]?.questions[0]?.answers[0]?.text).toBe('תשובה');
    await expect(
      prisma.assessmentSection.update({
        where: { id: loaded!.sections[0]!.id },
        data: { title: 'changed' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.assessmentQuestion.delete({ where: { id: loaded!.sections[0]!.questions[0]!.id } }),
    ).rejects.toThrow();
    const question = loaded!.sections[0]!.questions[0]!;
    const subQuestion = question.subQuestions[0]!;
    await expect(
      prisma.answer.update({
        where: { id: subQuestion.answers[0]!.id },
        data: { text: 'tampered' },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.rubricCriterion.delete({ where: { id: subQuestion.rubrics[0]!.id } }),
    ).rejects.toThrow('immutable');
    await expect(
      createAssessmentRevision(context, {
        ...input,
        idempotencyKey: `invalid-${suffix}`,
        sections: [{ ...input.sections[0]!, scoreUnits: 9_999 }],
      }),
    ).rejects.toThrow('TOTAL_MISMATCH');
    await deprecateCurriculumVersion(curriculum.version.id);
    expect((await getAssessmentRevision(context, assessment.id, 1))?.id).toBe(first.id);
  });

  it('does not disclose assessment revisions across tenant contexts', async () => {
    const suffix = String(Date.now());
    const [one, two] = (await Promise.all(
      [1, 2].map((n) =>
        prisma.organization.create({
          data: { name: `Tenant ${n}-${suffix}`, workspaceType: 'SCHOOL' },
        }),
      ),
    )) as [
      Awaited<ReturnType<typeof prisma.organization.create>>,
      Awaited<ReturnType<typeof prisma.organization.create>>,
    ];
    const user = await prisma.user.create({
      data: { normalizedEmail: `tenant-${suffix}@example.test` },
    });
    await prisma.membership.create({
      data: { userId: user.id, organizationId: one.id, role: 'TEACHER' },
    });
    const context = (organizationId: string) => ({
      principal: {
        version: '1.0.0' as const,
        userId: user.id,
        email: `tenant-${suffix}@example.test`,
        provider: 'test',
        providerSubject: user.id,
        platformAdmin: false,
      },
      organizationId,
      userStatus: 'ACTIVE' as const,
      membershipStatus: 'ACTIVE' as const,
      role: 'TEACHER' as const,
      organizationStatus: 'ACTIVE' as const,
      workspaceType: 'SCHOOL' as const,
    });
    const assessment = await createAssessment(context(one.id), {
      version: '1.0.0',
      type: 'WORKSHEET',
      title: 'פרטי',
    });
    expect(await getAssessmentRevision(context(two.id), assessment.id, 1)).toBeNull();
    await expect(
      createAssessmentRevision(context(two.id), {
        version: '1.0.0',
        assessmentId: assessment.id,
        idempotencyKey: 'x',
        curriculumVersionId: '00000000-0000-4000-8000-000000000001',
        scoringMode: 'NONE',
        totalScoreUnits: null,
        curriculumNodeIds: [],
        sections: [{ key: 's', title: 's', order: 0, scoreUnits: null, questions: [] }],
      }),
    ).rejects.toThrow('Resource not found');
  });

  it('writes Phase 20 audits without assessment content', async () => {
    const suffix = String(Date.now());
    const organization = await prisma.organization.create({
      data: { name: `Audit ${suffix}`, workspaceType: 'SCHOOL' },
    });
    const user = await prisma.user.create({
      data: { normalizedEmail: `audit20-${suffix}@example.test` },
    });
    const context = {
      principal: {
        version: '1.0.0' as const,
        userId: user.id,
        email: `audit20-${suffix}@example.test`,
        provider: 'test',
        providerSubject: user.id,
        platformAdmin: false,
      },
      organizationId: organization.id,
      userStatus: 'ACTIVE' as const,
      membershipStatus: 'ACTIVE' as const,
      role: 'TEACHER' as const,
      organizationStatus: 'ACTIVE' as const,
      workspaceType: 'SCHOOL' as const,
    };
    const assessment = await createAssessment(context, {
      version: '1.0.0',
      type: 'WORKSHEET',
      title: 'סודי מאוד',
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { targetId: assessment.id, eventType: 'assessment.created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('סודי מאוד');
    expect(JSON.stringify(audit.metadata)).not.toContain('answer');
  });
});
