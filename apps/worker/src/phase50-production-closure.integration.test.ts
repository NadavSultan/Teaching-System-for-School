import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@teach/db';
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
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'validation.requested',
        payload: { validationRunId: crypto.randomUUID() },
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
  });
});
