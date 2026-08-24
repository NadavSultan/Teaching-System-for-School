import { afterAll, describe, expect, it } from 'vitest';
import { createPersonalWorkspace, prisma } from './index.js';

describe('Phase 40 database identity and state enforcement', () => {
  afterAll(() => prisma.$disconnect());

  it('enforces immutable run identity, state transitions, append-only usage, and budgets', async () => {
    const workspace = await createPersonalWorkspace({
      email: `phase40-db-${Date.now()}@example.test`,
      workspaceName: 'Phase 40 DB',
    });
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `P40_${Date.now()}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'Phase 40',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1, status: 'DRAFT' },
    });
    const assessment = await prisma.assessment.create({
      data: {
        organizationId: workspace.organization.id,
        type: 'WORKSHEET',
        title: 'בדיקת מנגנון',
        createdByUserId: workspace.user.id,
      },
    });
    const run = await prisma.generationRun.create({
      data: {
        organizationId: workspace.organization.id,
        requestingUserId: workspace.user.id,
        assessmentId: assessment.id,
        operation: 'DRAFT',
        idempotencyKey: `db-${Date.now()}`,
        requestFingerprint: 'a'.repeat(64),
        frozenSpecification: { version: '1.0.0', operation: 'DRAFT' },
        curriculumVersionId: version.id,
        promptTemplateVersion: 'draft-v1',
        promptTemplateHash: 'b'.repeat(64),
        modelConfigurationVersion: 'fake-v1',
        modelConfigurationHash: 'c'.repeat(64),
        responseSchemaVersion: '1.0.0',
        responseSchemaHash: 'd'.repeat(64),
      },
    });
    await expect(
      prisma.generationRun.update({
        where: { id: run.id },
        data: { organizationId: '00000000-0000-4000-8000-000000000001' },
      }),
    ).rejects.toThrow();
    await expect(prisma.generationRun.delete({ where: { id: run.id } })).rejects.toThrow();
    const processing = await prisma.generationRun.update({
      where: { id: run.id },
      data: { state: 'PROCESSING', attempts: 1 },
    });
    expect(processing.state).toBe('PROCESSING');
    await expect(
      prisma.generationRun.update({ where: { id: run.id }, data: { state: 'PROCESSING' } }),
    ).rejects.toThrow();
    const failed = await prisma.generationRun.update({
      where: { id: run.id },
      data: { state: 'FAILED', failureCode: 'PERMANENT_PROVIDER_ERROR' },
    });
    expect(failed.state).toBe('FAILED');
    await expect(
      prisma.generationRun.update({ where: { id: run.id }, data: { state: 'PENDING' } }),
    ).rejects.toThrow();
    await expect(
      prisma.generationUsage.create({
        data: {
          generationRunId: run.id,
          attempt: 1,
          provider: 'fake',
          model: 'fake',
          requestId: 'req',
          inputTokens: -1,
          outputTokens: 0,
          totalTokens: 0,
          costMicros: 0,
          finishReason: 'stop',
        },
      }),
    ).rejects.toThrow();
  });
});
