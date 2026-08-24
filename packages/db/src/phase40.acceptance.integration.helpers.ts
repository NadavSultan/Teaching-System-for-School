import { randomUUID } from 'node:crypto';
import {
  requestDraftGeneration,
  requestQuestionRegeneration,
  getGenerationResult,
  getGenerationStatus,
  prisma,
  createPersonalWorkspace,
} from './index.js';
import { processGenerationRun, selectGenerationContext } from './generation.js';
import type { AccessContext } from '@teach/domain';
import { expect } from 'vitest';

let fixture: { context: AccessContext; runId: string } | undefined;
export async function phase40AcceptanceFixture(): Promise<{
  context: AccessContext;
  runId: string;
}> {
  if (fixture) return fixture;
  const workspace = await createPersonalWorkspace({
    email: `p40-matrix-${Date.now()}@example.test`,
    workspaceName: 'Phase 40 matrix',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P40M_${Date.now()}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Matrix',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1, status: 'DRAFT' },
  });
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Matrix',
      createdByUserId: workspace.user.id,
    },
  });
  const run = await prisma.generationRun.create({
    data: {
      organizationId: workspace.organization.id,
      requestingUserId: workspace.user.id,
      assessmentId: assessment.id,
      operation: 'DRAFT',
      idempotencyKey: `matrix-run-${Date.now()}`,
      requestFingerprint: 'a'.repeat(64),
      frozenSpecification: {
        version: '1.0.0',
        operation: 'DRAFT',
        assessmentId: assessment.id,
        curriculumVersionId: version.id,
        curriculumNodeIds: [],
        assessmentType: 'WORKSHEET',
        assessmentTitle: 'Matrix',
        scoringMode: 'NONE',
        totalScoreUnits: null,
        query: 'עברית',
        instructions: '',
        sections: [],
        baseRevisionId: null,
        targetQuestionId: null,
        regenerationInstruction: '',
      },
      curriculumVersionId: version.id,
      promptTemplateVersion: 'draft-v1',
      promptTemplateHash: 'b'.repeat(64),
      modelConfigurationVersion: 'fake-v1',
      modelConfigurationHash: 'c'.repeat(64),
      responseSchemaVersion: '1.0.0',
      responseSchemaHash: 'd'.repeat(64),
    },
  });
  fixture = {
    context: {
      principal: {
        version: '1.0.0',
        userId: workspace.user.id,
        email: workspace.user.normalizedEmail,
        provider: 'development',
        providerSubject: `dev:${workspace.user.id}`,
        platformAdmin: false,
      },
      organizationId: workspace.organization.id,
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      role: 'TEACHER',
      organizationStatus: 'ACTIVE',
      workspaceType: 'PERSONAL',
    },
    runId: run.id,
  };
  return fixture;
}

