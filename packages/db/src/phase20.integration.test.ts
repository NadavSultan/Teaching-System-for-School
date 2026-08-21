import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessment,
  createAssessmentRevision,
  createPersonalWorkspace,
  deprecateCurriculumVersion,
  getAssessmentRevision,
  importCurriculumDraft,
  prisma,
  publishCurriculumVersion,
  resolveAccessContext,
} from './index.js';

async function persistedAssessmentContext(userId: string, organizationId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return resolveAccessContext(
    {
      version: '1.0.0',
      userId,
      email: user.normalizedEmail,
      provider: 'test',
      providerSubject: userId,
      platformAdmin: user.platformAdmin,
    },
    organizationId,
  );
}

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
    await expect(
      prisma.curriculumVersion.update({
        where: { id: result.version.id },
        data: { humanLabel: 'tampered' },
      }),
    ).rejects.toThrow('immutable');
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
    await expect(
      prisma.assessmentRevision.create({
        data: {
          assessmentId: assessment.id,
          revisionNumber: 2,
          idempotencyKey: `direct-final-${suffix}`,
          requestFingerprint: '1'.repeat(64),
          curriculumVersionId: version.id,
          scoringMode: 'NONE',
          totalScoreUnits: null,
          state: 'FINALIZED',
        },
      }),
    ).rejects.toThrow('created as BUILDING');
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
    const defaultedInput = { ...input, totalScoreUnits: undefined };
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
    // These are deliberately direct ORM writes.  They permanently cover the
    // OLD-owner bypass: a finalized child must not be movable to another tree.
    const other = await getAssessmentRevision(
      context,
      assessment.id,
      concurrent[0]!.revisionNumber,
    );
    const otherQuestion = other!.sections[0]!.questions[0]!;
    const otherSubQuestion = otherQuestion.subQuestions[0]!;
    await expect(
      prisma.assessmentSection.update({
        where: { id: loaded!.sections[0]!.id },
        data: { revisionId: other!.id },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.assessmentQuestion.update({
        where: { id: question.id },
        data: { sectionId: other!.sections[0]!.id },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.assessmentSubQuestion.update({
        where: { id: subQuestion.id },
        data: { questionId: otherQuestion.id },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.answer.update({
        where: { id: subQuestion.answers[0]!.id },
        data: { subQuestionId: otherSubQuestion.id, questionId: null },
      }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.rubricCriterion.update({
        where: { id: subQuestion.rubrics[0]!.id },
        data: { subQuestionId: otherSubQuestion.id, questionId: null },
      }),
    ).rejects.toThrow('immutable');
    const link = await prisma.assessmentRevisionNodeLink.findFirstOrThrow({
      where: { revisionId: loaded!.id },
    });
    await expect(
      prisma.$executeRaw`UPDATE assessment_revision_node_links SET role = 'tampered' WHERE id = ${link.id}::uuid`,
    ).rejects.toThrow();
    expect((await getAssessmentRevision(context, assessment.id, 1))?.sections[0]?.id).toBe(
      loaded!.sections[0]!.id,
    );
    // Reproduce the architect's counterexample precisely: the destination is
    // a valid BUILDING graph and the mutation changes the real parent columns.
    await prisma.$transaction(async (tx) => {
      const building = await tx.assessmentRevision.create({
        data: {
          assessmentId: assessment.id,
          revisionNumber: 99,
          idempotencyKey: `building-move-${suffix}`,
          requestFingerprint: '9'.repeat(64),
          curriculumVersionId: curriculum.version.id,
          scoringMode: 'POINTS',
          totalScoreUnits: 10000,
        },
      });
      await tx.assessmentRevisionNodeLink.create({
        data: { revisionId: building.id, curriculumNodeId: node.id },
      });
      const buildingSection = await tx.assessmentSection.create({
        data: {
          revisionId: building.id,
          key: 'building-section',
          title: 'building',
          order: 0,
          scoreUnits: 10000,
        },
      });
      const buildingQuestion = await tx.assessmentQuestion.create({
        data: {
          sectionId: buildingSection.id,
          key: 'building-question',
          type: 'SHORT',
          prompt: 'building',
          order: 0,
          scoreUnits: 10000,
        },
      });
      const buildingSubQuestion = await tx.assessmentSubQuestion.create({
        data: {
          questionId: buildingQuestion.id,
          key: 'building-subquestion',
          prompt: 'building',
          order: 0,
          scoreUnits: 10000,
        },
      });
      await tx.answer.create({
        data: {
          questionId: buildingQuestion.id,
          answerData: {},
          key: 'building-answer',
          order: 0,
          text: 'building',
        },
      });
      await tx.answer.create({
        data: {
          subQuestionId: buildingSubQuestion.id,
          answerData: {},
          key: 'building-subanswer',
          order: 0,
          text: 'building',
        },
      });
      await tx.rubricCriterion.create({
        data: {
          questionId: buildingQuestion.id,
          key: 'building-rubric',
          description: 'building',
          order: 0,
          scoreUnits: 10000,
        },
      });
      await tx.rubricCriterion.create({
        data: {
          subQuestionId: buildingSubQuestion.id,
          key: 'building-subrubric',
          description: 'building',
          order: 0,
          scoreUnits: 10000,
        },
      });
      const rejectedMove = async (savepoint: string, operation: () => Promise<unknown>) => {
        await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
        await expect(operation()).rejects.toThrow('immutable');
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      };
      await rejectedMove('move_link', () =>
        tx.assessmentRevisionNodeLink.update({
          where: { id: link.id },
          data: { revisionId: building.id },
        }),
      );
      await rejectedMove('move_section', () =>
        tx.assessmentSection.update({
          where: { id: loaded!.sections[0]!.id },
          data: { revisionId: building.id },
        }),
      );
      await rejectedMove('move_question', () =>
        tx.assessmentQuestion.update({
          where: { id: question.id },
          data: { sectionId: buildingSection.id },
        }),
      );
      await rejectedMove('move_subquestion', () =>
        tx.assessmentSubQuestion.update({
          where: { id: subQuestion.id },
          data: { questionId: buildingQuestion.id },
        }),
      );
      await rejectedMove('move_question_answer', () =>
        tx.answer.update({
          where: { id: question.answers[0]!.id },
          data: { questionId: buildingQuestion.id, subQuestionId: null },
        }),
      );
      await rejectedMove('move_subquestion_answer', () =>
        tx.answer.update({
          where: { id: subQuestion.answers[0]!.id },
          data: { questionId: null, subQuestionId: buildingSubQuestion.id },
        }),
      );
      await rejectedMove('move_question_rubric', () =>
        tx.rubricCriterion.update({
          where: { id: question.rubrics[0]!.id },
          data: { questionId: buildingQuestion.id, subQuestionId: null },
        }),
      );
      await rejectedMove('move_subquestion_rubric', () =>
        tx.rubricCriterion.update({
          where: { id: subQuestion.rubrics[0]!.id },
          data: { questionId: null, subQuestionId: buildingSubQuestion.id },
        }),
      );
      await tx.assessmentRevision.update({
        where: { id: building.id },
        data: { state: 'FINALIZED' },
      });
    });
    expect((await getAssessmentRevision(context, assessment.id, 1))?.sections[0]?.id).toBe(
      loaded!.sections[0]!.id,
    );
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

  it('enforces every direct PostgreSQL curriculum parent, sibling, and lifecycle boundary', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `MATRIX_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'matrix',
      },
    });
    const [one, two] = await Promise.all([
      prisma.curriculumVersion.create({ data: { curriculumId: curriculum.id, versionNumber: 1 } }),
      prisma.curriculumVersion.create({ data: { curriculumId: curriculum.id, versionNumber: 2 } }),
    ]);
    const grade = await prisma.curriculumNode.create({
      data: { versionId: one.id, type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 },
    });
    const domain = await prisma.curriculumNode.create({
      data: {
        versionId: one.id,
        parentId: grade.id,
        type: 'DOMAIN',
        code: `D_${suffix}`,
        label: 'd',
        sortOrder: 0,
      },
    });
    const topic = await prisma.curriculumNode.create({
      data: {
        versionId: one.id,
        parentId: domain.id,
        type: 'TOPIC',
        code: `T_${suffix}`,
        label: 't',
        sortOrder: 0,
      },
    });
    const subtopic = await prisma.curriculumNode.create({
      data: {
        versionId: one.id,
        parentId: topic.id,
        type: 'SUBTOPIC',
        code: `S_${suffix}`,
        label: 's',
        sortOrder: 0,
      },
    });
    const skill = await prisma.curriculumNode.create({
      data: {
        versionId: one.id,
        parentId: subtopic.id,
        type: 'SKILL',
        code: `K_${suffix}`,
        label: 'k',
        sortOrder: 0,
      },
    });
    await prisma.curriculumSkillDifficulty.create({ data: { nodeId: skill.id, band: 'LOW' } });
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: one.id,
          parentId: skill.id,
          type: 'GRADE',
          code: `AFTER_${suffix}`,
          label: 'bad',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: one.id,
          parentId: grade.id,
          type: 'TOPIC',
          code: `BAD_${suffix}`,
          label: 'bad',
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow('invalid curriculum parent type');
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: two.id,
          parentId: grade.id,
          type: 'DOMAIN',
          code: `CROSS_${suffix}`,
          label: 'cross',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow('same version');
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: one.id,
          type: 'GRADE',
          code: `G_${suffix}`,
          label: 'duplicate',
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: one.id,
          type: 'GRADE',
          code: `ROOT_${suffix}`,
          label: 'duplicate',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: one.id,
          parentId: grade.id,
          type: 'DOMAIN',
          code: `D2_${suffix}`,
          label: 'duplicate',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.curriculumSkillDifficulty.create({ data: { nodeId: skill.id, band: 'LOW' } }),
    ).rejects.toThrow();
    await expect(
      prisma.curriculumVersion.update({ where: { id: one.id }, data: { status: 'PUBLISHED' } }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    await expect(prisma.curriculumNode.delete({ where: { id: skill.id } })).rejects.toThrow(
      'immutable',
    );
    await expect(
      prisma.curriculumSkillDifficulty.deleteMany({ where: { nodeId: skill.id } }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.curriculumVersion.update({ where: { id: one.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow('immutable');
    await expect(
      prisma.curriculumVersion.update({ where: { id: one.id }, data: { status: 'DEPRECATED' } }),
    ).resolves.toMatchObject({ status: 'DEPRECATED' });
  });

  it('rejects each invalid Curriculum parent transition, sibling collision, and cycle directly', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `PARENT_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'parent matrix',
      },
    });
    const [version, otherVersion] = await Promise.all([
      prisma.curriculumVersion.create({ data: { curriculumId: curriculum.id, versionNumber: 1 } }),
      prisma.curriculumVersion.create({ data: { curriculumId: curriculum.id, versionNumber: 2 } }),
    ]);
    const grade = await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 },
    });
    const domain = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: grade.id,
        type: 'DOMAIN',
        code: `D_${suffix}`,
        label: 'd',
        sortOrder: 0,
      },
    });
    const topic = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: domain.id,
        type: 'TOPIC',
        code: `T_${suffix}`,
        label: 't',
        sortOrder: 0,
      },
    });
    const subtopic = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: topic.id,
        type: 'SUBTOPIC',
        code: `S_${suffix}`,
        label: 's',
        sortOrder: 0,
      },
    });
    const skill = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: subtopic.id,
        type: 'SKILL',
        code: `K_${suffix}`,
        label: 'k',
        sortOrder: 0,
      },
    });
    const invalidTransitions = [
      { parentId: domain.id, type: 'DOMAIN' as const, code: 'DOMAIN_AFTER_DOMAIN' },
      { parentId: grade.id, type: 'TOPIC' as const, code: 'TOPIC_AFTER_GRADE' },
      { parentId: domain.id, type: 'SUBTOPIC' as const, code: 'SUBTOPIC_AFTER_DOMAIN' },
      { parentId: topic.id, type: 'SKILL' as const, code: 'SKILL_AFTER_TOPIC' },
      { parentId: skill.id, type: 'DOMAIN' as const, code: 'AFTER_TERMINAL_SKILL' },
    ];
    for (const [order, invalid] of invalidTransitions.entries())
      await expect(
        prisma.curriculumNode.create({
          data: {
            versionId: version.id,
            parentId: invalid.parentId,
            type: invalid.type,
            code: `${invalid.code}_${suffix}`,
            label: 'invalid',
            sortOrder: order + 10,
          },
        }),
      ).rejects.toThrow('invalid curriculum parent type');
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: version.id,
          parentId: grade.id,
          type: 'GRADE',
          code: `ROOT_CHILD_${suffix}`,
          label: 'invalid',
          sortOrder: 20,
        },
      }),
    ).rejects.toThrow('GRADE must be root');
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: version.id,
          type: 'DOMAIN',
          code: `DOMAIN_ROOT_${suffix}`,
          label: 'invalid',
          sortOrder: 20,
        },
      }),
    ).rejects.toThrow('only GRADE may be root');
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: otherVersion.id,
          parentId: grade.id,
          type: 'DOMAIN',
          code: `CROSS_${suffix}`,
          label: 'invalid',
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow('curriculum parent must use same version');
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: version.id,
          parentId: grade.id,
          type: 'DOMAIN',
          code: domain.code,
          label: 'duplicate',
          sortOrder: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: version.id,
          parentId: grade.id,
          type: 'DOMAIN',
          code: `DUP_ORDER_${suffix}`,
          label: 'duplicate',
          sortOrder: domain.sortOrder,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    for (const nodeId of [grade.id, domain.id, topic.id, subtopic.id])
      await expect(
        prisma.curriculumSkillDifficulty.create({ data: { nodeId, band: 'LOW' } }),
      ).rejects.toThrow('difficulty applies only to SKILL');
    await expect(
      prisma.curriculumNode.update({ where: { id: grade.id }, data: { parentId: skill.id } }),
    ).rejects.toThrow('GRADE must be root');
  });

  it('enforces Curriculum publication immutability and every lifecycle transition directly', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `LIFECYCLE_MATRIX_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'lifecycle matrix',
      },
    });
    await expect(
      prisma.curriculumVersion.create({
        data: { curriculumId: curriculum.id, versionNumber: 1, status: 'PUBLISHED' },
      }),
    ).rejects.toThrow('curriculum versions must be created as DRAFT');
    const empty = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    await expect(
      prisma.curriculumVersion.update({ where: { id: empty.id }, data: { status: 'PUBLISHED' } }),
    ).rejects.toThrow('cannot publish incomplete curriculum hierarchy');
    await expect(
      prisma.curriculumVersion.update({ where: { id: empty.id }, data: { status: 'DEPRECATED' } }),
    ).rejects.toThrow('invalid curriculum lifecycle transition');
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 2, humanLabel: 'v2' },
    });
    const grade = await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 },
    });
    const domain = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: grade.id,
        type: 'DOMAIN',
        code: `D_${suffix}`,
        label: 'd',
        sortOrder: 0,
      },
    });
    const topic = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: domain.id,
        type: 'TOPIC',
        code: `T_${suffix}`,
        label: 't',
        sortOrder: 0,
      },
    });
    const subtopic = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: topic.id,
        type: 'SUBTOPIC',
        code: `S_${suffix}`,
        label: 's',
        sortOrder: 0,
      },
    });
    const skill = await prisma.curriculumNode.create({
      data: {
        versionId: version.id,
        parentId: subtopic.id,
        type: 'SKILL',
        code: `K_${suffix}`,
        label: 'k',
        sortOrder: 0,
      },
    });
    await expect(
      prisma.curriculumVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } }),
    ).rejects.toThrow('cannot publish incomplete curriculum hierarchy');
    const difficulty = await prisma.curriculumSkillDifficulty.create({
      data: { nodeId: skill.id, band: 'LOW' },
    });
    await expect(
      prisma.curriculumVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    await expect(
      prisma.curriculumNode.create({
        data: {
          versionId: version.id,
          type: 'GRADE',
          code: `LATE_${suffix}`,
          label: 'late',
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow('curriculum content is immutable after publication');
    await expect(
      prisma.curriculumNode.update({ where: { id: grade.id }, data: { label: 'changed' } }),
    ).rejects.toThrow('curriculum content is immutable after publication');
    await expect(
      prisma.curriculumNode.update({ where: { id: domain.id }, data: { parentId: topic.id } }),
    ).rejects.toThrow('curriculum content is immutable after publication');
    await expect(prisma.curriculumNode.delete({ where: { id: skill.id } })).rejects.toThrow(
      'curriculum content is immutable after publication',
    );
    await expect(
      prisma.curriculumSkillDifficulty.create({ data: { nodeId: skill.id, band: 'MEDIUM' } }),
    ).rejects.toThrow('curriculum content is immutable after publication');
    await expect(
      prisma.curriculumSkillDifficulty.update({
        where: { id: difficulty.id },
        data: { band: 'HIGH' },
      }),
    ).rejects.toThrow('curriculum content is immutable after publication');
    await expect(
      prisma.curriculumSkillDifficulty.delete({ where: { id: difficulty.id } }),
    ).rejects.toThrow('curriculum content is immutable after publication');
    await expect(
      prisma.curriculumVersion.update({
        where: { id: version.id },
        data: { humanLabel: 'tampered' },
      }),
    ).rejects.toThrow('published curriculum version is immutable');
    await expect(
      prisma.curriculumVersion.update({ where: { id: version.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow('published curriculum version is immutable');
    await expect(
      prisma.curriculumVersion.update({
        where: { id: version.id },
        data: { status: 'DEPRECATED' },
      }),
    ).resolves.toMatchObject({ status: 'DEPRECATED' });
    await expect(
      prisma.curriculumVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } }),
    ).rejects.toThrow('published curriculum version is immutable');
  });

  it('resolves persisted Assessment authorization and tenant isolation for every operation', async () => {
    const suffix = String(Date.now());
    const [a, b] = await Promise.all([
      prisma.organization.create({ data: { name: `A-${suffix}`, workspaceType: 'SCHOOL' } }),
      prisma.organization.create({ data: { name: `B-${suffix}`, workspaceType: 'SCHOOL' } }),
    ]);
    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `AUTH_${suffix}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'auth',
      versionNumber: 1,
      nodes: [{ type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 }],
    });
    await publishCurriculumVersion(curriculum.version.id);
    const revisionInput = (assessmentId: string, idempotencyKey: string) => ({
      version: '1.0.0' as const,
      assessmentId,
      idempotencyKey,
      curriculumVersionId: curriculum.version.id,
      scoringMode: 'NONE' as const,
      totalScoreUnits: null,
      curriculumNodeIds: [],
      sections: [{ key: 's', title: 's', order: 0, scoreUnits: null, questions: [] }],
    });
    const users = await Promise.all(
      ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'].map((role) =>
        prisma.user.create({ data: { normalizedEmail: `${role}-${suffix}@example.test` } }),
      ),
    );
    for (const role of ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'] as const) {
      const user = users[['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'].indexOf(role)]!;
      await prisma.membership.create({ data: { userId: user.id, organizationId: a.id, role } });
      const context = await persistedAssessmentContext(user.id, a.id);
      const assessment = await createAssessment(context, {
        version: '1.0.0',
        type: 'WORKSHEET',
        title: role,
      });
      await expect(
        createAssessmentRevision(context, revisionInput(assessment.id, `${role}-${suffix}`)),
      ).resolves.toMatchObject({ state: 'FINALIZED' });
      await expect(getAssessmentRevision(context, assessment.id, 1)).resolves.toMatchObject({
        assessmentId: assessment.id,
      });
    }
    const userB = await prisma.user.create({
      data: { normalizedEmail: `tenant-b-${suffix}@example.test` },
    });
    await prisma.membership.create({
      data: { userId: userB.id, organizationId: b.id, role: 'TEACHER' },
    });
    const contextA = await persistedAssessmentContext(users[0]!.id, a.id);
    const contextB = await persistedAssessmentContext(userB.id, b.id);
    const assessmentA = await createAssessment(contextA, {
      version: '1.0.0',
      type: 'WORKSHEET',
      title: 'tenant-a',
    });
    const assessmentB = await createAssessment(contextB, {
      version: '1.0.0',
      type: 'WORKSHEET',
      title: 'tenant-b',
    });
    await createAssessmentRevision(contextA, revisionInput(assessmentA.id, `tenant-a-${suffix}`));
    await createAssessmentRevision(contextB, revisionInput(assessmentB.id, `tenant-b-${suffix}`));
    expect(await getAssessmentRevision(contextA, assessmentB.id, 1)).toBeNull();
    expect(await getAssessmentRevision(contextB, assessmentA.id, 1)).toBeNull();
    expect(
      await getAssessmentRevision(contextA, '00000000-0000-4000-8000-000000000001', 1),
    ).toBeNull();
    const foreignA = await createAssessmentRevision(
      contextA,
      revisionInput(assessmentB.id, `foreign-a-${suffix}`),
    ).catch((error: unknown) => error);
    const missingA = await createAssessmentRevision(
      contextA,
      revisionInput('00000000-0000-4000-8000-000000000001', `missing-a-${suffix}`),
    ).catch((error: unknown) => error);
    const foreignB = await createAssessmentRevision(
      contextB,
      revisionInput(assessmentA.id, `foreign-b-${suffix}`),
    ).catch((error: unknown) => error);
    const missingB = await createAssessmentRevision(
      contextB,
      revisionInput('00000000-0000-4000-8000-000000000002', `missing-b-${suffix}`),
    ).catch((error: unknown) => error);
    expect((foreignA as Error).message).toBe((missingA as Error).message);
    expect((foreignB as Error).message).toBe((missingB as Error).message);
    expect((foreignA as Error).message).toBe('Resource not found or unavailable');
    await expect(persistedAssessmentContext(users[0]!.id, b.id)).rejects.toThrow(
      'Resource not found or unavailable',
    );
    await expect(persistedAssessmentContext(userB.id, a.id)).rejects.toThrow(
      'Resource not found or unavailable',
    );
    const inactiveUser = await prisma.user.create({
      data: { normalizedEmail: `inactive-user-${suffix}@example.test`, status: 'INACTIVE' },
    });
    const inactiveMembershipUser = await prisma.user.create({
      data: { normalizedEmail: `inactive-member-${suffix}@example.test` },
    });
    const inactiveOrganization = await prisma.organization.create({
      data: { name: `Inactive-${suffix}`, workspaceType: 'SCHOOL', status: 'INACTIVE' },
    });
    await prisma.membership.create({
      data: { userId: inactiveUser.id, organizationId: a.id, role: 'TEACHER' },
    });
    await prisma.membership.create({
      data: {
        userId: inactiveMembershipUser.id,
        organizationId: a.id,
        role: 'TEACHER',
        status: 'INACTIVE',
      },
    });
    const inactiveOrganizationUser = await prisma.user.create({
      data: { normalizedEmail: `inactive-org-${suffix}@example.test` },
    });
    await prisma.membership.create({
      data: {
        userId: inactiveOrganizationUser.id,
        organizationId: inactiveOrganization.id,
        role: 'TEACHER',
      },
    });
    for (const context of [
      await persistedAssessmentContext(inactiveUser.id, a.id),
      await persistedAssessmentContext(inactiveMembershipUser.id, a.id),
      await persistedAssessmentContext(inactiveOrganizationUser.id, inactiveOrganization.id),
    ])
      await expect(
        createAssessment(context, {
          version: '1.0.0',
          type: 'WORKSHEET',
          title: 'denied',
        }),
      ).rejects.toThrow('Resource not found or unavailable');
    const platformAdmin = await prisma.user.create({
      data: {
        normalizedEmail: `platform-${suffix}@example.test`,
        platformAdmin: true,
      },
    });
    await prisma.membership.create({
      data: { userId: platformAdmin.id, organizationId: a.id, role: 'PLATFORM_ADMIN' },
    });
    await expect(
      createAssessment(await persistedAssessmentContext(platformAdmin.id, a.id), {
        version: '1.0.0',
        type: 'WORKSHEET',
        title: 'denied',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
    const missingMembershipUser = await prisma.user.create({
      data: { normalizedEmail: `missing-membership-${suffix}@example.test` },
    });
    await expect(persistedAssessmentContext(missingMembershipUser.id, a.id)).rejects.toThrow(
      'Resource not found or unavailable',
    );
    const personal = await createPersonalWorkspace({
      email: `personal-auth-${suffix}@example.test`,
      workspaceName: 'personal',
    });
    const personalContext = await persistedAssessmentContext(
      personal.user.id,
      personal.organization.id,
    );
    await expect(
      createAssessment(personalContext, {
        version: '1.0.0',
        type: 'WORKSHEET',
        title: 'personal-only',
      }),
    ).resolves.toMatchObject({ organizationId: personal.organization.id });
    await expect(persistedAssessmentContext(personal.user.id, a.id)).rejects.toThrow(
      'Resource not found or unavailable',
    );
  });

  it('enforces direct NONE scoring nullability at finalization', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `SCORE_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'score',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 },
    });
    await prisma.curriculumVersion.update({
      where: { id: version.id },
      data: { status: 'PUBLISHED' },
    });
    const finalize = async (
      field:
        | 'revision'
        | 'section'
        | 'question'
        | 'subquestion'
        | 'questionRubric'
        | 'subquestionRubric'
        | 'valid',
    ) =>
      prisma.$transaction(async (tx) => {
        const assessment = await tx.assessment.create({
          data: {
            organizationId: (
              await tx.organization.create({
                data: { name: `${field}-${suffix}`, workspaceType: 'SCHOOL' },
              })
            ).id,
            type: 'WORKSHEET',
            title: field,
          },
        });
        const revision = await tx.assessmentRevision.create({
          data: {
            assessmentId: assessment.id,
            revisionNumber: 1,
            idempotencyKey: `${field}-${suffix}`,
            requestFingerprint: '1'.repeat(64),
            curriculumVersionId: version.id,
            scoringMode: 'NONE',
            totalScoreUnits: field === 'revision' ? 1 : null,
          },
        });
        const section = await tx.assessmentSection.create({
          data: {
            revisionId: revision.id,
            key: 's',
            title: 's',
            order: 0,
            scoreUnits: field === 'section' ? 1 : null,
          },
        });
        const question = await tx.assessmentQuestion.create({
          data: {
            sectionId: section.id,
            key: 'q',
            type: 'SHORT',
            prompt: 'q',
            order: 0,
            scoreUnits: field === 'question' ? 1 : null,
          },
        });
        const subquestion = await tx.assessmentSubQuestion.create({
          data: {
            questionId: question.id,
            key: 'sq',
            prompt: 'sq',
            order: 0,
            scoreUnits: field === 'subquestion' ? 1 : null,
          },
        });
        await tx.rubricCriterion.create({
          data: {
            questionId: question.id,
            key: 'qr',
            description: 'qr',
            order: 0,
            scoreUnits: field === 'questionRubric' ? 1 : null,
          },
        });
        await tx.rubricCriterion.create({
          data: {
            subQuestionId: subquestion.id,
            key: 'sqr',
            description: 'sqr',
            order: 0,
            scoreUnits: field === 'subquestionRubric' ? 1 : null,
          },
        });
        return tx.assessmentRevision.update({
          where: { id: revision.id },
          data: { state: 'FINALIZED' },
        });
      });
    await expect(finalize('revision')).rejects.toThrow('NONE scoring requires null scores');
    await expect(finalize('section')).rejects.toThrow('NONE scoring requires null scores');
    await expect(finalize('question')).rejects.toThrow('NONE scoring requires null scores');
    await expect(finalize('subquestion')).rejects.toThrow('NONE scoring requires null scores');
    await expect(finalize('questionRubric')).rejects.toThrow('NONE scoring requires null scores');
    await expect(finalize('subquestionRubric')).rejects.toThrow(
      'NONE scoring requires null scores',
    );
    expect(
      await prisma.assessment.count({
        where: {
          title: {
            in: [
              'revision',
              'section',
              'question',
              'subquestion',
              'questionRubric',
              'subquestionRubric',
            ],
          },
        },
      }),
    ).toBe(0);
    await expect(finalize('valid')).resolves.toMatchObject({ state: 'FINALIZED' });
  });

  it('rejects every BUILDING-to-FINALIZED NEW-owner reparent without changing either graph', async () => {
    const suffix = String(Date.now());
    const organization = await prisma.organization.create({
      data: { name: `new-owner-${suffix}`, workspaceType: 'SCHOOL' },
    });
    const curriculum = await importCurriculumDraft({
      version: '1.0.0',
      code: `NEW_OWNER_${suffix}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'new owner',
      versionNumber: 1,
      nodes: [{ type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 }],
    });
    await publishCurriculumVersion(curriculum.version.id);
    const node = await prisma.curriculumNode.findFirstOrThrow({
      where: { versionId: curriculum.version.id },
    });
    const assessment = await prisma.assessment.create({
      data: { organizationId: organization.id, type: 'WORKSHEET', title: 'new owner' },
    });
    const owners = await prisma.$transaction(async (tx) => {
      const makeGraph = async (revisionNumber: number, key: string) => {
        const revision = await tx.assessmentRevision.create({
          data: {
            assessmentId: assessment.id,
            revisionNumber,
            idempotencyKey: `${key}-${suffix}`,
            requestFingerprint: String(revisionNumber).repeat(64),
            curriculumVersionId: curriculum.version.id,
            scoringMode: 'NONE',
            totalScoreUnits: null,
          },
        });
        const link = await tx.assessmentRevisionNodeLink.create({
          data: { revisionId: revision.id, curriculumNodeId: node.id },
        });
        const section = await tx.assessmentSection.create({
          data: {
            revisionId: revision.id,
            key: `${key}-s`,
            title: key,
            order: 0,
            scoreUnits: null,
          },
        });
        const question = await tx.assessmentQuestion.create({
          data: {
            sectionId: section.id,
            key: `${key}-q`,
            type: 'SHORT',
            prompt: key,
            order: 0,
            scoreUnits: null,
          },
        });
        const subQuestion = await tx.assessmentSubQuestion.create({
          data: {
            questionId: question.id,
            key: `${key}-sq`,
            prompt: key,
            order: 0,
            scoreUnits: null,
          },
        });
        const questionAnswer = await tx.answer.create({
          data: { questionId: question.id, answerData: {}, key: `${key}-qa`, order: 0, text: key },
        });
        const subQuestionAnswer = await tx.answer.create({
          data: {
            subQuestionId: subQuestion.id,
            answerData: {},
            key: `${key}-sqa`,
            order: 0,
            text: key,
          },
        });
        const questionRubric = await tx.rubricCriterion.create({
          data: {
            questionId: question.id,
            key: `${key}-qr`,
            description: key,
            order: 0,
            scoreUnits: null,
          },
        });
        const subQuestionRubric = await tx.rubricCriterion.create({
          data: {
            subQuestionId: subQuestion.id,
            key: `${key}-sqr`,
            description: key,
            order: 0,
            scoreUnits: null,
          },
        });
        return {
          revision,
          link,
          section,
          question,
          subQuestion,
          questionAnswer,
          subQuestionAnswer,
          questionRubric,
          subQuestionRubric,
        };
      };
      const finalized = await makeGraph(1, 'finalized');
      await tx.assessmentRevision.update({
        where: { id: finalized.revision.id },
        data: { state: 'FINALIZED' },
      });
      const building = await makeGraph(2, 'building');
      const rejectedMove = async (savepoint: string, operation: () => Promise<unknown>) => {
        await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
        await expect(operation()).rejects.toThrow('finalized revision content is immutable');
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      };
      await rejectedMove('new_link', () =>
        tx.assessmentRevisionNodeLink.update({
          where: { id: building.link.id },
          data: { revisionId: finalized.revision.id },
        }),
      );
      await rejectedMove('new_section', () =>
        tx.assessmentSection.update({
          where: { id: building.section.id },
          data: { revisionId: finalized.revision.id },
        }),
      );
      await rejectedMove('new_question', () =>
        tx.assessmentQuestion.update({
          where: { id: building.question.id },
          data: { sectionId: finalized.section.id },
        }),
      );
      await rejectedMove('new_subquestion', () =>
        tx.assessmentSubQuestion.update({
          where: { id: building.subQuestion.id },
          data: { questionId: finalized.question.id },
        }),
      );
      await rejectedMove('new_question_answer', () =>
        tx.answer.update({
          where: { id: building.questionAnswer.id },
          data: { questionId: finalized.question.id, subQuestionId: null },
        }),
      );
      await rejectedMove('new_subquestion_answer', () =>
        tx.answer.update({
          where: { id: building.subQuestionAnswer.id },
          data: { questionId: null, subQuestionId: finalized.subQuestion.id },
        }),
      );
      await rejectedMove('new_question_rubric', () =>
        tx.rubricCriterion.update({
          where: { id: building.questionRubric.id },
          data: { questionId: finalized.question.id, subQuestionId: null },
        }),
      );
      await rejectedMove('new_subquestion_rubric', () =>
        tx.rubricCriterion.update({
          where: { id: building.subQuestionRubric.id },
          data: { questionId: null, subQuestionId: finalized.subQuestion.id },
        }),
      );
      await tx.assessmentRevision.update({
        where: { id: building.revision.id },
        data: { state: 'FINALIZED' },
      });
      return { finalized, building };
    });
    expect(
      (
        await prisma.assessmentRevisionNodeLink.findUniqueOrThrow({
          where: { id: owners.building.link.id },
        })
      ).revisionId,
    ).toBe(owners.building.revision.id);
    expect(
      (
        await prisma.assessmentSection.findUniqueOrThrow({
          where: { id: owners.building.section.id },
        })
      ).revisionId,
    ).toBe(owners.building.revision.id);
    expect(
      (
        await prisma.assessmentQuestion.findUniqueOrThrow({
          where: { id: owners.building.question.id },
        })
      ).sectionId,
    ).toBe(owners.building.section.id);
    expect(
      (
        await prisma.assessmentSubQuestion.findUniqueOrThrow({
          where: { id: owners.building.subQuestion.id },
        })
      ).questionId,
    ).toBe(owners.building.question.id);
    expect(
      (await prisma.answer.findUniqueOrThrow({ where: { id: owners.building.questionAnswer.id } }))
        .questionId,
    ).toBe(owners.building.question.id);
    expect(
      (
        await prisma.answer.findUniqueOrThrow({
          where: { id: owners.building.subQuestionAnswer.id },
        })
      ).subQuestionId,
    ).toBe(owners.building.subQuestion.id);
    expect(
      (
        await prisma.rubricCriterion.findUniqueOrThrow({
          where: { id: owners.building.questionRubric.id },
        })
      ).questionId,
    ).toBe(owners.building.question.id);
    expect(
      (
        await prisma.rubricCriterion.findUniqueOrThrow({
          where: { id: owners.building.subQuestionRubric.id },
        })
      ).subQuestionId,
    ).toBe(owners.building.subQuestion.id);
  });

  it('enforces direct POINTS aggregate and rubric totals with rollback', async () => {
    const suffix = String(Date.now());
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `POINTS_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'points',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 },
    });
    await prisma.curriculumVersion.update({
      where: { id: version.id },
      data: { status: 'PUBLISHED' },
    });
    type Variant =
      | 'valid'
      | 'missingRevision'
      | 'missingSection'
      | 'missingQuestion'
      | 'missingSubquestion'
      | 'mixedQuestionRubric'
      | 'mixedSubquestionRubric'
      | 'revisionMismatch'
      | 'sectionMismatch'
      | 'questionMismatch'
      | 'questionRubricMismatch'
      | 'subquestionRubricMismatch';
    const finalize = (variant: Variant, type: 'WORKSHEET' | 'TEST' = 'WORKSHEET') =>
      prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: `${variant}-${suffix}`, workspaceType: 'SCHOOL' },
        });
        const assessment = await tx.assessment.create({
          data: { organizationId: organization.id, type, title: `${type}-${variant}-${suffix}` },
        });
        const q2Score = variant === 'questionMismatch' ? 5_999 : 6_000;
        const sectionScore =
          variant === 'missingSection'
            ? null
            : variant === 'sectionMismatch'
              ? 9_999
              : variant === 'questionMismatch'
                ? 9_999
                : 10_000;
        const total =
          variant === 'missingRevision'
            ? null
            : variant === 'revisionMismatch'
              ? 9_999
              : sectionScore;
        const revision = await tx.assessmentRevision.create({
          data: {
            assessmentId: assessment.id,
            revisionNumber: 1,
            idempotencyKey: `${type}-${variant}-${suffix}`,
            requestFingerprint: '2'.repeat(64),
            curriculumVersionId: version.id,
            scoringMode: 'POINTS',
            totalScoreUnits: total,
          },
        });
        const section = await tx.assessmentSection.create({
          data: {
            revisionId: revision.id,
            key: 's',
            title: 's',
            order: 0,
            scoreUnits: sectionScore,
          },
        });
        const directQuestion = await tx.assessmentQuestion.create({
          data: {
            sectionId: section.id,
            key: 'direct',
            type: 'SHORT',
            prompt: 'direct',
            order: 0,
            scoreUnits: variant === 'missingQuestion' ? null : 4_000,
          },
        });
        await tx.rubricCriterion.createMany({
          data: [
            {
              questionId: directQuestion.id,
              key: 'r1',
              description: 'r1',
              order: 0,
              scoreUnits: variant === 'questionRubricMismatch' ? 1_000 : 2_000,
            },
            {
              questionId: directQuestion.id,
              key: 'r2',
              description: 'r2',
              order: 1,
              scoreUnits:
                variant === 'mixedQuestionRubric'
                  ? null
                  : variant === 'questionRubricMismatch'
                    ? 1_000
                    : 2_000,
            },
          ],
        });
        const compositeQuestion = await tx.assessmentQuestion.create({
          data: {
            sectionId: section.id,
            key: 'composite',
            type: 'SHORT',
            prompt: 'composite',
            order: 1,
            scoreUnits: q2Score,
          },
        });
        for (const [order, key] of ['sq1', 'sq2'].entries()) {
          const subQuestion = await tx.assessmentSubQuestion.create({
            data: {
              questionId: compositeQuestion.id,
              key,
              prompt: key,
              order,
              scoreUnits: variant === 'missingSubquestion' && order === 0 ? null : 3_000,
            },
          });
          await tx.rubricCriterion.createMany({
            data: [
              {
                subQuestionId: subQuestion.id,
                key: `${key}-r1`,
                description: 'r1',
                order: 0,
                scoreUnits:
                  order === 1 ? null : variant === 'subquestionRubricMismatch' ? 1_000 : 1_500,
              },
              {
                subQuestionId: subQuestion.id,
                key: `${key}-r2`,
                description: 'r2',
                order: 1,
                scoreUnits:
                  order === 1
                    ? null
                    : variant === 'mixedSubquestionRubric'
                      ? null
                      : variant === 'subquestionRubricMismatch'
                        ? 1_000
                        : 1_500,
              },
            ],
          });
        }
        return tx.assessmentRevision.update({
          where: { id: revision.id },
          data: { state: 'FINALIZED' },
        });
      });
    await expect(finalize('valid')).resolves.toMatchObject({ state: 'FINALIZED' });
    await expect(finalize('missingRevision')).rejects.toThrow('revision score total mismatch');
    await expect(finalize('missingSection')).rejects.toThrow(
      'POINTS scoring requires complete aggregate scores',
    );
    await expect(finalize('missingQuestion')).rejects.toThrow(
      'POINTS scoring requires complete aggregate scores',
    );
    await expect(finalize('missingSubquestion')).rejects.toThrow(
      'POINTS scoring requires complete aggregate scores',
    );
    await expect(finalize('mixedQuestionRubric')).rejects.toThrow(
      'question rubric score total mismatch',
    );
    await expect(finalize('mixedSubquestionRubric')).rejects.toThrow(
      'subquestion rubric score total mismatch',
    );
    await expect(finalize('revisionMismatch')).rejects.toThrow('revision score total mismatch');
    await expect(finalize('sectionMismatch')).rejects.toThrow('section score total mismatch');
    await expect(finalize('questionMismatch')).rejects.toThrow('question score total mismatch');
    await expect(finalize('questionRubricMismatch')).rejects.toThrow(
      'question rubric score total mismatch',
    );
    await expect(finalize('subquestionRubricMismatch')).rejects.toThrow(
      'subquestion rubric score total mismatch',
    );
    expect(await prisma.assessment.count({ where: { title: { contains: `-${suffix}` } } })).toBe(1);
    await expect(finalize('valid', 'TEST')).resolves.toMatchObject({ state: 'FINALIZED' });
  });

  it('enforces direct score range, integer, overflow, zero, and TEST mode boundaries', async () => {
    const suffix = String(Date.now());
    const organization = await prisma.organization.create({
      data: { name: `range-${suffix}`, workspaceType: 'SCHOOL' },
    });
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `RANGE_${suffix}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'range',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1 },
    });
    await prisma.curriculumNode.create({
      data: { versionId: version.id, type: 'GRADE', code: `G_${suffix}`, label: 'g', sortOrder: 0 },
    });
    await prisma.curriculumVersion.update({
      where: { id: version.id },
      data: { status: 'PUBLISHED' },
    });
    const assessment = await prisma.assessment.create({
      data: { organizationId: organization.id, type: 'TEST', title: `range-${suffix}` },
    });
    await expect(
      prisma.$executeRaw`INSERT INTO assessment_revisions (assessment_id,revision_number,idempotency_key,request_fingerprint,curriculum_version_id,scoring_mode,total_score_units) VALUES (${assessment.id}::uuid,1,${`negative-${suffix}`},${'3'.repeat(64)},${version.id}::uuid,'POINTS',-1)`,
    ).rejects.toThrow('assessment_revisions_score_range');
    await expect(
      prisma.$executeRaw`INSERT INTO assessment_revisions (assessment_id,revision_number,idempotency_key,request_fingerprint,curriculum_version_id,scoring_mode,total_score_units) VALUES (${assessment.id}::uuid,2,${`overflow-${suffix}`},${'4'.repeat(64)},${version.id}::uuid,'POINTS',1000001)`,
    ).rejects.toThrow('assessment_revisions_score_range');
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO assessment_revisions (assessment_id,revision_number,idempotency_key,request_fingerprint,curriculum_version_id,scoring_mode,total_score_units) VALUES ('${assessment.id}',3,'fraction-${suffix}','${'5'.repeat(64)}','${version.id}','POINTS','1.5')`,
      ),
    ).rejects.toThrow('integer');
    await expect(
      prisma.$transaction(async (tx) => {
        const revision = await tx.assessmentRevision.create({
          data: {
            assessmentId: assessment.id,
            revisionNumber: 4,
            idempotencyKey: `none-test-${suffix}`,
            requestFingerprint: '6'.repeat(64),
            curriculumVersionId: version.id,
            scoringMode: 'NONE',
            totalScoreUnits: null,
          },
        });
        return tx.assessmentRevision.update({
          where: { id: revision.id },
          data: { state: 'FINALIZED' },
        });
      }),
    ).rejects.toThrow('tests require POINTS scoring');
    await expect(
      prisma.$transaction(async (tx) => {
        const revision = await tx.assessmentRevision.create({
          data: {
            assessmentId: assessment.id,
            revisionNumber: 5,
            idempotencyKey: `zero-${suffix}`,
            requestFingerprint: '7'.repeat(64),
            curriculumVersionId: version.id,
            scoringMode: 'POINTS',
            totalScoreUnits: 0,
          },
        });
        const section = await tx.assessmentSection.create({
          data: { revisionId: revision.id, key: 's', title: 's', order: 0, scoreUnits: 0 },
        });
        await tx.assessmentQuestion.create({
          data: {
            sectionId: section.id,
            key: 'q',
            type: 'SHORT',
            prompt: 'q',
            order: 0,
            scoreUnits: 0,
          },
        });
        return tx.assessmentRevision.update({
          where: { id: revision.id },
          data: { state: 'FINALIZED' },
        });
      }),
    ).resolves.toMatchObject({ state: 'FINALIZED', totalScoreUnits: 0 });
    expect(await prisma.assessmentRevision.count({ where: { assessmentId: assessment.id } })).toBe(
      1,
    );
  });
});
