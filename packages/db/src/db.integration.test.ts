import { afterAll, describe, expect, it } from 'vitest';
import { createPersonalWorkspace, finishOutbox, prisma } from './index.js';

describe('PostgreSQL foundation', () => {
  afterAll(() => prisma.$disconnect());
  it('creates personal workspace idempotently and enforces unique email', async () => {
    const email = `phase10-${Date.now()}@example.test`;
    const [a, b] = await Promise.all([
      createPersonalWorkspace({ email, workspaceName: 'אישי' }),
      createPersonalWorkspace({ email: email.toUpperCase(), workspaceName: 'ignored' }),
    ]);
    expect(b.organization.id).toBe(a.organization.id);
    expect(
      await prisma.organization.count({
        where: { workspaceType: 'PERSONAL', memberships: { some: { userId: a.user.id } } },
      }),
    ).toBe(1);
  });
  it('enforces exactly one active teacher for an active personal organization', async () => {
    const workspace = await createPersonalWorkspace({
      email: `cardinality-${Date.now()}@example.test`,
      workspaceName: 'אישי',
    });
    const other = await prisma.user.create({
      data: { normalizedEmail: `other-${Date.now()}@example.test` },
    });
    await expect(
      prisma.membership.create({
        data: { userId: other.id, organizationId: workspace.organization.id, role: 'TEACHER' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.membership.update({
        where: { id: workspace.membership.id },
        data: { status: 'INACTIVE' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.membership.update({
        where: { id: workspace.membership.id },
        data: { role: 'COORDINATOR' },
      }),
    ).rejects.toThrow();
  });
  it('allows deactivating a personal organization and its member atomically', async () => {
    const workspace = await createPersonalWorkspace({
      email: `deactivate-${Date.now()}@example.test`,
      workspaceName: 'אישי',
    });
    await prisma.$transaction([
      prisma.organization.update({
        where: { id: workspace.organization.id },
        data: { status: 'INACTIVE' },
      }),
      prisma.membership.update({
        where: { id: workspace.membership.id },
        data: { status: 'INACTIVE' },
      }),
    ]);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: workspace.organization.id } }))
        .status,
    ).toBe('INACTIVE');
  });
  it('allows a school organization to have multiple active members', async () => {
    const organization = await prisma.organization.create({
      data: { name: 'School', workspaceType: 'SCHOOL' },
    });
    const users = await Promise.all(
      [1, 2].map((n) =>
        prisma.user.create({ data: { normalizedEmail: `school-${Date.now()}-${n}@example.test` } }),
      ),
    );
    await prisma.membership.createMany({
      data: users.map((user) => ({
        userId: user.id,
        organizationId: organization.id,
        role: 'TEACHER',
      })),
    });
    expect(
      await prisma.membership.count({
        where: { organizationId: organization.id, status: 'ACTIVE' },
      }),
    ).toBe(2);
  });
  it('keeps audit records append-only', async () => {
    const workspace = await createPersonalWorkspace({
      email: `audit-${Date.now()}@example.test`,
      workspaceName: 'audit',
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: workspace.organization.id },
    });
    await expect(
      prisma.auditEvent.update({ where: { id: audit.id }, data: { targetId: 'changed' } }),
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: audit.id } })).rejects.toThrow();
  });
  it('enforces outbox idempotency and retry bookkeeping', async () => {
    const key = `test-${Date.now()}`;
    const event = await prisma.outboxEvent.create({
      data: { eventType: 'phase10.test', payload: {}, idempotencyKey: key },
    });
    await expect(
      prisma.outboxEvent.create({
        data: { eventType: 'phase10.test', payload: {}, idempotencyKey: key },
      }),
    ).rejects.toThrow();
    expect((await finishOutbox(event.id, new Error('safe failure'))).status).toBe('FAILED');
  });
});
