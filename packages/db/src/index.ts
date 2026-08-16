import { PrismaClient, type Prisma } from '@prisma/client';
import { normalizeEmail } from '@teach/domain';

export const prisma = new PrismaClient();

export async function databaseReady(client: PrismaClient = prisma): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function databaseReadyAt(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await databaseReady(client);
  } finally {
    await client.$disconnect();
  }
}

export async function createPersonalWorkspace(
  input: { email: string; displayName?: string; workspaceName: string },
  client: PrismaClient = prisma,
) {
  const normalizedEmail = normalizeEmail(input.email);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedEmail}, 0))`;
          const user = await tx.user.upsert({
            where: { normalizedEmail },
            update: input.displayName ? { displayName: input.displayName } : {},
            create: {
              normalizedEmail,
              ...(input.displayName ? { displayName: input.displayName } : {}),
            },
          });
          const existing = await tx.membership.findFirst({
            where: { userId: user.id, organization: { workspaceType: 'PERSONAL' } },
            include: { organization: true },
          });
          if (existing) return { user, organization: existing.organization, membership: existing };
          const organization = await tx.organization.create({
            data: { name: input.workspaceName, workspaceType: 'PERSONAL' },
          });
          const membership = await tx.membership.create({
            data: { userId: user.id, organizationId: organization.id, role: 'TEACHER' },
          });
          await tx.auditEvent.create({
            data: {
              actorUserId: user.id,
              organizationId: organization.id,
              eventType: 'workspace.created',
              targetType: 'organization',
              targetId: organization.id,
              metadata: { source: 'phase10' },
            },
          });
          return { user, organization, membership };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
      if (code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('Personal workspace transaction retry exhausted');
}

export async function claimOutbox(client: PrismaClient = prisma, leaseMs = 5_000) {
  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM outbox_events WHERE ((status IN ('PENDING','FAILED') AND available_at <= NOW()) OR (status = 'PROCESSING' AND lease_expires_at <= NOW())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return tx.outboxEvent.update({
      where: { id: row.id },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        lockedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + leaseMs),
      },
    });
  });
}

export async function finishOutbox(id: string, error?: unknown, client: PrismaClient = prisma) {
  if (error)
    return client.outboxEvent.update({
      where: { id },
      data: {
        status: 'FAILED',
        lastError: error instanceof Error ? error.name.slice(0, 500) : 'UnknownError',
        availableAt: new Date(Date.now() + 1000),
        lockedAt: null,
        leaseExpiresAt: null,
      },
    });
  return client.outboxEvent.update({
    where: { id },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      lastError: null,
      lockedAt: null,
      leaseExpiresAt: null,
    },
  });
}
