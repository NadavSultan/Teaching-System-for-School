import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { apiErrorSchema, teacherAssessmentCreateResultSchema } from '@teach/contracts';
import { createPersonalWorkspace, prisma } from '@teach/db';
import { createApp } from './bootstrap.js';

describe('Phase 60 teacher workspace transport', () => {
  let app: INestApplication;
  const organizationId = '00000000-0000-4000-8000-000000000010';
  const assessmentId = '00000000-0000-4000-8000-000000000011';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ADAPTER = 'test';
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('O1 rejects absent development identity and malformed list queries before persistence', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .get('/v1/teacher/assessments')
      .set('x-organization-id', organizationId);
    expect(unauthenticated.status).toBe(401);
    expect(apiErrorSchema.parse(unauthenticated.body).error.code).toBe('UNAUTHENTICATED');

    const malformedQuery = await request(app.getHttpServer())
      .get('/v1/teacher/assessments?cursor=valid&unexpected=value')
      .set('x-dev-user-id', '00000000-0000-4000-8000-000000000012')
      .set('x-organization-id', organizationId);
    expect(malformedQuery.status).toBe(400);
    expect(apiErrorSchema.parse(malformedQuery.body).error.message).toBe('Malformed request');
  });

  it('rejects malformed organization and assessment path identifiers', async () => {
    const malformedOrganization = await request(app.getHttpServer())
      .get(`/v1/teacher/assessments/${assessmentId}`)
      .set('x-dev-user-id', '00000000-0000-4000-8000-000000000013')
      .set('x-organization-id', 'not-an-organization-id');
    expect(malformedOrganization.status).toBe(400);
    expect(apiErrorSchema.parse(malformedOrganization.body).error.message).toBe(
      'Malformed request',
    );

    const malformedPath = await request(app.getHttpServer())
      .get('/v1/teacher/assessments/not-an-assessment-id')
      .set('x-dev-user-id', '00000000-0000-4000-8000-000000000014')
      .set('x-organization-id', organizationId);
    expect(malformedPath.status).toBe(400);
    expect(apiErrorSchema.parse(malformedPath.body).error.message).toBe('Malformed request');
  });

  it('O3 maps malformed creation bodies to a redacted transport error', async () => {
    const workspace = await createPersonalWorkspace({
      email: `phase60-api-${Date.now()}@example.test`,
      workspaceName: 'Phase 60 API',
    });
    const response = await request(app.getHttpServer())
      .post('/v1/teacher/assessments')
      .set('x-dev-user-id', workspace.user.id)
      .set('x-dev-user-email', workspace.user.normalizedEmail)
      .set('x-organization-id', workspace.organization.id)
      .send({ unexpected: 'internal-only-input' });
    const error = apiErrorSchema.parse(response.body).error;

    expect(response.status).toBe(400);
    expect(error.message).toBe('Malformed request');
    expect(JSON.stringify(response.body)).not.toContain('ZodError');
    expect(JSON.stringify(response.body)).not.toContain('internal-only-input');

    const created = await request(app.getHttpServer())
      .post('/v1/teacher/assessments')
      .set('x-dev-user-id', workspace.user.id)
      .set('x-dev-user-email', workspace.user.normalizedEmail)
      .set('x-organization-id', workspace.organization.id)
      .send({ version: '1.0.0', type: 'WORKSHEET', title: 'הערכה שמורה' });
    const createdContract = teacherAssessmentCreateResultSchema.parse(created.body);
    expect(created.status).toBe(201);
    expect(createdContract).toMatchObject({
      type: 'WORKSHEET',
      title: 'הערכה שמורה',
      latestRevisionId: null,
      latestApprovalRevisionId: null,
    });
  });

  it('D10 captures API logger success and failure events without protected content', async () => {
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const line = args
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      if (line.includes('"service":"api"')) captured.push(line);
    };
    try {
      await request(app.getHttpServer())
        .get('/health/live')
        .set('x-request-id', 'phase60-d10-success');
      await request(app.getHttpServer())
        .get('/v1/teacher/assessments/not-an-id')
        .set('x-dev-user-id', '00000000-0000-4000-8000-000000000015')
        .set('x-organization-id', organizationId);
    } finally {
      console.log = originalLog;
    }
    const events = captured.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service: 'api',
          event: 'http.completed',
          status: 200,
          correlationId: 'phase60-d10-success',
        }),
        expect.objectContaining({ service: 'api', event: 'http.completed', status: 400 }),
      ]),
    );
    const serialized = JSON.stringify(events).toLowerCase();
    for (const forbidden of [
      'prompt',
      'answer',
      'source text',
      'token',
      'secret',
      'cookie',
      'authorization',
      'password',
    ])
      expect(serialized).not.toContain(forbidden);
  });
});
