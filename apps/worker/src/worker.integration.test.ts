import { afterAll, describe, expect, it } from 'vitest';
import { claimOutbox, prisma } from '@teach/db';
import { OutboxWorker } from './worker.js';

describe('single-worker outbox', () => {
  afterAll(() => prisma.$disconnect());
  it('claims and idempotently publishes a no-op event', async () => {
    const event = await prisma.outboxEvent.create({
      data: { eventType: 'phase10.noop', payload: {}, idempotencyKey: `worker-${Date.now()}` },
    });
    await prisma.outboxEvent.updateMany({
      where: { status: 'PENDING', id: { not: event.id } },
      data: { availableAt: new Date(Date.now() + 60_000) },
    });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date() } });
    const worker = new OutboxWorker(() => undefined);
    expect(await worker.pollOnce()).toBe(true);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'PUBLISHED',
    );
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).attemptCount,
    ).toBe(1);
  });
  it('records safe handler failure, delays retry, then publishes exactly once', async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        eventType: 'phase10.fail',
        payload: { secret: 'never logged' },
        idempotencyKey: `failure-${Date.now()}`,
      },
    });
    await prisma.outboxEvent.updateMany({
      where: { status: 'PENDING', id: { not: event.id } },
      data: { availableAt: new Date(Date.now() + 60_000) },
    });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date() } });
    const failing = new OutboxWorker(
      () => undefined,
      async () => {
        throw new Error('credential=secret');
      },
    );
    expect(await failing.pollOnce()).toBe(true);
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.attemptCount).toBe(1);
    expect(failed.lastError).toBe('Error');
    expect(failed.lastError).not.toContain('secret');
    expect(await claimOutbox()).toBeNull();
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { availableAt: new Date(0) },
    });
    const succeeding = new OutboxWorker(
      () => undefined,
      async () => undefined,
    );
    expect(await succeeding.pollOnce()).toBe(true);
    const published = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(published.status).toBe('PUBLISHED');
    expect(published.attemptCount).toBe(2);
    expect(await succeeding.pollOnce()).toBe(false);
  });
  it('does not reclaim an active lease and recovers stale PROCESSING work', async () => {
    const event = await prisma.outboxEvent.create({
      data: { eventType: 'phase10.lease', payload: {}, idempotencyKey: `lease-${Date.now()}` },
    });
    await prisma.outboxEvent.updateMany({
      where: { status: 'PENDING', id: { not: event.id } },
      data: { availableAt: new Date(Date.now() + 60_000) },
    });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date() } });
    expect((await claimOutbox(prisma, 60_000))?.id).toBe(event.id);
    expect(await claimOutbox()).toBeNull();
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const worker = new OutboxWorker(
      () => undefined,
      async () => undefined,
    );
    expect(await worker.pollOnce()).toBe(true);
    const recovered = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(recovered.status).toBe('PUBLISHED');
    expect(recovered.attemptCount).toBe(2);
  });
});
