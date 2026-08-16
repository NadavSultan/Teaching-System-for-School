import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, healthSchema, workspaceContextSchema } from '@teach/contracts';
import { createPersonalWorkspace, prisma } from '@teach/db';
import { createApp } from './bootstrap.js';

describe('API foundation', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ADAPTER = 'test';
    app = await createApp();
    await app.init();
  });
  afterAll(() => app.close());
  it('serves independent liveness with correlation and security headers', async () => {
    const result = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'test-request');
    expect(result.status).toBe(200);
    expect(result.headers['x-request-id']).toBe('test-request');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
  });
  it('returns 401 with a versioned error envelope without authentication', async () => {
    const result = await request(app.getHttpServer()).get('/v1/me/workspace');
    expect(result.status).toBe(401);
    expect(apiErrorSchema.parse(result.body).error.code).toBe('UNAUTHENTICATED');
  });
  it('returns a distinct 400 contract for missing organization context', async () => {
    const result = await request(app.getHttpServer())
      .get('/v1/me/workspace')
      .set('x-dev-user-id', '00000000-0000-4000-8000-000000000001');
    expect(result.status).toBe(400);
    expect(apiErrorSchema.parse(result.body).error.code).toBe('BAD_REQUEST');
  });
  it('rejects oversized JSON bodies', async () => {
    const result = await request(app.getHttpServer())
      .post('/missing')
      .set('content-type', 'application/json')
      .send({ text: 'x'.repeat(110_000) });
    expect(result.status).toBe(413);
  });
  it('does not allow arbitrary CORS origins', async () => {
    const result = await request(app.getHttpServer())
      .options('/health/live')
      .set('origin', 'https://evil.example');
    expect(result.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
  it('returns contract-safe unavailable readiness for an invalid database URL', async () => {
    process.env.READINESS_DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:59999/unavailable';
    const result = await request(app.getHttpServer()).get('/health/ready');
    delete process.env.READINESS_DATABASE_URL;
    expect(result.status).toBe(503);
    expect(apiErrorSchema.parse(result.body).error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('database-backed API tenant isolation', () => {
  let app: INestApplication;
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

  it('denies both read and mutation across two tenants in both directions', async () => {
    const stamp = Date.now();
    const a = await createPersonalWorkspace({
      email: `api-a-${stamp}@example.test`,
      workspaceName: 'א',
    });
    const b = await createPersonalWorkspace({
      email: `api-b-${stamp}@example.test`,
      workspaceName: 'ב',
    });
    for (const [actor, target] of [
      [a, b],
      [b, a],
    ] as const) {
      const headers = {
        'x-dev-user-id': actor.user.id,
        'x-dev-user-email': actor.user.normalizedEmail,
        'x-organization-id': target.organization.id,
      };
      expect((await request(app.getHttpServer()).get('/v1/me/workspace').set(headers)).status).toBe(
        404,
      );
      expect(
        (
          await request(app.getHttpServer())
            .patch('/v1/me/workspace')
            .set(headers)
            .send({ name: 'forbidden' })
        ).status,
      ).toBe(404);
    }
  });

  it('returns a valid ready and workspace contract with PostgreSQL available', async () => {
    const workspace = await createPersonalWorkspace({
      email: `ready-${Date.now()}@example.test`,
      workspaceName: 'מוכן',
    });
    expect(
      healthSchema.parse((await request(app.getHttpServer()).get('/health/ready')).body).status,
    ).toBe('ok');
    const response = await request(app.getHttpServer()).get('/v1/me/workspace').set({
      'x-dev-user-id': workspace.user.id,
      'x-dev-user-email': workspace.user.normalizedEmail,
      'x-organization-id': workspace.organization.id,
    });
    expect(response.status).toBe(200);
    expect(workspaceContextSchema.parse(response.body).organization.id).toBe(
      workspace.organization.id,
    );
  });

  it('allows the personal member to rename their own workspace', async () => {
    const workspace = await createPersonalWorkspace({
      email: `rename-personal-${Date.now()}@example.test`,
      workspaceName: 'לפני',
    });
    const response = await request(app.getHttpServer())
      .patch('/v1/me/workspace')
      .set({
        'x-dev-user-id': workspace.user.id,
        'x-dev-user-email': workspace.user.normalizedEmail,
        'x-organization-id': workspace.organization.id,
      })
      .send({ name: 'אחרי' });
    expect(response.status).toBe(200);
    expect(response.body.organization.name).toBe('אחרי');
  });

  it('allows only a school administrator to rename a school workspace', async () => {
    const organization = await prisma.organization.create({
      data: { name: 'School', workspaceType: 'SCHOOL' },
    });
    const roles = ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'] as const;
    const actors = await Promise.all(
      roles.map(async (role) => {
        const user = await prisma.user.create({
          data: { normalizedEmail: `role-${role.toLowerCase()}-${Date.now()}@example.test` },
        });
        await prisma.membership.create({
          data: { userId: user.id, organizationId: organization.id, role },
        });
        return { user, role };
      }),
    );
    for (const actor of actors) {
      const response = await request(app.getHttpServer())
        .patch('/v1/me/workspace')
        .set({
          'x-dev-user-id': actor.user.id,
          'x-dev-user-email': actor.user.normalizedEmail,
          'x-organization-id': organization.id,
        })
        .send({ name: actor.role });
      expect(response.status).toBe(actor.role === 'SCHOOL_ADMIN' ? 200 : 404);
    }
  });

  it('denies inactive membership and insufficient role server-side', async () => {
    const user = await prisma.user.create({
      data: { normalizedEmail: `api-inactive-${Date.now()}@example.test` },
    });
    const organization = await prisma.organization.create({
      data: { name: 'בית ספר', workspaceType: 'SCHOOL' },
    });
    const membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'TEACHER' },
    });
    const headers = {
      'x-dev-user-id': user.id,
      'x-dev-user-email': user.normalizedEmail,
      'x-organization-id': organization.id,
    };
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'INACTIVE' },
    });
    expect((await request(app.getHttpServer()).get('/v1/me/workspace').set(headers)).status).toBe(
      404,
    );
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', role: 'PLATFORM_ADMIN' },
    });
    expect((await request(app.getHttpServer()).get('/v1/me/workspace').set(headers)).status).toBe(
      404,
    );
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', role: 'TEACHER' },
    });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    expect((await request(app.getHttpServer()).get('/v1/me/workspace').set(headers)).status).toBe(
      404,
    );
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    await prisma.organization.update({
      where: { id: organization.id },
      data: { status: 'INACTIVE' },
    });
    expect((await request(app.getHttpServer()).get('/v1/me/workspace').set(headers)).status).toBe(
      404,
    );
  });
});
