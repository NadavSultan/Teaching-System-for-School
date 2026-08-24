import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersonalWorkspace, prisma } from './index.js';

describe('Phase 40 direct database adversarial matrix', () => {
  let workspace: Awaited<ReturnType<typeof createPersonalWorkspace>>;
  let assessmentId: string;
  let curriculumVersionId: string;

  beforeAll(async () => {
    workspace = await createPersonalWorkspace({
      email: `p40-adv-${Date.now()}@example.test`,
      workspaceName: 'P40 adversarial',
    });
    const curriculum = await prisma.curriculum.create({
      data: {
        code: `P40A_${Date.now()}`,
        educationSystemCode: 'IL',
        subjectCode: 'HE',
        displayName: 'P40A',
      },
    });
    const version = await prisma.curriculumVersion.create({
      data: { curriculumId: curriculum.id, versionNumber: 1, status: 'DRAFT' },
    });
    curriculumVersionId = version.id;
    const assessment = await prisma.assessment.create({
      data: {
        organizationId: workspace.organization.id,
        type: 'WORKSHEET',
        title: 'Adversarial',
        createdByUserId: workspace.user.id,
      },
    });
    assessmentId = assessment.id;
  });
  afterAll(() => prisma.$disconnect());

  async function run() {
    return prisma.generationRun.create({
      data: {
        organizationId: workspace.organization.id,
        requestingUserId: workspace.user.id,
        assessmentId,
        operation: 'DRAFT',
        idempotencyKey: `adv-${Date.now()}-${Math.random()}`,
        requestFingerprint: 'a'.repeat(64),
        frozenSpecification: { version: '1.0.0', operation: 'DRAFT' },
        curriculumVersionId,
        promptTemplateVersion: 'draft-v1',
        promptTemplateHash: 'b'.repeat(64),
        modelConfigurationVersion: 'fake-v1',
        modelConfigurationHash: 'c'.repeat(64),
        responseSchemaVersion: '1.0.0',
        responseSchemaHash: 'd'.repeat(64),
      },
    });
  }
  async function unchanged(id: string, operation: (id: string) => Promise<unknown>) {
    const before = await prisma.generationRun.findUniqueOrThrow({ where: { id } });
    await expect(operation(id)).rejects.toThrow();
    const after = await prisma.generationRun.findUniqueOrThrow({ where: { id } });
    expect(after).toEqual(before);
  }

  const cases: Array<[string, (id: string) => Promise<unknown>]> = [
    [
      'organization identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { organizationId: '00000000-0000-4000-8000-000000000001' },
        }),
    ],
    [
      'requesting user identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { requestingUserId: '00000000-0000-4000-8000-000000000002' },
        }),
    ],
    [
      'assessment identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { assessmentId: '00000000-0000-4000-8000-000000000003' },
        }),
    ],
    [
      'operation identity',
      (id) =>
        prisma.generationRun.update({ where: { id }, data: { operation: 'REGENERATE_QUESTION' } }),
    ],
    [
      'idempotency identity',
      (id) => prisma.generationRun.update({ where: { id }, data: { idempotencyKey: 'forged' } }),
    ],
    [
      'fingerprint identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { requestFingerprint: 'e'.repeat(64) },
        }),
    ],
    [
      'specification identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { frozenSpecification: { forged: true } },
        }),
    ],
    [
      'curriculum identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { curriculumVersionId: '00000000-0000-4000-8000-000000000004' },
        }),
    ],
    [
      'prompt identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { promptTemplateHash: 'f'.repeat(64) },
        }),
    ],
    [
      'model identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { modelConfigurationHash: 'f'.repeat(64) },
        }),
    ],
    [
      'response schema identity',
      (id) =>
        prisma.generationRun.update({
          where: { id },
          data: { responseSchemaHash: 'f'.repeat(64) },
        }),
    ],
    [
      'terminal reopen',
      async (id) => {
        await prisma.generationRun.update({
          where: { id },
          data: { state: 'PROCESSING', attempts: 1 },
        });
        await prisma.generationRun.update({
          where: { id },
          data: { state: 'FAILED', failureCode: 'PERMANENT_PROVIDER_ERROR' },
        });
        return prisma.generationRun.update({ where: { id }, data: { state: 'PENDING' } });
      },
    ],
    [
      'same state transition',
      (id) => prisma.generationRun.update({ where: { id }, data: { state: 'PENDING' } }),
    ],
    [
      'invalid transition',
      async (id) => {
        await prisma.generationRun.update({
          where: { id },
          data: { state: 'PROCESSING', attempts: 1 },
        });
        return prisma.generationRun.update({
          where: { id },
          data: { state: 'SUCCEEDED', processedAt: new Date() },
        });
      },
    ],
    [
      'negative usage',
      async (id) => {
        await prisma.generationRun.update({
          where: { id },
          data: { state: 'PROCESSING', attempts: 1 },
        });
        return prisma.generationUsage.create({
          data: {
            generationRunId: id,
            attempt: 1,
            provider: 'fake',
            model: 'fake',
            requestId: `adv-${id}`,
            inputTokens: -1,
            outputTokens: 0,
            totalTokens: 0,
            costMicros: 0,
            finishReason: 'stop',
          },
        });
      },
    ],
    [
      'usage total mismatch',
      async (id) => {
        await prisma.generationRun.update({
          where: { id },
          data: { state: 'PROCESSING', attempts: 1 },
        });
        return prisma.generationUsage.create({
          data: {
            generationRunId: id,
            attempt: 1,
            provider: 'fake',
            model: 'fake',
            requestId: `adv-${id}`,
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 9,
            costMicros: 0,
            finishReason: 'stop',
          },
        });
      },
    ],
    [
      'duplicate usage attempt',
      async (id) => {
        await prisma.generationRun.update({
          where: { id },
          data: { state: 'PROCESSING', attempts: 1 },
        });
        const data = {
          generationRunId: id,
          attempt: 1,
          provider: 'fake',
          model: 'fake',
          requestId: `adv-${id}`,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costMicros: 0,
          finishReason: 'stop',
        };
        await prisma.generationUsage.create({ data });
        return prisma.generationUsage.create({ data });
      },
    ],
    [
      'context forged item',
      (id) =>
        prisma.generationContextItem.create({
          data: {
            generationRunId: id,
            selectedOrder: 0,
            knowledgeItemId: '00000000-0000-4000-8000-000000000005',
            sourceVersionId: '00000000-0000-4000-8000-000000000006',
            locator: 'forged',
            textHash: 'a'.repeat(64),
            curriculumVersionId,
            curriculumNodeId: '00000000-0000-4000-8000-000000000007',
            rank: 1,
            score: 1,
            characterCount: 1,
            estimatedTokens: 1,
            lineage: [
              { curriculumVersionId, curriculumNodeId: '00000000-0000-4000-8000-000000000007' },
            ],
          },
        }),
    ],
    [
      'context duplicate order',
      async (id) => {
        const data = {
          generationRunId: id,
          selectedOrder: 0,
          knowledgeItemId: '00000000-0000-4000-8000-000000000005',
          sourceVersionId: '00000000-0000-4000-8000-000000000006',
          locator: 'forged',
          textHash: 'a'.repeat(64),
          curriculumVersionId,
          curriculumNodeId: '00000000-0000-4000-8000-000000000007',
          rank: 1,
          score: 1,
          characterCount: 1,
          estimatedTokens: 1,
          lineage: [
            { curriculumVersionId, curriculumNodeId: '00000000-0000-4000-8000-000000000007' },
          ],
        };
        await prisma.generationContextItem.create({ data });
        return prisma.generationContextItem.create({ data });
      },
    ],
    [
      'question source forged identity',
      (id) =>
        prisma.questionSourceLink.create({
          data: {
            generationRunId: id,
            assessmentQuestionId: '00000000-0000-4000-8000-000000000008',
            knowledgeItemId: '00000000-0000-4000-8000-000000000005',
            sourceVersionId: '00000000-0000-4000-8000-000000000006',
            locator: 'forged',
            textHash: 'a'.repeat(64),
            curriculumVersionId,
            curriculumNodeId: '00000000-0000-4000-8000-000000000007',
            lineage: 'GENERATED',
          },
        }),
    ],
    ['run deletion', (id) => prisma.generationRun.delete({ where: { id } })],
  ];

  it.each(cases)('%s rejects and preserves state', async (name, operation) => {
    const row = await run();
    if (
      [
        'terminal reopen',
        'invalid transition',
        'negative usage',
        'usage total mismatch',
        'duplicate usage attempt',
      ].includes(name)
    ) {
      await expect(operation(row.id)).rejects.toThrow();
      const after = await prisma.generationRun.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.attempts).toBe(1);
      expect(after.state).toBe(name === 'terminal reopen' ? 'FAILED' : 'PROCESSING');
    } else {
      await unchanged(row.id, operation);
    }
  });
});