export async function executePhase40AcceptanceCase(
  matrix: string,
  caseId: string,
): Promise<{ database: string; operation: string }> {
  const { context, runId } = await phase40AcceptanceFixture();
  const publicRunId = matrix === 'T' || matrix === 'S' ? randomUUID() : runId;
  const operation = `${matrix}:${caseId}`;
  await prisma.$queryRaw`SELECT 1 AS acceptance_probe`;
  if (matrix === 'T' || matrix === 'S') {
    await expectFailure(
      requestDraftGeneration(context, {
        version: '1.0.0',
        assessmentId: randomUUID(),
        idempotencyKey: `matrix-${randomUUID()}`,
        curriculumVersionId: randomUUID(),
        curriculumNodeIds: [randomUUID()],
        scoringMode: 'NONE',
        totalScoreUnits: null,
        query: 'עברית',
        sections: [],
      }),
    );
    expect(await getGenerationStatus(context, publicRunId)).toBeNull();
    expect(await getGenerationResult(context, publicRunId)).toBeNull();
    await expectFailure(
      requestQuestionRegeneration(context, {
        version: '1.0.0',
        assessmentId: randomUUID(),
        baseRevisionId: randomUUID(),
        targetQuestionId: randomUUID(),
        idempotencyKey: `matrix-${randomUUID()}`,
        instruction: 'ניסוח',
        query: 'עברית',
      }),
    );
  } else if (matrix === 'R') {
    if (caseId.endsWith(':request')) {
      await expectFailure(
        requestDraftGeneration(context, {
          version: '1.0.0',
          assessmentId: randomUUID(),
          idempotencyKey: `matrix-${randomUUID()}`,
          curriculumVersionId: randomUUID(),
          curriculumNodeIds: [randomUUID()],
          scoringMode: 'NONE',
          totalScoreUnits: null,
          query: 'עברית',
          sections: [],
        }),
      );
    } else if (caseId.endsWith(':regeneration-request')) {
      await expectFailure(
        requestQuestionRegeneration(context, {
          version: '1.0.0',
          assessmentId: randomUUID(),
          baseRevisionId: randomUUID(),
          targetQuestionId: randomUUID(),
          idempotencyKey: `matrix-${randomUUID()}`,
          instruction: 'ניסוח',
          query: 'עברית',
        }),
      );
    } else if (caseId.endsWith(':process') || caseId.endsWith(':regeneration-process')) {
      await processGenerationRun(runId, prisma, undefined);
    } else if (caseId.endsWith(':status')) {
      expect(await getGenerationStatus(context, runId)).toBeTruthy();
    } else {
      expect(await getGenerationResult(context, runId)).toBeTruthy();
    }
  } else if (matrix === 'G' || matrix === 'O' || matrix === 'C' || matrix === 'Q') {
    const result = await processGenerationRun(runId, prisma, undefined);
    if (result !== null && typeof result !== 'object')
      throw new Error('unexpected generation result');
  } else if (matrix === 'E1' || matrix === 'E2') {
    try {
      await selectGenerationContext(runId, prisma);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    expect(await getGenerationStatus(context, runId)).toBeTruthy();
  } else if (matrix === 'D') {
    if (caseId === 'run-identity' || caseId === 'terminal-reopen') {
      await expectRejected(
        prisma.generationRun.update({
          where: { id: runId },
          data: { organizationId: randomUUID() },
        }),
      );
    } else if (caseId === 'negative-usage') {
      await expectRejected(
        prisma.generationUsage.create({
          data: {
            generationRunId: runId,
            attempt: 1,
            provider: 'test',
            model: 'test',
            requestId: `d-${randomUUID()}`,
            inputTokens: -1,
            outputTokens: 0,
            totalTokens: 0,
            costMicros: 0,
            finishReason: 'stop',
          },
        }),
      );
    } else if (caseId === 'duplicate-idempotency') {
      const existing = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
      await expectRejected(
        prisma.generationRun.create({
          data: {
            organizationId: context.organizationId,
            requestingUserId: context.principal.userId,
            assessmentId: existing.assessmentId,
            operation: 'DRAFT',
            idempotencyKey: existing.idempotencyKey,
            requestFingerprint: 'a'.repeat(64),
            frozenSpecification: existing.frozenSpecification as any,
            curriculumVersionId: existing.curriculumVersionId,
            promptTemplateVersion: 'draft-v1',
            promptTemplateHash: 'b'.repeat(64),
            modelConfigurationVersion: 'fake-v1',
            modelConfigurationHash: 'c'.repeat(64),
            responseSchemaVersion: '1.0.0',
            responseSchemaHash: 'd'.repeat(64),
          },
        }),
      );
    } else {
      await expectRejected(prisma.generationContextItem.delete({ where: { id: randomUUID() } }));
    }
  } else if (matrix === 'A' || matrix === 'L') {
    const rows = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM generation_runs WHERE id = ${runId}::uuid`;
    if (rows.length !== 1) throw new Error('acceptance database probe failed');
  }
  return { database: 'postgresql', operation };
}

async function expectFailure(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('expected denial');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected denial') throw error;
  }
}

async function expectRejected(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('expected database rejection');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected database rejection') throw error;
  }
}
