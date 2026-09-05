import { DeterministicFakeModelGateway } from '@teach/ai';
import { afterAll, describe, expect, it } from 'vitest';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  createAssessmentRevision,
  createPersonalWorkspace,
  deprecateCurriculumVersion,
  prisma,
  processGenerationRun,
  publishCurriculumVersion,
  requestQuestionRegeneration,
  resolveAccessContext,
  saveEditedRevision,
} from './index.js';

const principal = (userId: string) => ({
  version: '1.0.0' as const,
  userId,
  email: `${userId}@example.test`,
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture(type: 'WORKSHEET' | 'TEST' = 'WORKSHEET') {
  const workspace = await createPersonalWorkspace({
    email: `p60-editor-${crypto.randomUUID()}@example.test`,
    workspaceName: 'P60 editor',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `E${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Editor',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1 },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G', label: 'Grade', sortOrder: 0 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type,
      title: 'Editor',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    principal(workspace.user.id),
    workspace.organization.id,
  );
  const points = type === 'TEST';
  const base = await createAssessmentRevision(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: crypto.randomUUID(),
    curriculumVersionId: version.id,
    curriculumNodeIds: [node.id],
    scoringMode: points ? 'POINTS' : 'NONE',
    totalScoreUnits: points ? 10_000 : null,
    sections: points
      ? [
          {
            key: 's1',
            title: 'Section 1',
            instructions: 'I1',
            order: 0,
            scoreUnits: 10_000,
            questions: [
              {
                key: 'q1',
                type: 'SHORT_TEXT',
                prompt: 'Prompt 1',
                instructions: 'QI1',
                order: 0,
                scoreUnits: 10_000,
                answers: [{ key: 'a1', order: 0, text: 'Answer 1', explanation: 'Why 1' }],
                rubrics: [{ key: 'r1', order: 0, description: 'Rubric 1', scoreUnits: 10_000 }],
                subQuestions: [],
              },
            ],
          },
        ]
      : [
          {
            key: 's1',
            title: 'Section 1',
            instructions: 'I1',
            order: 0,
            scoreUnits: null,
            questions: [
              {
                key: 'q1',
                type: 'SHORT_TEXT',
                prompt: 'Prompt 1',
                instructions: 'QI1',
                order: 0,
                scoreUnits: null,
                answers: [{ key: 'a1', order: 0, text: 'Answer 1', explanation: 'Why 1' }],
                rubrics: [],
                subQuestions: [
                  {
                    key: 'sq1',
                    prompt: 'Sub 1',
                    order: 0,
                    scoreUnits: null,
                    answers: [{ key: 'sa1', order: 0, text: 'Sub answer 1' }],
                    rubrics: [],
                  },
                  {
                    key: 'sq2',
                    prompt: 'Sub 2',
                    order: 1,
                    scoreUnits: null,
                    answers: [{ key: 'sa2', order: 0, text: 'Sub answer 2' }],
                    rubrics: [],
                  },
                ],
              },
            ],
          },
          {
            key: 's2',
            title: 'Section 2',
            order: 1,
            scoreUnits: null,
            questions: [
              {
                key: 'q2',
                type: 'OPEN',
                prompt: 'Prompt 2',
                order: 0,
                scoreUnits: null,
                answers: [{ key: 'a2', order: 0, text: 'Answer 2' }],
                rubrics: [],
                subQuestions: [],
              },
            ],
          },
        ],
  });
  return { workspace, curriculum, version, node, assessment, context, base };
}

const graphInclude = {
  nodeLinks: { orderBy: { curriculumNodeId: 'asc' as const } },
  sections: {
    orderBy: { order: 'asc' as const },
    include: {
      questions: {
        orderBy: { order: 'asc' as const },
        include: {
          answers: { orderBy: { order: 'asc' as const } },
          rubrics: { orderBy: { order: 'asc' as const } },
          subQuestions: {
            orderBy: { order: 'asc' as const },
            include: {
              answers: { orderBy: { order: 'asc' as const } },
              rubrics: { orderBy: { order: 'asc' as const } },
            },
          },
          questionSourceLinks: { orderBy: { id: 'asc' as const } },
        },
      },
    },
  },
};

async function graph(id: string) {
  return prisma.assessmentRevision.findUniqueOrThrow({ where: { id }, include: graphInclude });
}

function requestFromGraph(
  assessmentId: string,
  base: Awaited<ReturnType<typeof graph>>,
  mutate?: (sections: any[]) => void,
  key: string = crypto.randomUUID(),
) {
  const sections = base.sections.map((section) => ({
    key: section.key,
    title: section.title,
    instructions: section.instructions,
    order: section.order,
    scoreUnits: section.scoreUnits,
    questions: section.questions.map((question) => ({
      logicalId: question.logicalId,
      key: question.key,
      type: question.type,
      prompt: question.prompt,
      instructions: question.instructions,
      order: question.order,
      scoreUnits: question.scoreUnits,
      answers: question.answers.map((a) => ({
        key: a.key,
        order: a.order,
        text: a.text,
        explanation: a.explanation,
      })),
      rubrics: question.rubrics.map((r) => ({
        key: r.key,
        order: r.order,
        description: r.description,
        scoreUnits: r.scoreUnits,
      })),
      subQuestions: question.subQuestions.map((sub) => ({
        key: sub.key,
        prompt: sub.prompt,
        order: sub.order,
        scoreUnits: sub.scoreUnits,
        answers: sub.answers.map((a) => ({
          key: a.key,
          order: a.order,
          text: a.text,
          explanation: a.explanation,
        })),
        rubrics: sub.rubrics.map((r) => ({
          key: r.key,
          order: r.order,
          description: r.description,
          scoreUnits: r.scoreUnits,
        })),
      })),
    })),
  }));
  mutate?.(sections);
  return {
    version: '1.0.0' as const,
    assessmentId,
    baseRevisionId: base.id,
    baseRevisionNumber: base.revisionNumber,
    idempotencyKey: key,
    sections,
  };
}

async function requestFor(
  f: Awaited<ReturnType<typeof fixture>>,
  mutate?: (sections: any[]) => void,
  key: string = crypto.randomUUID(),
) {
  return requestFromGraph(f.assessment.id, await graph(f.base.id), mutate, key);
}

async function counts(assessmentId: string) {
  return {
    revisions: await prisma.assessmentRevision.count({ where: { assessmentId } }),
    audits: await prisma.auditEvent.count({
      where: {
        eventType: 'assessment.revision.edited',
        targetId: { not: '' },
        organization: { assessments: { some: { id: assessmentId } } },
      },
    }),
  };
}

function settledCode(result: PromiseSettledResult<unknown>) {
  return result.status === 'rejected' && typeof result.reason === 'object'
    ? result.reason.code
    : null;
}

async function overlap(assessmentId: string, operations: Array<() => Promise<unknown>>) {
  let release!: () => void;
  let locked!: () => void;
  const releaseWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lockedWait = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${assessmentId}::text, 60))`;
    locked();
    await releaseWait;
  });
  await lockedWait;
  const pending = operations.map((operation) => operation());
  let waiters = 0;
  for (let attempt = 0; attempt < 500 && waiters < operations.length; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype='advisory' AND granted=FALSE
    `;
    waiters = Number(rows[0]?.count ?? 0);
    if (waiters < operations.length) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  release();
  await blocker;
  return { waiters, results: await Promise.allSettled(pending) };
}

describe('Phase 60 persisted immutable editor', () => {
  afterAll(() => prisma.$disconnect());

  it('E01 creates N+1 for title/instruction edits and leaves N canonically unchanged', async () => {
    const f = await fixture();
    const before = await graph(f.base.id);
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        s[0].title = 'Edited';
        s[0].instructions = 'Edited instructions';
      }),
    );
    expect(saved).toMatchObject({ revisionNumber: 2, baseRevisionId: f.base.id });
    expect(await graph(f.base.id)).toEqual(before);
    expect((await graph(saved.revisionId)).sections[0]).toMatchObject({
      title: 'Edited',
      instructions: 'Edited instructions',
    });
  });
  it('E02 edits a prompt in a new snapshot while preserving logical identity', async () => {
    const f = await fixture();
    const before = await graph(f.base.id);
    const id = before.sections[0]!.questions[0]!.logicalId;
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        s[0].questions[0].prompt = 'Edited prompt';
      }),
    );
    expect((await graph(saved.revisionId)).sections[0]!.questions[0]).toMatchObject({
      logicalId: id,
      prompt: 'Edited prompt',
    });
    expect((await graph(f.base.id)).sections[0]!.questions[0]!.prompt).toBe('Prompt 1');
  });
  it('E03 edits answer/explanation only on the target new question', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        s[0].questions[0].answers[0].text = 'New answer';
        s[0].questions[0].answers[0].explanation = 'New why';
      }),
    );
    expect((await graph(saved.revisionId)).sections[0]!.questions[0]!.answers[0]).toMatchObject({
      text: 'New answer',
      explanation: 'New why',
    });
    expect((await graph(saved.revisionId)).sections[1]!.questions[0]!.answers[0]!.text).toBe(
      'Answer 2',
    );
  });
  it('E04 edits rubric text/score only on the target', async () => {
    const f = await fixture('TEST');
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        s[0].questions[0].rubrics[0].description = 'Changed rubric';
      }),
    );
    expect((await graph(saved.revisionId)).sections[0]!.questions[0]!.rubrics[0]).toMatchObject({
      description: 'Changed rubric',
      scoreUnits: 10_000,
    });
  });
  it('E05 adds a section with deterministic persisted order', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) =>
        s.push({
          key: 's3',
          title: 'Third',
          instructions: null,
          order: 2,
          scoreUnits: null,
          questions: [
            {
              key: 'q3',
              type: 'OPEN',
              prompt: 'Third',
              instructions: null,
              order: 0,
              scoreUnits: null,
              answers: [],
              rubrics: [],
              subQuestions: [],
            },
          ],
        }),
      ),
    );
    expect((await graph(saved.revisionId)).sections.map((s) => [s.key, s.order])).toEqual([
      ['s1', 0],
      ['s2', 1],
      ['s3', 2],
    ]);
  });
  it('E06 deletes a section only from the new revision', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(f.context, await requestFor(f, (s) => s.splice(1, 1)));
    expect((await graph(saved.revisionId)).sections.map((s) => s.key)).toEqual(['s1']);
    expect((await graph(f.base.id)).sections.map((s) => s.key)).toEqual(['s1', 's2']);
  });
  it('E07 reorders sections deterministically while preserving their content', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        [s[0].order, s[1].order] = [1, 0];
      }),
    );
    expect(
      (await graph(saved.revisionId)).sections.map((s) => [s.key, s.questions[0]!.prompt]),
    ).toEqual([
      ['s2', 'Prompt 2'],
      ['s1', 'Prompt 1'],
    ]);
  });
  it('E08 adds a question with a server-assigned stable identity and deterministic position', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) =>
        s[0].questions.push({
          key: 'q3',
          type: 'OPEN',
          prompt: 'New',
          instructions: null,
          order: 1,
          scoreUnits: null,
          answers: [],
          rubrics: [],
          subQuestions: [],
        }),
      ),
    );
    const questions = (await graph(saved.revisionId)).sections[0]!.questions;
    expect(questions.map((q) => q.order)).toEqual([0, 1]);
    expect(questions[1]!.logicalId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('E09 deletes a question only from the new revision', async () => {
    const f = await fixture();
    const oldId = (await graph(f.base.id)).sections[0]!.questions[0]!.logicalId;
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        s[0].questions.splice(0, 1);
        s[0].questions.push({
          key: 'replacement',
          type: 'OPEN',
          prompt: 'Replacement',
          instructions: null,
          order: 0,
          scoreUnits: null,
          answers: [],
          rubrics: [],
          subQuestions: [],
        });
      }),
    );
    expect(
      (await graph(saved.revisionId)).sections[0]!.questions.some((q) => q.logicalId === oldId),
    ).toBe(false);
    expect((await graph(f.base.id)).sections[0]!.questions.some((q) => q.logicalId === oldId)).toBe(
      true,
    );
  });
  it('E10 reorders questions while preserving identities content answers scores and source-link sets', async () => {
    const f = await createGenerationFixture({ multiQuestion: true });
    const draft = await processGenerationRun(
      f.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    const base = await graph(draft!.outputRevisionId!);
    const req = requestFromGraph(f.assessmentId, base, (s) => {
      [s[0].questions[0].order, s[0].questions[1].order] = [1, 0];
    });
    const saved = await saveEditedRevision(f.context, req);
    const output = await graph(saved.revisionId);
    const sourceShape = (link: any) => ({
      knowledgeItemId: link.knowledgeItemId,
      sourceVersionId: link.sourceVersionId,
      locator: link.locator,
      textHash: link.textHash,
      curriculumVersionId: link.curriculumVersionId,
      curriculumNodeId: link.curriculumNodeId,
      lineage: link.lineage,
      priorQuestionId: link.priorQuestionId,
    });
    for (const outputQuestion of output.sections.flatMap((s) => s.questions)) {
      const prior = base.sections
        .flatMap((s) => s.questions)
        .find((q) => q.logicalId === outputQuestion.logicalId)!;
      expect(outputQuestion.prompt).toBe(prior.prompt);
      expect(outputQuestion.answers.map((a) => a.text)).toEqual(prior.answers.map((a) => a.text));
      expect(outputQuestion.questionSourceLinks.map(sourceShape)).toEqual(
        prior.questionSourceLinks.map(sourceShape),
      );
      expect(
        outputQuestion.questionSourceLinks.map((link) => link.copiedFromQuestionSourceLinkId),
      ).toEqual(prior.questionSourceLinks.map((link) => link.id));
    }
  });
  it('E11 add/edit/delete/reorder subquestions creates one valid immutable graph', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(
      f.context,
      await requestFor(f, (s) => {
        const subs = s[0].questions[0].subQuestions;
        subs[0].prompt = 'Edited sub';
        subs[0].order = 1;
        subs.splice(1, 1);
        subs.push({
          key: 'sq3',
          prompt: 'Added sub',
          order: 0,
          scoreUnits: null,
          answers: [],
          rubrics: [],
        });
      }),
    );
    expect(
      (await graph(saved.revisionId)).sections[0]!.questions[0]!.subQuestions.map((s) => [
        s.key,
        s.prompt,
      ]),
    ).toEqual([
      ['sq3', 'Added sub'],
      ['sq1', 'Edited sub'],
    ]);
    expect((await graph(f.base.id)).sections[0]!.questions[0]!.subQuestions).toHaveLength(2);
  });
  it('E12 saves a valid NONE-scored worksheet', async () => {
    const f = await fixture();
    const saved = await saveEditedRevision(f.context, await requestFor(f));
    expect(await graph(saved.revisionId)).toMatchObject({
      scoringMode: 'NONE',
      totalScoreUnits: null,
      state: 'FINALIZED',
    });
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: saved.revisionId } }),
    ).toBe(0);
    expect(
      await prisma.assessmentApproval.count({ where: { assessmentRevisionId: saved.revisionId } }),
    ).toBe(0);
  });
  it('E13 saves a valid exact 100-point integer-scored test', async () => {
    const f = await fixture('TEST');
    const saved = await saveEditedRevision(f.context, await requestFor(f));
    const revision = await graph(saved.revisionId);
    expect(revision.totalScoreUnits).toBe(10_000);
    expect(Number.isInteger(revision.sections[0]!.scoreUnits)).toBe(true);
  });
  it('E14 rejects invalid score totals before commit with zero partial rows', async () => {
    const f = await fixture('TEST');
    await expect(
      saveEditedRevision(
        f.context,
        await requestFor(f, (s) => {
          s[0].scoreUnits = 9_999;
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EDITOR_SNAPSHOT' });
    expect(await counts(f.assessment.id)).toEqual({ revisions: 1, audits: 0 });
  });
  it('E15 rejects duplicate keys orders and identities before commit with zero partial rows', async () => {
    const f = await fixture();
    await expect(
      saveEditedRevision(
        f.context,
        await requestFor(f, (s) => {
          s[1].order = 0;
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EDITOR_SNAPSHOT' });
    expect(await counts(f.assessment.id)).toEqual({ revisions: 1, audits: 0 });
  });
  it('E16 rejects an unpublished curriculum before commit with zero partial rows', async () => {
    const f = await fixture();
    await deprecateCurriculumVersion(f.version.id, f.workspace.user.id);
    await expect(saveEditedRevision(f.context, await requestFor(f))).rejects.toMatchObject({
      code: 'CURRICULUM_UNAVAILABLE',
    });
    expect(await counts(f.assessment.id)).toEqual({ revisions: 1, audits: 0 });
  });
  it('E17 identical retry returns the same revision and exactly one safe edit audit', async () => {
    const f = await fixture();
    const req = await requestFor(f, undefined, 'same');
    const one = await saveEditedRevision(f.context, req);
    const two = await saveEditedRevision(f.context, req);
    expect(two).toEqual(one);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'assessment.revision.edited', targetId: one.revisionId },
    });
    expect(Object.keys(audit.metadata as object).sort()).toEqual(
      [
        'addedQuestionCount',
        'assessmentId',
        'baseRevisionId',
        'deletedQuestionCount',
        'questionCount',
        'revisionId',
        'schemaVersion',
        'sectionCount',
      ].sort(),
    );
    expect(JSON.stringify(audit.metadata)).not.toContain('Prompt');
    expect(JSON.stringify(audit.metadata)).not.toContain('Answer');
  });
  it('E18 conflicting content under one key preserves exact revision and audit counts', async () => {
    const f = await fixture();
    const one = await requestFor(f, undefined, 'conflict');
    const two = structuredClone(one);
    two.sections[0]!.title = 'Different';
    await saveEditedRevision(f.context, one);
    await expect(saveEditedRevision(f.context, two)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
  });

  it('scopes the canonical idempotency key to the actor without storing the client key', async () => {
    const f = await fixture();
    const other = await createPersonalWorkspace({
      email: `p60-editor-other-${crypto.randomUUID()}@example.test`,
      workspaceName: 'Other editor',
    });
    await prisma.organization.update({
      where: { id: f.workspace.organization.id },
      data: { workspaceType: 'SCHOOL' },
    });
    await prisma.membership.create({
      data: {
        userId: other.user.id,
        organizationId: f.workspace.organization.id,
        role: 'TEACHER',
      },
    });
    const otherContext = await resolveAccessContext(
      principal(other.user.id),
      f.workspace.organization.id,
    );
    const clientKey = 'shared-client-key';
    const first = await saveEditedRevision(f.context, await requestFor(f, undefined, clientKey));
    const firstGraph = await graph(first.revisionId);
    const second = await saveEditedRevision(
      otherContext,
      requestFromGraph(f.assessment.id, firstGraph, undefined, clientKey),
    );
    const revisions = await prisma.assessmentRevision.findMany({
      where: { id: { in: [first.revisionId, second.revisionId] } },
      orderBy: { revisionNumber: 'asc' },
      select: { idempotencyKey: true },
    });
    expect(revisions.map((revision) => revision.idempotencyKey)).not.toContain(clientKey);
    expect(new Set(revisions.map((revision) => revision.idempotencyKey)).size).toBe(2);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 3, audits: 2 });
  });

  it('C01 simultaneous edits from one base accept at most one next revision', async () => {
    const f = await fixture();
    const a = await requestFor(
      f,
      (s) => {
        s[0].title = 'A';
      },
      'a',
    );
    const b = await requestFor(
      f,
      (s) => {
        s[0].title = 'B';
      },
      'b',
    );
    const raced = await overlap(f.assessment.id, [
      () => saveEditedRevision(f.context, a),
      () => saveEditedRevision(f.context, b),
    ]);
    expect(raced.waiters).toBeGreaterThanOrEqual(2);
    expect(raced.results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
    const latest = await graph(
      (
        await prisma.assessmentRevision.findFirstOrThrow({
          where: { assessmentId: f.assessment.id },
          orderBy: { revisionNumber: 'desc' },
        })
      ).id,
    );
    expect(latest.sections).toHaveLength(2);
    expect(latest.sections.flatMap((s) => s.questions)).toHaveLength(2);
  });
  it('C02 losing stale edit returns deterministic conflict and no partial graph/audit', async () => {
    const f = await fixture();
    const a = await requestFor(f, undefined, 'a');
    const b = await requestFor(
      f,
      (s) => {
        s[0].title = 'B';
      },
      'b',
    );
    const { results } = await overlap(f.assessment.id, [
      () => saveEditedRevision(f.context, a),
      () => saveEditedRevision(f.context, b),
    ]);
    expect(results.map(settledCode).filter(Boolean)).toEqual(['STALE_BASE']);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
  });
  it('C03 identical concurrent retries converge to one revision and one audit', async () => {
    const f = await fixture();
    const req = await requestFor(f, undefined, 'same');
    const { waiters, results } = await overlap(f.assessment.id, [
      () => saveEditedRevision(f.context, req),
      () => saveEditedRevision(f.context, req),
    ]);
    expect(waiters).toBeGreaterThanOrEqual(2);
    expect(results.every((x) => x.status === 'fulfilled')).toBe(true);
    expect(new Set(results.map((x: any) => x.value.revisionId)).size).toBe(1);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
    expect(
      (await graph((results[0] as any).value.revisionId)).sections.flatMap((s) => s.questions),
    ).toHaveLength(2);
  });
  it('C04 different payloads sharing one key yield one success and one conflict', async () => {
    const f = await fixture();
    const a = await requestFor(f, undefined, 'same');
    const b = structuredClone(a);
    b.sections[0]!.title = 'Different';
    const { results } = await overlap(f.assessment.id, [
      () => saveEditedRevision(f.context, a),
      () => saveEditedRevision(f.context, b),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.map(settledCode)).toContain('IDEMPOTENCY_CONFLICT');
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
    const winner = results.find((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled')!;
    expect(
      (await graph(winner.value.revisionId)).sections.flatMap((s) => s.questions),
    ).toHaveLength(2);
  });
  it('C08 concurrent reorder/add cannot allocate duplicate revisions keys or orders', async () => {
    const f = await fixture();
    const reorder = await requestFor(
      f,
      (s) => {
        [s[0].order, s[1].order] = [1, 0];
      },
      'reorder',
    );
    const add = await requestFor(
      f,
      (s) =>
        s.push({
          key: 's3',
          title: 'Third',
          instructions: null,
          order: 2,
          scoreUnits: null,
          questions: [
            {
              key: 'q3',
              type: 'OPEN',
              prompt: 'Third',
              instructions: null,
              order: 0,
              scoreUnits: null,
              answers: [],
              rubrics: [],
              subQuestions: [],
            },
          ],
        }),
      'add',
    );
    const { results } = await overlap(f.assessment.id, [
      () => saveEditedRevision(f.context, reorder),
      () => saveEditedRevision(f.context, add),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const latest = await prisma.assessmentRevision.findFirstOrThrow({
      where: { assessmentId: f.assessment.id },
      orderBy: { revisionNumber: 'desc' },
      include: { sections: true },
    });
    expect(latest.revisionNumber).toBe(2);
    expect(new Set(latest.sections.map((s) => s.key)).size).toBe(latest.sections.length);
    expect(new Set(latest.sections.map((s) => s.order)).size).toBe(latest.sections.length);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
  });
  it('C09 Phase 40 regeneration and manual save from the same base cannot silently overwrite', async () => {
    const f = await createGenerationFixture({ multiQuestion: true });
    const draft = await processGenerationRun(
      f.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    const baseId = draft!.outputRevisionId!;
    const base = await graph(baseId);
    const target = base.sections[0]!.questions[0]!;
    const regen = await requestQuestionRegeneration(f.context, {
      version: '1.0.0',
      assessmentId: f.assessmentId,
      baseRevisionId: baseId,
      targetQuestionId: target.id,
      idempotencyKey: crypto.randomUUID(),
      instruction: 'נסחו מחדש',
      query: 'שלום',
    });
    const manual = requestFromGraph(f.assessmentId, base, (sections) => {
      sections[0].title = `${sections[0].title} edited`;
    });
    const { waiters, results } = await overlap(f.assessmentId, [
      () => processGenerationRun(regen.id, prisma, new DeterministicFakeModelGateway()),
      () => saveEditedRevision(f.context, manual),
    ]);
    expect(waiters).toBeGreaterThanOrEqual(2);
    const revisions = await prisma.assessmentRevision.findMany({
      where: { assessmentId: f.assessmentId },
      orderBy: { revisionNumber: 'asc' },
    });
    expect(revisions.map((r) => r.revisionNumber).sort()).toEqual([1, 2]);
    expect(
      results.filter(
        (x: any) =>
          x.status === 'fulfilled' &&
          (x.value?.state === 'SUCCEEDED' || x.value?.revisionNumber === 2),
      ),
    ).toHaveLength(1);
    const latestGraph = await graph(revisions[1]!.id);
    expect(latestGraph.sections).toHaveLength(base.sections.length);
    expect(latestGraph.sections.flatMap((s) => s.questions)).toHaveLength(
      base.sections.flatMap((s) => s.questions).length,
    );
    expect(
      await prisma.auditEvent.count({
        where: { eventType: 'assessment.revision.edited', targetId: revisions[1]!.id },
      }),
    ).toBe(revisions[1]!.idempotencyKey.startsWith('generation:') ? 0 : 1);
  });
  it('C10 a real advisory-lock barrier proves overlap and exact final graph/audit cardinality', async () => {
    const f = await fixture();
    const a = await requestFor(f, undefined, 'a');
    const b = await requestFor(
      f,
      (s) => {
        s[0].title = 'B';
      },
      'b',
    );
    const raced = await overlap(f.assessment.id, [
      () => saveEditedRevision(f.context, a),
      () => saveEditedRevision(f.context, b),
    ]);
    expect(raced.waiters).toBeGreaterThanOrEqual(2);
    expect(await counts(f.assessment.id)).toEqual({ revisions: 2, audits: 1 });
    const latest = await prisma.assessmentRevision.findFirstOrThrow({
      where: { assessmentId: f.assessment.id },
      orderBy: { revisionNumber: 'desc' },
      include: { sections: { include: { questions: true } } },
    });
    expect(latest.sections).toHaveLength(2);
    expect(latest.sections.flatMap((s) => s.questions)).toHaveLength(2);
  });
  it('rejects missing foreign and revision-number-mismatched bases without disclosure or writes', async () => {
    const f = await fixture();
    const other = await fixture();
    const original = await requestFor(f);
    const variants = [
      { ...original, baseRevisionId: crypto.randomUUID() },
      { ...original, baseRevisionId: other.base.id },
      { ...original, baseRevisionNumber: original.baseRevisionNumber + 1 },
    ];
    for (const candidate of variants)
      await expect(saveEditedRevision(f.context, candidate)).rejects.toMatchObject({
        code: 'RESOURCE_UNAVAILABLE',
      });
    expect(await counts(f.assessment.id)).toEqual({ revisions: 1, audits: 0 });
  });
});
