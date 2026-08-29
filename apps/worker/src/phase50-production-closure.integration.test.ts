import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessmentRevision,
  createPersonalWorkspace,
  prisma,
  publishCurriculumVersion,
  requestRevisionValidation,
  resolveAccessContext,
} from '@teach/db';
import { OutboxWorker } from './worker.js';

describe('Phase 50 production worker closure', () => {
  afterAll(() => prisma.$disconnect());

  it('routes an ID-only validation event through the shared payload validator and fails malformed data safely', async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'validation.requested',
        payload: { unexpected: 'never-a-run-id' },
        idempotencyKey: `phase50-malformed-${crypto.randomUUID()}`,
      },
    });
    await prisma.outboxEvent.updateMany({
      where: { id: { not: event.id } },
      data: {
        availableAt: new Date(Date.now() + 60_000),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date() } });

    expect(await new OutboxWorker(() => undefined).pollOnce()).toBe(true);
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toBe('Error');
    expect(failed.lastError).not.toContain('unexpected');
  });

  it('publishes a valid ID-only validation event through the validation processor', async () => {
    const workspace = await createPersonalWorkspace({
      email: `phase50-worker-${crypto.randomUUID()}@example.test`,
      workspaceName: 'worker closure',
    });
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `P50W-${crypto.randomUUID()}`,
        educationSystemCode: 'IL',
        subjectCode: 'MATH',
        displayName: 'Worker closure',
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
        title: 'Worker',
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
    const requested = await requestRevisionValidation(context, {
      version: '1.0.0',
      assessmentId: assessment.id,
      assessmentRevisionId: revision.id,
      idempotencyKey: `validation-${crypto.randomUUID()}`,
    });
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'validation.requested',
        payload: { validationRunId: requested.id },
        idempotencyKey: `phase50-valid-${crypto.randomUUID()}`,
      },
    });
    await prisma.outboxEvent.updateMany({
      where: { id: { not: event.id } },
      data: {
        availableAt: new Date(Date.now() + 60_000),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await new OutboxWorker(() => undefined).pollOnce()).toBe(true);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'PUBLISHED',
    );
    expect(
      (await prisma.validationRun.findUniqueOrThrow({ where: { id: requested.id } })).state,
    ).toBe('SUCCEEDED');
  });
});
