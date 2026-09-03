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

  it('A06 emits exact safe worker telemetry for validation success and failure', async () => {
    const workspace = await createPersonalWorkspace({
      email: `phase50-worker-telemetry-${crypto.randomUUID()}@example.test`,
      workspaceName: 'worker telemetry',
    });
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `P50WT-${crypto.randomUUID()}`,
        educationSystemCode: 'IL',
        subjectCode: 'MATH',
        displayName: 'Protected source text',
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
        title: 'Protected questions and answers',
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
      idempotencyKey: `telemetry-revision-${crypto.randomUUID()}`,
      curriculumVersionId: version.id,
      curriculumNodeIds: [node.id],
      scoringMode: 'NONE',
      sections: [
        {
          key: 's1',
          title: 'Protected prompt',
          order: 0,
          questions: [
            {
              key: 'q1',
              type: 'SHORT_TEXT',
              prompt: 'Protected question source text',
              order: 0,
              answers: [{ key: 'a1', order: 0, text: 'Protected answer' }],
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
      idempotencyKey: `telemetry-validation-${crypto.randomUUID()}`,
    });
    const successEvent = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `validation:${requested.id}` },
    });
    const failureEvent = await prisma.outboxEvent.create({
      data: {
        eventType: 'validation.requested',
        payload: {
          prompt: 'prompt',
          question: 'question',
          answer: 'answer',
          sourceText: 'source text',
          tokens: 'tokens',
          secrets: 'secrets',
          cookies: 'cookies',
          authorization: 'Bearer password',
          authHeaders: 'auth headers',
        },
        idempotencyKey: `phase50-telemetry-failure-${crypto.randomUUID()}`,
      },
    });
    await prisma.outboxEvent.updateMany({
      where: { id: { notIn: [successEvent.id, failureEvent.id] } },
      data: {
        availableAt: new Date(Date.now() + 60_000),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.outboxEvent.update({
      where: { id: successEvent.id },
      data: { availableAt: new Date(Date.now() + 60_000) },
    });
    await prisma.outboxEvent.update({
      where: { id: failureEvent.id },
      data: { availableAt: new Date(0) },
    });

    const telemetry: Readonly<Record<string, unknown>>[] = [];
    const worker = new OutboxWorker((event) => telemetry.push(event));
    expect(await worker.pollOnce()).toBe(true);
    await prisma.outboxEvent.update({
      where: { id: successEvent.id },
      data: { availableAt: new Date(0) },
    });
    expect(await worker.pollOnce()).toBe(true);

    expect(telemetry).toEqual([
      {
        service: 'worker',
        environment: process.env.NODE_ENV ?? 'development',
        correlationId: failureEvent.idempotencyKey,
        event: 'outbox.failed',
        error: 'Error',
      },
      {
        service: 'worker',
        environment: process.env.NODE_ENV ?? 'development',
        correlationId: successEvent.idempotencyKey,
        event: 'outbox.processed',
      },
    ]);
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: failureEvent.id } })).lastError,
    ).toBe('Error');
    expect(
      (await prisma.validationRun.findUniqueOrThrow({ where: { id: requested.id } })).state,
    ).toBe('SUCCEEDED');
    const serialized = JSON.stringify(telemetry).toLowerCase();
    for (const forbidden of [
      'prompt',
      'question',
      'answer',
      'source text',
      'token',
      'secret',
      'cookie',
      'authorization',
      'auth header',
      'bearer',
      'password',
    ])
      expect(serialized).not.toContain(forbidden);
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
