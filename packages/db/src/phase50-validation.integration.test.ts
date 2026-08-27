import { afterAll, describe, expect, it } from 'vitest';
import {
  createPersonalWorkspace,
  createAssessmentRevision,
  getRevisionValidationReadiness,
  getValidationStatus,
  publishCurriculumVersion,
  prisma,
  requestRevisionValidation,
  resolveAccessContext,
} from './index.js';

const principal = (userId: string) => ({
  version: '1.0.0' as const,
  userId,
  email: 'phase50@example.test',
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase50-${Date.now()}-${Math.random()}@example.test`,
    workspaceName: 'phase50',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P50-${Date.now()}-${Math.random()}`,
      educationSystemCode: 'IL',
      subjectCode: 'MATH',
      displayName: 'Phase 50',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: {
      curriculumId: curriculum.id,
      versionNumber: 1,
    },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G1', label: 'Grade 1', sortOrder: 1 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Phase 50',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    principal(workspace.user.id),
    workspace.organization.id,
  );
  const revision = await createAssessmentRevision(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `revision-${Math.random()}`,
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

describe('Phase 50 persisted validation operations', () => {
  afterAll(() => prisma.$disconnect());

  it('persists one pending run and one ID-only outbox event atomically', async () => {
    const f = await fixture();
    const result = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-one',
    });
    expect(result.state).toBe('PENDING');
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `validation:${result.id}` },
    });
    expect(event.payload).toEqual({ validationRunId: result.id });
    expect(await getValidationStatus(f.context, result.id)).toMatchObject({
      id: result.id,
      state: 'PENDING',
      revisionSequence: 1,
    });
  });

  it('replays the exact request and rejects a conflicting idempotency payload', async () => {
    const f = await fixture();
    const input = {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-replay',
    };
    const first = await requestRevisionValidation(f.context, input);
    const replay = await requestRevisionValidation(f.context, input);
    expect(replay.id).toBe(first.id);
    await expect(
      requestRevisionValidation(f.context, {
        ...input,
        assessmentId: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toThrow('Resource not found or unavailable');
  });

  it('reloads persisted membership instead of trusting a forged role field', async () => {
    const f = await fixture();
    const forged = {
      ...f.context,
      role: 'SCHOOL_ADMIN' as const,
      organizationId: f.workspace.organization.id,
    };
    const result = await requestRevisionValidation(forged, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-forged-role',
    });
    expect(result.state).toBe('PENDING');
  });

  it('uses the greatest committed sequence for readiness', async () => {
    const f = await fixture();
    expect(
      await getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
    await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-old',
    });
    const newest = await requestRevisionValidation(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      idempotencyKey: 'request-new',
    });
    expect(newest.revisionSequence).toBe(2);
    expect(
      await getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).toMatchObject({
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_PENDING',
      validationRunId: newest.id,
    });
  });

  it('rejects a direct run insert with mismatched assessment and revision identity', async () => {
    const f = await fixture();
    const otherAssessment = await prisma.assessment.create({
      data: {
        organizationId: f.workspace.organization.id,
        type: 'WORKSHEET',
        title: 'Other',
        createdByUserId: f.workspace.user.id,
      },
    });
    const other = await createAssessmentRevision(f.context, {
      version: '1.0.0',
      assessmentId: otherAssessment.id,
      idempotencyKey: `other-${Math.random()}`,
      curriculumVersionId: f.revision.curriculumVersionId,
      curriculumNodeIds: [],
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
    await expect(
      prisma.$executeRaw`INSERT INTO validation_runs (organization_id, assessment_id, assessment_revision_id, requesting_user_id, ruleset_version, evaluator_version, revision_sequence, idempotency_key, request_fingerprint) VALUES (${f.workspace.organization.id}::uuid, ${f.assessment.id}::uuid, ${other.id}::uuid, ${f.workspace.user.id}::uuid, 'v1', 'local-disabled-v1', 1, ${`direct-${Math.random()}`}, ${'c'.repeat(64)})`,
    ).rejects.toThrow('phase50 revision identity or finalized state rejected');
  });
});
