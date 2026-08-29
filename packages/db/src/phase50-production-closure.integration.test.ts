import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessmentRevision,
  createPersonalWorkspace,
  getValidationResult,
  getRevisionValidationReadiness,
  prisma,
  publishCurriculumVersion,
  processValidationRun,
  requestRevisionValidation,
  resolveAccessContext,
} from './index.js';
import { validationResultSchema } from '@teach/contracts';

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase50-closure-${crypto.randomUUID()}@example.test`,
    workspaceName: 'phase50 closure',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P50C-${crypto.randomUUID()}`,
      educationSystemCode: 'IL',
      subjectCode: 'MATH',
      displayName: 'Phase 50 closure',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1 },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G1', label: 'Grade 1', sortOrder: 1 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Closure',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    {
      version: '1.0.0',
      userId: workspace.user.id,
      email: workspace.user.normalizedEmail,
      provider: 'test',
      providerSubject: workspace.user.id,
      platformAdmin: false,
    },
    workspace.organization.id,
  );
  const revision = await createAssessmentRevision(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `revision-${crypto.randomUUID()}`,
    curriculumVersionId: version.id,
    curriculumNodeIds: [node.id],
    scoringMode: 'NONE',
    sections: [
      {
        key: 's1',
        title: 'Section',
        order: 0,
        questions: [
          {
            key: 'q1',
            type: 'SHORT_TEXT',
            prompt: 'Question',
            order: 0,
            answers: [{ key: 'a1', order: 0, text: 'Answer' }],
            rubrics: [],
            subQuestions: [],
          },
        ],
      },
    ],
  });
  return { workspace, assessment, revision, context };
}

describe('Phase 50 production service closure', () => {
  afterAll(() => prisma.$disconnect());

  it('converges concurrent same-key validation requests into one run and one ID-only outbox row', async () => {
    const f = await fixture();
    const input = {
      version: '1.0.0' as const,
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `same-${crypto.randomUUID()}`,
    };
    const [left, right] = await Promise.all([
      requestRevisionValidation(f.context, input),
      requestRevisionValidation(f.context, input),
    ]);
    expect(left.id).toBe(right.id);
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: {
          eventType: 'validation.requested',
          payload: { path: ['validationRunId'], equals: left.id },
        },
      }),
    ).toBe(1);
  });

  it('returns the strict non-disclosing validation-required shape for a missing revision', async () => {
    const f = await fixture();
    const expected = {
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    };
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, crypto.randomUUID()),
    ).resolves.toEqual(expected);
    const foreign = await fixture();
    await expect(
      getRevisionValidationReadiness(f.context, foreign.assessment.id, foreign.revision.id),
    ).resolves.toEqual(expected);
  });

  it('maps a persisted completed run through the strict result schema in registry order', async () => {
    const f = await fixture();
    const requested = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: `result-${crypto.randomUUID()}`,
    });
    await processValidationRun(requested.id);
    const result = await getValidationResult(f.context, requested.id);
    expect(result).not.toBeNull();
    expect(validationResultSchema.parse(result)).toEqual(result);
    expect(result!.executions).toHaveLength(11);
    expect(result!.executions.map((execution) => execution.ruleId)).toEqual([
      'REVISION_FINALIZED_AND_OWNED',
      'STRICT_REVISION_CONTRACT',
      'PLAN_COUNT_KEY_ORDER',
      'CURRICULUM_SCOPE_PUBLISHED',
      'ANSWER_COMPLETENESS_AND_TARGETS',
      'EXACT_SCORE_TREE',
      'STABLE_ID_AND_EXACT_DUPLICATE',
      'DETERMINISTIC_ANSWER_LEAKAGE',
      'SOURCE_LINK_COMPLETENESS_AND_IDENTITY',
      'CURRENT_SOURCE_ELIGIBILITY',
      'GENERATION_REVISION_PROVENANCE',
    ]);
    expect(result!.findings).toEqual(
      [...result!.findings].sort((a, b) =>
        `${a.kind}:${a.path}:${a.code}:${a.id}`.localeCompare(
          `${b.kind}:${b.path}:${b.code}:${b.id}`,
        ),
      ),
    );
  });
});
