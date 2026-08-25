import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from '@teach/ai';
import { phase40AcceptanceRegistry } from './phase40.acceptance.registry.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import {
  getGenerationResult,
  getGenerationStatus,
  prisma,
  processGenerationRun,
  requestQuestionRegeneration,
} from './index.js';

const roles = ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN'] as const;
describe('R — persisted role happy paths', () => {
  it.each(phase40AcceptanceRegistry.R)(
    '%s executes the real persisted role operation',
    async (caseId) => {
      const [role, operation] = caseId.split(':') as [(typeof roles)[number], string];
      expect(roles).toContain(role);
      const fixture = await createGenerationFixture({ role });
      const initial = await prisma.generationRun.findUniqueOrThrow({
        where: { id: fixture.generationRunId },
      });
      expect(initial.state).toBe('PENDING');
      if (operation === 'request') expect(initial.id).toBe(fixture.generationRunId);
      if (operation === 'process') {
        const result = await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        expect(result?.state).toBe('SUCCEEDED');
        expect(result?.outputRevisionId).toBeTruthy();
      }
      if (operation === 'status') {
        const result = await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        expect((await getGenerationStatus(fixture.context, fixture.generationRunId))?.state).toBe(
          result?.state,
        );
      }
      if (operation === 'result' || operation === 'provenance') {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const result = await getGenerationResult(fixture.context, fixture.generationRunId);
        expect(result?.status.state).toBe('SUCCEEDED');
        expect(result?.context.length).toBeGreaterThan(0);
        expect(result?.revision).toBeTruthy();
        if (!result?.revision) throw new Error('missing revision');
      }
      if (
        operation === 'regeneration-request' ||
        operation === 'regeneration-process' ||
        operation === 'regeneration-result'
      ) {
        await processGenerationRun(
          fixture.generationRunId,
          prisma,
          new DeterministicFakeModelGateway(),
        );
        const result = await getGenerationResult(fixture.context, fixture.generationRunId);
        const question = result?.revision?.sections[0]?.questions[0];
        expect(question).toBeTruthy();
        if (!result?.revision || !question) throw new Error('missing base revision or question');
        const baseRevisionId = result.revision.id;
        const regeneration = await requestQuestionRegeneration(fixture.context, {
          version: '1.0.0',
          assessmentId: fixture.assessmentId,
          baseRevisionId,
          targetQuestionId: question.id,
          idempotencyKey: `regen-${fixture.generationRunId}`,
          instruction: 'נסחו מחדש',
          query: 'שלום',
        });
        if (operation === 'regeneration-request') expect(regeneration.state).toBe('PENDING');
        else {
          const regenerated = await processGenerationRun(
            regeneration.id,
            prisma,
            new DeterministicFakeModelGateway(),
          );
          expect(regenerated?.state).toBe('SUCCEEDED');
          const regeneratedResult = await getGenerationResult(fixture.context, regeneration.id);
          expect(regeneratedResult?.revision?.id).not.toBe(baseRevisionId);
        }
      }
    },
  );
});

describe('S — persisted authorization state denial', () => {
  it.each(phase40AcceptanceRegistry.S)(
    '%s denies the public operation after persisted state mutation',
    async (caseId) => {
      const [state, operation] = caseId.split(':');
      const fixture = await createGenerationFixture();
      const base = await processGenerationRun(
        fixture.generationRunId,
        prisma,
        new DeterministicFakeModelGateway(),
      );
      const baseResult = await getGenerationResult(fixture.context, fixture.generationRunId);
      const baseQuestion = baseResult?.revision?.sections[0]?.questions[0];
      if (!base?.outputRevisionId || !baseQuestion)
        throw new Error('state denial fixture graph missing');
      const countsBefore = await Promise.all([
        prisma.generationRun.count({ where: { organizationId: fixture.context.organizationId } }),
        prisma.outboxEvent.count({ where: { organizationId: fixture.context.organizationId } }),
        prisma.auditEvent.count({ where: { organizationId: fixture.context.organizationId } }),
        prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
      ]);
      if (state === 'inactive-user')
        await prisma.user.update({
          where: { id: fixture.context.principal.userId },
          data: { status: 'INACTIVE' },
        });
      if (state === 'inactive-membership')
        await prisma.membership.update({
          where: {
            userId_organizationId: {
              userId: fixture.context.principal.userId,
              organizationId: fixture.context.organizationId,
            },
          },
          data: { status: 'INACTIVE' },
        });
      if (state === 'inactive-organization')
        await prisma.organization.update({
          where: { id: fixture.context.organizationId },
          data: { status: 'INACTIVE' },
        });
      if (state === 'platform-admin-membership')
        await prisma.membership.update({
          where: {
            userId_organizationId: {
              userId: fixture.context.principal.userId,
              organizationId: fixture.context.organizationId,
            },
          },
          data: { role: 'PLATFORM_ADMIN' },
        });
      if (state === 'missing-membership')
        await prisma.membership.delete({
          where: {
            userId_organizationId: {
              userId: fixture.context.principal.userId,
              organizationId: fixture.context.organizationId,
            },
          },
        });
      const forged =
        state === 'organization-mismatch'
          ? { ...fixture.context, organizationId: '00000000-0000-4000-8000-000000000099' }
          : fixture.context;
      if (operation === 'P1')
        await expect(
          import('./generation.js').then(({ requestDraftGeneration }) =>
            requestDraftGeneration(forged, {
              version: '1.0.0',
              assessmentId: fixture.assessmentId,
              idempotencyKey: `denied-${caseId}`,
              curriculumVersionId: fixture.curriculumVersionId,
              curriculumNodeIds: [fixture.curriculumNodeId],
              scoringMode: 'NONE',
              totalScoreUnits: null,
              query: 'שלום',
              sections: [
                {
                  key: 's1',
                  title: 'קטע',
                  order: 0,
                  scoreUnits: null,
                  questions: [
                    {
                      key: 'q1',
                      order: 0,
                      type: 'OPEN',
                      difficulty: 'LOW',
                      scoreUnits: null,
                      instructions: '',
                      emphasis: '',
                    },
                  ],
                },
              ],
            }),
          ),
        ).rejects.toThrow();
      if (operation === 'P2')
        await expect(
          import('./generation.js').then(({ requestQuestionRegeneration }) =>
            requestQuestionRegeneration(forged, {
              version: '1.0.0',
              assessmentId: fixture.assessmentId,
              baseRevisionId: base.outputRevisionId,
              targetQuestionId: baseQuestion.id,
              idempotencyKey: `denied-r-${caseId}`,
              instruction: 'ניסוח',
              query: 'שלום',
            }),
          ),
        ).rejects.toThrow();
      if (operation === 'P3')
        expect(await getGenerationStatus(forged, fixture.generationRunId)).toBeNull();
      if (operation === 'P4')
        expect(await getGenerationResult(forged, fixture.generationRunId)).toBeNull();
      expect(
        await Promise.all([
          prisma.generationRun.count({ where: { organizationId: fixture.context.organizationId } }),
          prisma.outboxEvent.count({ where: { organizationId: fixture.context.organizationId } }),
          prisma.auditEvent.count({ where: { organizationId: fixture.context.organizationId } }),
          prisma.assessmentRevision.count({ where: { assessmentId: fixture.assessmentId } }),
        ]),
      ).toEqual(countsBefore);
    },
  );
});
afterAll(() => prisma.$disconnect());
