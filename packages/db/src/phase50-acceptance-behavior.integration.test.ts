import { afterAll, describe, expect, it } from 'vitest';
import { DeterministicFakeSemanticEvaluator } from '@teach/ai';
import type { AccessContext } from '@teach/domain';
import {
  acknowledgeSemanticWarning,
  assertRevisionApprovable,
  createAssessmentRevision,
  createPersonalWorkspace,
  getRevisionValidationReadiness,
  getValidationResult,
  getValidationStatus,
  prisma,
  processValidationRun,
  publishCurriculumVersion,
  requestRevisionValidation,
  resolveAccessContext,
} from './index.js';

const denied = 'Resource not found or unavailable';
const principal = (userId: string) => ({
  version: '1.0.0' as const,
  userId,
  email: `phase50-${userId}@example.test`,
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture(role: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN' = 'TEACHER') {
  const suffix = crypto.randomUUID();
  const personal = await createPersonalWorkspace({
    email: `phase50-behavior-${suffix}@example.test`,
    workspaceName: `Phase 50 ${suffix}`,
  });
  const organization = await prisma.organization.create({
    data: { name: `Phase 50 school ${suffix}`, workspaceType: 'SCHOOL' },
  });
  const membership = await prisma.membership.create({
    data: { userId: personal.user.id, organizationId: organization.id, role },
  });
  const workspace = { ...personal, organization, membership };
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P50B-${suffix}`,
      educationSystemCode: 'IL',
      subjectCode: 'MATH',
      displayName: 'Phase 50 behavioral evidence',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1 },
  });
  const node = await prisma.curriculumNode.create({
    data: { versionId: version.id, type: 'GRADE', code: 'G1', label: 'Grade 1', sortOrder: 1 },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Phase 50 behavioral evidence',
      createdByUserId: workspace.user.id,
    },
  });
  const context = await resolveAccessContext(
    principal(workspace.user.id),
    workspace.organization.id,
  );
  const revision = await createAssessmentRevision(context, {
    version: '1.0.0',
    assessmentId: assessment.id,
    idempotencyKey: `revision-${suffix}`,
    curriculumVersionId: version.id,
    curriculumNodeIds: [node.id],
    scoringMode: 'NONE',
    sections: [
      {
        key: 's1',
        title: 'Section',
        order: 0,
        questions: [
          {
            key: 'q1',
            type: 'SHORT_TEXT',
            prompt: 'Question',
            order: 0,
            answers: [{ key: 'a1', order: 0, text: 'Answer' }],
            rubrics: [],
            subQuestions: [],
          },
        ],
      },
    ],
  });
  return { workspace, assessment, revision, context };
}

const validationInput = (f: Awaited<ReturnType<typeof fixture>>, key = crypto.randomUUID()) => ({
  version: '1.0.0' as const,
  assessmentId: f.assessment.id,
  assessmentRevisionId: f.revision.id,
  idempotencyKey: key,
});

type SemanticFindingFixture = Readonly<{
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  path?: string;
}>;

async function processedFixture(
  role: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN' = 'TEACHER',
  semanticFindings: readonly SemanticFindingFixture[] = [],
) {
  const f = await fixture(role);
  const requested = await requestRevisionValidation(f.context, validationInput(f));
  const completed = await processValidationRun(
    requested.id,
    prisma,
    new DeterministicFakeSemanticEvaluator(undefined, async (input) => ({
      version: '1.0.0',
      evaluatorVersion: 'local-disabled-v1',
      promptVersion: 'validation-prompt-v1',
      modelConfigurationVersion: 'local-none-v1',
      schemaVersion: '1.0.0',
      revisionId: input.revisionId,
      findings: semanticFindings.map(({ severity, path }, index) => {
        const category = severity === 'INFO' ? 'DIFFICULTY_FIT' : 'AMBIGUITY';
        const code = `${category}_V1`;
        return {
          code,
          category,
          severity,
          path: path ?? `semantic-${index}`,
          messageKey: `semantic.${category.toLowerCase()}`,
          evidence: { identity: code, revisionId: input.revisionId },
        };
      }),
    })),
  );
  expect(completed?.state).toBe('SUCCEEDED');
  return { ...f, run: requested };
}

async function semanticFinding(
  f: Awaited<ReturnType<typeof processedFixture>>,
  severity: 'BLOCKING' | 'WARNING' | 'INFO',
  path?: string,
) {
  return prisma.validationFinding.findFirstOrThrow({
    where: {
      validationRunId: f.run.id,
      kind: 'SEMANTIC',
      severity,
      ...(path ? { path } : {}),
    },
  });
}

async function completePersistedRun(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    sequence?: number;
    kind?: 'DETERMINISTIC' | 'SEMANTIC';
    severity?: 'BLOCKING' | 'WARNING' | 'INFO';
    key?: string;
    terminal?: boolean;
  } = {},
) {
  const run = await prisma.validationRun.create({
    data: {
      organizationId: f.workspace.organization.id,
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      requestingUserId: f.workspace.user.id,
      rulesetVersion: 'v1',
      evaluatorVersion: 'local-disabled-v1',
      revisionSequence: options.sequence ?? 1,
      idempotencyKey: options.key ?? crypto.randomUUID(),
      requestFingerprint: 'a'.repeat(64),
    },
  });
  await prisma.validationRun.update({
    where: { id: run.id },
    data: {
      state: 'PROCESSING',
      attempts: 1,
      processingStartedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  const rules = await prisma.validationRuleDefinition.findMany({
    where: { rulesetVersion: 'v1' },
    orderBy: { deterministicOrder: 'asc' },
  });
  const deterministicFailure = options.kind === 'DETERMINISTIC';
  const executions = [];
  for (const [index, rule] of rules.entries())
    executions.push(
      await prisma.validationRuleExecution.create({
        data: {
          validationRunId: run.id,
          ruleDefinitionId: rule.id,
          outcome: deterministicFailure && index === 0 ? 'FAIL' : 'PASS',
          evidence: { identity: rule.ruleId, revisionId: f.revision.id },
        },
      }),
    );
  const evaluation = await prisma.semanticEvaluation.create({
    data: {
      validationRunId: run.id,
      evaluatorVersion: 'local-disabled-v1',
      promptVersion: 'validation-prompt-v1',
      modelConfigurationVersion: 'local-none-v1',
      schemaVersion: '1.0.0',
      state: 'SUCCEEDED',
      latencyMs: 0,
    },
  });
  let findingId: string | null = null;
  if (options.kind === 'DETERMINISTIC') {
    const rule = rules[0]!;
    findingId = (
      await prisma.validationFinding.create({
        data: {
          organizationId: f.workspace.organization.id,
          validationRunId: run.id,
          assessmentRevisionId: f.revision.id,
          executionId: executions[0]!.id,
          kind: 'DETERMINISTIC',
          code: rule.ruleId,
          category: rule.category,
          severity: 'BLOCKING',
          path: 'revision',
          messageKey: `${rule.ruleId}_FAILED`,
          evidence: { identity: rule.ruleId, revisionId: f.revision.id },
          ruleVersion: rule.ruleVersion,
        },
      })
    ).id;
  } else if (options.kind === 'SEMANTIC') {
    const severity = options.severity ?? 'WARNING';
    const category = severity === 'INFO' ? 'DIFFICULTY_FIT' : 'AMBIGUITY';
    const code = `${category}_V1`;
    findingId = (
      await prisma.validationFinding.create({
        data: {
          organizationId: f.workspace.organization.id,
          validationRunId: run.id,
          assessmentRevisionId: f.revision.id,
          semanticEvaluationId: evaluation.id,
          kind: 'SEMANTIC',
          code,
          category,
          severity,
          path: 'question.q1',
          messageKey: `semantic.${category.toLowerCase()}`,
          evidence: { identity: code, revisionId: f.revision.id },
          evaluatorVersion: 'local-disabled-v1',
        },
      })
    ).id;
  }
  if (options.terminal !== false)
    await prisma.validationRun.update({
      where: { id: run.id },
      data: {
        state: 'SUCCEEDED',
        completedAt: new Date(),
        leaseExpiresAt: null,
        deterministicPassCount: deterministicFailure ? 10 : 11,
        deterministicFailCount: deterministicFailure ? 1 : 0,
        semanticFindingCount: options.kind === 'SEMANTIC' ? 1 : 0,
      },
    });
  return { run, rules, executions, evaluation, findingId };
}

async function expectDenied(operation: () => Promise<unknown>) {
  await expect(operation()).rejects.toThrow(denied);
}

function databaseError(error: unknown) {
  const value = error as {
    code?: string;
    meta?: { code?: string; message?: string };
    message?: string;
  };
  const raw = value.meta?.message ?? value.message ?? '';
  return {
    code:
      value.meta?.code ??
      raw.match(/Code:\s*`?([A-Z0-9]{5})/)?.[1] ??
      raw.match(/code:\s*"([A-Z0-9]{5})"/)?.[1] ??
      raw.match(/(P\d{4}|23505)/)?.[1] ??
      value.code,
    message:
      raw.match(/Message:\s*`(?:ERROR:\s*)?([^`]+)`/)?.[1] ??
      raw.match(/message:\s*"([^"]+)"/)?.[1] ??
      raw.replace(/^ERROR:\s*/, '').trim(),
  };
}

describe('Phase 50 persisted warning acknowledgement matrix', () => {
  afterAll(() => prisma.$disconnect());

  it('W01 persists exactly one owned semantic WARNING acknowledgement with actor identity', async () => {
    const f = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const finding = await semanticFinding(f, 'WARNING');
    const acknowledgement = await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: finding.id,
      reason: 'Reviewed warning',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(acknowledgement).toMatchObject({
      findingId: finding.id,
      actorUserId: f.workspace.user.id,
      organizationId: f.workspace.organization.id,
      reason: 'Reviewed warning',
    });
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(1);
  });

  it('W02 returns the same acknowledgement ID for an exact persisted retry', async () => {
    const f = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const finding = await semanticFinding(f, 'WARNING');
    const input = {
      version: '1.0.0' as const,
      findingId: finding.id,
      reason: 'Exact retry',
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await acknowledgeSemanticWarning(f.context, input);
    const replay = await acknowledgeSemanticWarning(f.context, input);
    expect(replay.id).toBe(first.id);
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(1);
  });

  it('W03 rejects a reused acknowledgement key with a conflicting finding/reason hash', async () => {
    const f = await processedFixture('TEACHER', [
      { severity: 'WARNING', path: 'warning.first' },
      { severity: 'WARNING', path: 'warning.second' },
    ]);
    const firstFinding = await semanticFinding(f, 'WARNING', 'warning.first');
    const secondFinding = await semanticFinding(f, 'WARNING', 'warning.second');
    const key = crypto.randomUUID();
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: firstFinding.id,
      reason: 'first reason',
      idempotencyKey: key,
    });
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: secondFinding.id,
        reason: 'conflicting reason',
        idempotencyKey: key,
      }),
    ).rejects.toThrow('Idempotency key was already used with different content');
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { idempotencyKey: key } }),
    ).toBe(1);
  });

  it('W04 rejects a persisted deterministic finding without acknowledgement or audit', async () => {
    const f = await processedFixture();
    const finding = await prisma.validationFinding.findFirstOrThrow({
      where: { validationRunId: f.run.id, kind: 'DETERMINISTIC' },
    });
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'illegal override',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow('Validation finding is not acknowledgeable');
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(0);
  });

  it('W05 rejects a persisted semantic BLOCKING finding', async () => {
    const f = await processedFixture('TEACHER', [{ severity: 'BLOCKING' }]);
    const finding = await semanticFinding(f, 'BLOCKING');
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'illegal blocker override',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow('Validation finding is not acknowledgeable');
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(0);
  });

  it('W06 rejects a persisted semantic INFO finding', async () => {
    const f = await processedFixture('TEACHER', [{ severity: 'INFO' }]);
    const finding = await semanticFinding(f, 'INFO');
    await expect(
      acknowledgeSemanticWarning(f.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'info does not require acknowledgement',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow('Validation finding is not acknowledgeable');
    expect(
      await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
    ).toBe(0);
  });

  it('W07 rejects foreign-tenant warnings non-disclosingly in both directions', async () => {
    const a = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const b = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const warningA = await semanticFinding(a, 'WARNING');
    const warningB = await semanticFinding(b, 'WARNING');
    await expectDenied(() =>
      acknowledgeSemanticWarning(a.context, {
        version: '1.0.0',
        findingId: warningB.id,
        reason: 'foreign B',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await expectDenied(() =>
      acknowledgeSemanticWarning(b.context, {
        version: '1.0.0',
        findingId: warningA.id,
        reason: 'foreign A',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    expect(
      await prisma.validationFindingAcknowledgement.count({
        where: { findingId: { in: [warningA.id, warningB.id] } },
      }),
    ).toBe(0);
  });

  it('W08 denies inactive persisted user, membership, and organization states', async () => {
    for (const target of ['user', 'membership', 'organization'] as const) {
      const f = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
      const finding = await semanticFinding(f, 'WARNING');
      try {
        if (target === 'user')
          await prisma.user.update({
            where: { id: f.workspace.user.id },
            data: { status: 'INACTIVE' },
          });
        if (target === 'membership')
          await prisma.membership.update({
            where: {
              userId_organizationId: {
                userId: f.workspace.user.id,
                organizationId: f.workspace.organization.id,
              },
            },
            data: { status: 'INACTIVE' },
          });
        if (target === 'organization')
          await prisma.organization.update({
            where: { id: f.workspace.organization.id },
            data: { status: 'INACTIVE' },
          });
        await expectDenied(() =>
          acknowledgeSemanticWarning(f.context, {
            version: '1.0.0',
            findingId: finding.id,
            reason: `inactive ${target}`,
            idempotencyKey: crypto.randomUUID(),
          }),
        );
        expect(
          await prisma.validationFindingAcknowledgement.count({ where: { findingId: finding.id } }),
        ).toBe(0);
      } finally {
        if (target === 'user')
          await prisma.user.update({
            where: { id: f.workspace.user.id },
            data: { status: 'ACTIVE' },
          });
        if (target === 'membership')
          await prisma.membership.update({
            where: {
              userId_organizationId: {
                userId: f.workspace.user.id,
                organizationId: f.workspace.organization.id,
              },
            },
            data: { status: 'ACTIVE' },
          });
        if (target === 'organization')
          await prisma.organization.update({
            where: { id: f.workspace.organization.id },
            data: { status: 'ACTIVE' },
          });
      }
    }
  });
});

describe('Phase 50 bidirectional tenant isolation matrix', () => {
  it('T01 rejects organization A requesting validation for B revision without disclosure', async () => {
    const a = await fixture();
    const b = await fixture();
    await expectDenied(() =>
      requestRevisionValidation(a.context, validationInput(b, crypto.randomUUID())),
    );
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: b.revision.id } }),
    ).toBe(0);
  });

  it('T02 rejects organization B requesting validation for A revision without disclosure', async () => {
    const a = await fixture();
    const b = await fixture();
    await expectDenied(() =>
      requestRevisionValidation(b.context, validationInput(a, crypto.randomUUID())),
    );
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: a.revision.id } }),
    ).toBe(0);
  });

  it('T03 returns null when organization A reads B validation status', async () => {
    const a = await fixture();
    const b = await fixture();
    const run = await requestRevisionValidation(b.context, validationInput(b));
    await expect(getValidationStatus(a.context, run.id)).resolves.toBeNull();
  });

  it('T04 returns null when organization B reads A validation status', async () => {
    const a = await fixture();
    const b = await fixture();
    const run = await requestRevisionValidation(a.context, validationInput(a));
    await expect(getValidationStatus(b.context, run.id)).resolves.toBeNull();
  });

  it('T05 returns null when organization A reads B validation result', async () => {
    const a = await fixture();
    const b = await processedFixture();
    await expect(getValidationResult(a.context, b.run.id)).resolves.toBeNull();
  });

  it('T06 returns null when organization B reads A validation result', async () => {
    const a = await processedFixture();
    const b = await fixture();
    await expect(getValidationResult(b.context, a.run.id)).resolves.toBeNull();
  });

  it('T07 rejects organization A acknowledging B warning without disclosure', async () => {
    const a = await fixture();
    const b = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const finding = await semanticFinding(b, 'WARNING');
    await expectDenied(() =>
      acknowledgeSemanticWarning(a.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'foreign',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
  });

  it('T08 rejects organization B acknowledging A warning without disclosure', async () => {
    const a = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const b = await fixture();
    const finding = await semanticFinding(a, 'WARNING');
    await expectDenied(() =>
      acknowledgeSemanticWarning(b.context, {
        version: '1.0.0',
        findingId: finding.id,
        reason: 'foreign',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
  });

  it('T09 returns the bounded validation-required shape when A reads B readiness', async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(
      getRevisionValidationReadiness(a.context, b.assessment.id, b.revision.id),
    ).resolves.toEqual({
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
  });

  it('T10 returns the bounded validation-required shape when B reads A readiness', async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(
      getRevisionValidationReadiness(b.context, a.assessment.id, a.revision.id),
    ).resolves.toEqual({
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
  });

  it('T11 rejects persisted A-to-B readiness before invoking the database assertion', async () => {
    const a = await fixture();
    const b = await fixture();
    let assertionCalls = 0;
    const readiness = await getRevisionValidationReadiness(
      a.context,
      b.assessment.id,
      b.revision.id,
      prisma,
      () => {
        assertionCalls += 1;
        throw new Error('database assertion must not run for a foreign revision');
      },
    );
    expect(readiness).toEqual({
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
    expect(assertionCalls).toBe(0);
  });

  it('T12 rejects persisted B-to-A readiness before invoking the database assertion', async () => {
    const a = await fixture();
    const b = await fixture();
    let assertionCalls = 0;
    const readiness = await getRevisionValidationReadiness(
      b.context,
      a.assessment.id,
      a.revision.id,
      prisma,
      () => {
        assertionCalls += 1;
        throw new Error('database assertion must not run for a foreign revision');
      },
    );
    expect(readiness).toEqual({
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
    expect(assertionCalls).toBe(0);
  });
});

async function completeRoleFlow(role: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN') {
  const f = await processedFixture(role, [{ severity: 'WARNING' }]);
  const status = await getValidationStatus(f.context, f.run.id);
  const result = await getValidationResult(f.context, f.run.id);
  const warning = await semanticFinding(f, 'WARNING');
  const acknowledgement = await acknowledgeSemanticWarning(f.context, {
    version: '1.0.0',
    findingId: warning.id,
    reason: `${role} review`,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(status?.state).toBe('SUCCEEDED');
  expect(result?.status.id).toBe(f.run.id);
  expect(acknowledgement.actorUserId).toBe(f.workspace.user.id);
  return f;
}

async function withInactiveState(
  target: 'user' | 'membership' | 'organization',
  operation: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  const f = await fixture();
  try {
    if (target === 'user')
      await prisma.user.update({
        where: { id: f.workspace.user.id },
        data: { status: 'INACTIVE' },
      });
    if (target === 'membership')
      await prisma.membership.update({
        where: {
          userId_organizationId: {
            userId: f.workspace.user.id,
            organizationId: f.workspace.organization.id,
          },
        },
        data: { status: 'INACTIVE' },
      });
    if (target === 'organization')
      await prisma.organization.update({
        where: { id: f.workspace.organization.id },
        data: { status: 'INACTIVE' },
      });
    await operation(f);
  } finally {
    if (target === 'user')
      await prisma.user.update({ where: { id: f.workspace.user.id }, data: { status: 'ACTIVE' } });
    if (target === 'membership')
      await prisma.membership.update({
        where: {
          userId_organizationId: {
            userId: f.workspace.user.id,
            organizationId: f.workspace.organization.id,
          },
        },
        data: { status: 'ACTIVE' },
      });
    if (target === 'organization')
      await prisma.organization.update({
        where: { id: f.workspace.organization.id },
        data: { status: 'ACTIVE' },
      });
  }
}

describe('Phase 50 persisted role and state matrix', () => {
  it('R01 allows a persisted TEACHER complete own-tenant validation flow', async () => {
    const f = await completeRoleFlow('TEACHER');
    expect(f.context.role).toBe('TEACHER');
  });

  it('R02 allows a persisted COORDINATOR complete own-tenant validation flow', async () => {
    const f = await completeRoleFlow('COORDINATOR');
    expect(f.context.role).toBe('COORDINATOR');
  });

  it('R03 allows a persisted SCHOOL_ADMIN complete own-tenant validation flow', async () => {
    const f = await completeRoleFlow('SCHOOL_ADMIN');
    expect(f.context.role).toBe('SCHOOL_ADMIN');
  });

  it('R04 denies a validation request after the persisted user becomes inactive', async () => {
    await withInactiveState('user', async (f) => {
      await expectDenied(() => requestRevisionValidation(f.context, validationInput(f)));
      expect(
        await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
      ).toBe(0);
    });
  });

  it('R05 denies persisted inactive-user status, result, and readiness reads', async () => {
    const f = await processedFixture();
    try {
      await prisma.user.update({
        where: { id: f.workspace.user.id },
        data: { status: 'INACTIVE' },
      });
      await expectDenied(() => getValidationStatus(f.context, f.run.id));
      await expectDenied(() => getValidationResult(f.context, f.run.id));
      await expectDenied(() =>
        getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
      );
    } finally {
      await prisma.user.update({ where: { id: f.workspace.user.id }, data: { status: 'ACTIVE' } });
    }
  });

  it('R06 denies a validation request after the persisted membership becomes inactive', async () => {
    await withInactiveState('membership', async (f) => {
      await expectDenied(() => requestRevisionValidation(f.context, validationInput(f)));
      expect(
        await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
      ).toBe(0);
    });
  });

  it('R07 denies persisted inactive-membership status, result, and readiness reads', async () => {
    const f = await processedFixture();
    try {
      await prisma.membership.update({
        where: {
          userId_organizationId: {
            userId: f.workspace.user.id,
            organizationId: f.workspace.organization.id,
          },
        },
        data: { status: 'INACTIVE' },
      });
      await expectDenied(() => getValidationStatus(f.context, f.run.id));
      await expectDenied(() => getValidationResult(f.context, f.run.id));
      await expectDenied(() =>
        getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
      );
    } finally {
      await prisma.membership.update({
        where: {
          userId_organizationId: {
            userId: f.workspace.user.id,
            organizationId: f.workspace.organization.id,
          },
        },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('R08 denies a validation request after the persisted organization becomes inactive', async () => {
    await withInactiveState('organization', async (f) => {
      await expectDenied(() => requestRevisionValidation(f.context, validationInput(f)));
      expect(
        await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
      ).toBe(0);
    });
  });

  it('R09 denies persisted inactive-organization status, result, and readiness reads', async () => {
    const f = await processedFixture();
    try {
      await prisma.organization.update({
        where: { id: f.workspace.organization.id },
        data: { status: 'INACTIVE' },
      });
      await expectDenied(() => getValidationStatus(f.context, f.run.id));
      await expectDenied(() => getValidationResult(f.context, f.run.id));
      await expectDenied(() =>
        getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
      );
    } finally {
      await prisma.organization.update({
        where: { id: f.workspace.organization.id },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('R10 reloads the persisted PLATFORM_ADMIN role and rejects a forged SCHOOL_ADMIN context', async () => {
    const f = await fixture();
    await prisma.membership.update({
      where: {
        userId_organizationId: {
          userId: f.workspace.user.id,
          organizationId: f.workspace.organization.id,
        },
      },
      data: { role: 'PLATFORM_ADMIN' },
    });
    const forged = { ...f.context, role: 'SCHOOL_ADMIN' as const };
    await expectDenied(() => requestRevisionValidation(forged, validationInput(f)));
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
    ).toBe(0);
  });

  it('R11 rejects a client-forged organization because persisted membership and ownership win', async () => {
    const a = await fixture();
    const b = await fixture();
    const forged = { ...a.context, organizationId: b.workspace.organization.id };
    await expectDenied(() => requestRevisionValidation(forged, validationInput(b)));
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: b.revision.id } }),
    ).toBe(0);
  });

  it('R12 stores the authenticated persisted requester and acknowledger identities', async () => {
    const f = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const warning = await semanticFinding(f, 'WARNING');
    const acknowledgement = await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: warning.id,
      reason: 'persisted actor',
      idempotencyKey: crypto.randomUUID(),
    });
    const run = await prisma.validationRun.findUniqueOrThrow({ where: { id: f.run.id } });
    expect(run.requestingUserId).toBe(f.workspace.user.id);
    expect(acknowledgement.actorUserId).toBe(f.workspace.user.id);
  });

  it('R13 rejects a missing authenticated principal before a domain write', async () => {
    const f = await fixture();
    await expectDenied(() => requestRevisionValidation({} as AccessContext, validationInput(f)));
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: f.revision.id } }),
    ).toBe(0);
  });

  it('R14 rejects an unsupported persisted role at the authorization boundary', async () => {
    const f = await fixture();
    await prisma.membership.update({
      where: {
        userId_organizationId: {
          userId: f.workspace.user.id,
          organizationId: f.workspace.organization.id,
        },
      },
      data: { role: 'PLATFORM_ADMIN' },
    });
    await expectDenied(() => requestRevisionValidation(f.context, validationInput(f)));
  });

  const acknowledgeAs = async (role: 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN') => {
    const f = await processedFixture(role, [{ severity: 'WARNING' }]);
    const warning = await semanticFinding(f, 'WARNING');
    const acknowledgement = await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: warning.id,
      reason: `${role} acknowledged`,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(acknowledgement).toMatchObject({
      actorUserId: f.workspace.user.id,
      organizationId: f.workspace.organization.id,
      findingId: warning.id,
    });
  };

  it('R15 allows a persisted TEACHER to acknowledge an own semantic warning', async () => {
    await acknowledgeAs('TEACHER');
  });

  it('R16 allows a persisted COORDINATOR to acknowledge an own semantic warning', async () => {
    await acknowledgeAs('COORDINATOR');
  });

  it('R17 allows a persisted SCHOOL_ADMIN to acknowledge an own semantic warning', async () => {
    await acknowledgeAs('SCHOOL_ADMIN');
  });

  it('R18 denies platform entitlement without an active organization membership', async () => {
    const entitled = await createPersonalWorkspace({
      email: `phase50-entitled-${crypto.randomUUID()}@example.test`,
      workspaceName: 'Entitled without membership',
    });
    await prisma.user.update({ where: { id: entitled.user.id }, data: { platformAdmin: true } });
    const target = await fixture();
    const forgedContext = {
      ...target.context,
      principal: { ...principal(entitled.user.id), platformAdmin: true },
    };
    await expectDenied(() => requestRevisionValidation(forgedContext, validationInput(target)));
    expect(
      await prisma.validationRun.count({ where: { assessmentRevisionId: target.revision.id } }),
    ).toBe(0);
  });
});

describe('Phase 50 persisted concurrency and idempotency matrix', () => {
  it('C02 rejects a reused request key for a different persisted revision with no second run', async () => {
    const f = await fixture();
    const second = await createAssessmentRevision(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      idempotencyKey: crypto.randomUUID(),
      curriculumVersionId: f.revision.curriculumVersionId,
      curriculumNodeIds: [],
      scoringMode: 'NONE',
      sections: [
        {
          key: 's2',
          title: 'Second',
          order: 0,
          questions: [
            {
              key: 'q2',
              type: 'SHORT_TEXT',
              prompt: 'Second question',
              order: 0,
              answers: [{ key: 'a2', order: 0, text: 'Second answer' }],
              rubrics: [],
              subQuestions: [],
            },
          ],
        },
      ],
    });
    const key = crypto.randomUUID();
    await requestRevisionValidation(f.context, validationInput(f, key));
    await expect(
      requestRevisionValidation(f.context, {
        version: '1.0.0',
        assessmentId: f.assessment.id,
        assessmentRevisionId: second.id,
        idempotencyKey: key,
      }),
    ).rejects.toThrow('Idempotency key was already used with different content');
    expect(
      await prisma.validationRun.count({
        where: { organizationId: f.workspace.organization.id, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('C03 allocates distinct monotonic sequences for concurrent distinct keys', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([
      requestRevisionValidation(f.context, validationInput(f, crypto.randomUUID())),
      requestRevisionValidation(f.context, validationInput(f, crypto.randomUUID())),
    ]);
    expect(a.id).not.toBe(b.id);
    expect([a.revisionSequence, b.revisionSequence].sort((x, y) => x - y)).toEqual([1, 2]);
    const rows = await prisma.validationRun.findMany({
      where: { assessmentRevisionId: f.revision.id },
      orderBy: { revisionSequence: 'asc' },
      select: { revisionSequence: true },
    });
    expect(rows).toEqual([{ revisionSequence: 1 }, { revisionSequence: 2 }]);
  });

  it('C04 permits only one processor to own and complete a concurrent run claim', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, validationInput(f));
    let evaluations = 0;
    const evaluator = new DeterministicFakeSemanticEvaluator(undefined, async (input) => {
      evaluations += 1;
      return {
        version: '1.0.0',
        evaluatorVersion: 'local-disabled-v1',
        promptVersion: 'validation-prompt-v1',
        modelConfigurationVersion: 'local-none-v1',
        schemaVersion: '1.0.0',
        revisionId: input.revisionId,
        findings: [],
      };
    });
    const [left, right] = await Promise.all([
      processValidationRun(run.id, prisma, evaluator),
      processValidationRun(run.id, prisma, evaluator),
    ]);
    expect(left?.state).toBe('SUCCEEDED');
    expect(right?.state).toBe('SUCCEEDED');
    expect(evaluations).toBe(1);
    expect(await prisma.semanticEvaluation.count({ where: { validationRunId: run.id } })).toBe(1);
    expect((await prisma.validationRun.findUniqueOrThrow({ where: { id: run.id } })).attempts).toBe(
      1,
    );
  });

  it('C05 retains a fresh processing lease and retries only a stale processing lease', async () => {
    const fresh = await fixture();
    const freshRun = await requestRevisionValidation(fresh.context, validationInput(fresh));
    await prisma.validationRun.update({
      where: { id: freshRun.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(processValidationRun(freshRun.id)).resolves.toMatchObject({
      state: 'PROCESSING',
      attempts: 1,
    });
    expect(
      await prisma.validationRuleExecution.count({ where: { validationRunId: freshRun.id } }),
    ).toBe(0);

    const stale = await fixture();
    const staleRun = await requestRevisionValidation(stale.context, validationInput(stale));
    await prisma.validationRun.update({
      where: { id: staleRun.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(Date.now() - 120_000),
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(processValidationRun(staleRun.id)).resolves.toMatchObject({
      state: 'SUCCEEDED',
      attempts: 2,
    });
    expect(
      await prisma.validationRuleExecution.count({ where: { validationRunId: staleRun.id } }),
    ).toBe(11);
  });

  it('C06 converges competing success/failure processors to exactly one legal terminal result', async () => {
    const f = await fixture();
    const staged = await completePersistedRun(f, { terminal: false });
    let signalSuccessBoundary!: () => void;
    let signalFailureBoundary!: () => void;
    let releaseSuccess!: () => void;
    let releaseFailure!: () => void;
    const successAtBoundary = new Promise<void>((resolve) => {
      signalSuccessBoundary = resolve;
    });
    const failureAtBoundary = new Promise<void>((resolve) => {
      signalFailureBoundary = resolve;
    });
    const successReleased = new Promise<void>((resolve) => {
      releaseSuccess = resolve;
    });
    const failureReleased = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const terminalAttempt = (
      terminal: 'SUCCEEDED' | 'FAILED',
      atBoundary: () => void,
      released: Promise<void>,
    ) =>
      prisma.$transaction(async (tx) => {
        const observed = await tx.validationRun.findUniqueOrThrow({ where: { id: staged.run.id } });
        expect(observed.state).toBe('PROCESSING');
        atBoundary();
        await released;
        const updated = await tx.validationRun.update({
          where: { id: staged.run.id },
          data:
            terminal === 'SUCCEEDED'
              ? {
                  state: 'SUCCEEDED',
                  completedAt: new Date(),
                  leaseExpiresAt: null,
                  deterministicPassCount: 11,
                  deterministicFailCount: 0,
                  semanticFindingCount: 0,
                }
              : {
                  state: 'FAILED',
                  failureCode: 'PERMANENT_EVALUATOR_ERROR',
                  completedAt: new Date(),
                  leaseExpiresAt: null,
                },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: f.workspace.user.id,
            organizationId: f.workspace.organization.id,
            eventType: terminal === 'SUCCEEDED' ? 'validation.succeeded' : 'validation.failed',
            targetType: 'validation_run',
            targetId: staged.run.id,
            metadata: { terminal },
          },
        });
        return updated;
      });

    const successfulWrite = terminalAttempt('SUCCEEDED', signalSuccessBoundary, successReleased);
    const failedWriteOutcome = terminalAttempt(
      'FAILED',
      signalFailureBoundary,
      failureReleased,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await Promise.all([successAtBoundary, failureAtBoundary]);
    releaseSuccess();
    const winner = await successfulWrite;
    expect(winner.state).toBe('SUCCEEDED');
    releaseFailure();
    const loser = await failedWriteOutcome;
    expect('error' in loser).toBe(true);
    expect(databaseError('error' in loser ? loser.error : undefined)).toEqual({
      code: 'P5018',
      message: 'phase50 validation lifecycle transition is forbidden',
    });

    const stored = await prisma.validationRun.findUniqueOrThrow({ where: { id: staged.run.id } });
    expect(stored.state).toBe('SUCCEEDED');
    expect(stored.completedAt).not.toBeNull();
    expect(stored.attempts).toBe(1);
    expect(
      await prisma.validationRuleExecution.count({ where: { validationRunId: staged.run.id } }),
    ).toBe(11);
    expect(
      await prisma.semanticEvaluation.count({ where: { validationRunId: staged.run.id } }),
    ).toBe(1);
    expect(
      await prisma.validationFinding.count({ where: { validationRunId: staged.run.id } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: {
          targetId: staged.run.id,
          eventType: { in: ['validation.succeeded', 'validation.failed'] },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { targetId: staged.run.id, eventType: 'validation.succeeded' },
      }),
    ).toMatchObject({ metadata: { terminal: 'SUCCEEDED' } });
  });

  it('C08 chooses greater sequence over timestamps for older success, failed, and pending runs', async () => {
    const f = await fixture();
    const success = await completePersistedRun(f, { sequence: 1, key: 'c08-success' });
    const failed = await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 2,
        idempotencyKey: 'c08-failed',
        requestFingerprint: 'b'.repeat(64),
      },
    });
    await prisma.validationRun.update({
      where: { id: failed.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.validationRun.update({
      where: { id: failed.id },
      data: {
        state: 'FAILED',
        failureCode: 'OUTPUT_INVALID',
        completedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    expect(
      await getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).toMatchObject({ reasonCode: 'VALIDATION_FAILED', validationRunId: failed.id });
    const pending = await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 3,
        idempotencyKey: 'c08-pending',
        requestFingerprint: 'c'.repeat(64),
      },
    });
    const equal = new Date('2030-01-01T00:00:00.000Z');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE validation_runs SET created_at=${equal}, updated_at=${equal} WHERE id IN (${success.run.id}::uuid,${failed.id}::uuid,${pending.id}::uuid)`;
    });
    expect(
      await getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).toMatchObject({ reasonCode: 'VALIDATION_PENDING', validationRunId: pending.id });
  });
});

describe('Phase 50 persisted approval readiness matrix', () => {
  it('P01 returns VALIDATION_REQUIRED when no persisted run exists', async () => {
    const f = await fixture();
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toEqual({
      version: '1.0.0',
      status: 'BLOCKED',
      reasonCode: 'VALIDATION_REQUIRED',
      validationRunId: null,
    });
  });

  it('P02 returns VALIDATION_PENDING for the latest persisted pending run', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, validationInput(f));
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({ reasonCode: 'VALIDATION_PENDING', validationRunId: run.id });
  });

  it('P03 returns VALIDATION_PROCESSING for the latest persisted processing run', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, validationInput(f));
    await prisma.validationRun.update({
      where: { id: run.id },
      data: {
        state: 'PROCESSING',
        attempts: 1,
        processingStartedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({ reasonCode: 'VALIDATION_PROCESSING', validationRunId: run.id });
  });

  it('P04 returns VALIDATION_FAILED for the latest persisted evaluator-failed run', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, validationInput(f));
    await processValidationRun(
      run.id,
      prisma,
      new DeterministicFakeSemanticEvaluator(undefined, async () => {
        throw new Error('permanent');
      }),
    );
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({ reasonCode: 'VALIDATION_FAILED', validationRunId: run.id });
  });

  it('P05 returns DETERMINISTIC_BLOCKER for a complete persisted deterministic failure', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f, { kind: 'DETERMINISTIC' });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({
      reasonCode: 'DETERMINISTIC_BLOCKER',
      validationRunId: complete.run.id,
    });
  });

  it('P06 returns SEMANTIC_BLOCKER for a complete persisted semantic blocker', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f, { kind: 'SEMANTIC', severity: 'BLOCKING' });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({ reasonCode: 'SEMANTIC_BLOCKER', validationRunId: complete.run.id });
  });

  it('P07 requires acknowledgement for a complete persisted semantic warning', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f, { kind: 'SEMANTIC', severity: 'WARNING' });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({
      reasonCode: 'WARNING_ACKNOWLEDGEMENT_REQUIRED',
      validationRunId: complete.run.id,
    });
  });

  it('P08 becomes READY after the exact persisted semantic warning is acknowledged', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f, { kind: 'SEMANTIC', severity: 'WARNING' });
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: complete.findingId!,
      reason: 'reviewed',
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toEqual({
      version: '1.0.0',
      status: 'READY',
      reasonCode: null,
      validationRunId: complete.run.id,
    });
  });

  it('P09 returns READY for a complete INFO-only persisted run', async () => {
    const info = await fixture();
    const infoRun = await completePersistedRun(info, { kind: 'SEMANTIC', severity: 'INFO' });
    await expect(
      getRevisionValidationReadiness(info.context, info.assessment.id, info.revision.id),
    ).resolves.toMatchObject({ status: 'READY', validationRunId: infoRun.run.id });
  });

  it('P10 returns VALIDATION_VERSION_STALE for a persisted non-current registry identity', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE validation_runs SET ruleset_version='stale-v0' WHERE id=${complete.run.id}::uuid`;
    });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({
      reasonCode: 'VALIDATION_VERSION_STALE',
      validationRunId: complete.run.id,
    });
  });

  it('P12 never lets an older success mask the greater persisted non-success sequence', async () => {
    const f = await fixture();
    await completePersistedRun(f, { sequence: 1, key: 'p12-old-success' });
    const newest = await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 2,
        idempotencyKey: 'p12-new-pending',
        requestFingerprint: 'd'.repeat(64),
      },
    });
    await expect(
      getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
    ).resolves.toMatchObject({ reasonCode: 'VALIDATION_PENDING', validationRunId: newest.id });
  });
});

describe('Phase 50 persisted audit, outbox, redaction, and evidence matrix', () => {
  it('A01 records a validation request audit with only approved IDs and registry versions', async () => {
    const f = await fixture();
    const run = await requestRevisionValidation(f.context, validationInput(f));
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'validation.requested', targetId: run.id },
    });
    expect(audit).toMatchObject({
      actorUserId: f.workspace.user.id,
      organizationId: f.workspace.organization.id,
      targetType: 'validation_run',
      targetId: run.id,
    });
    expect(audit.metadata).toEqual({
      rulesetVersion: 'v1',
      evaluatorVersion: 'local-disabled-v1',
    });
  });

  it('A02 records worker success with exact counts and no assessment content', async () => {
    const f = await processedFixture();
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'validation.succeeded', targetId: f.run.id },
    });
    expect(audit.metadata).toEqual({ deterministicFailCount: 11, semanticFindingCount: 0 });
    expect(JSON.stringify(audit)).not.toContain('Question');
    expect(JSON.stringify(audit)).not.toContain('Answer');
  });

  it('A04 records warning acknowledgement IDs and bounded reason hash/class without reason text', async () => {
    const f = await processedFixture('TEACHER', [{ severity: 'WARNING' }]);
    const warning = await semanticFinding(f, 'WARNING');
    const reason = 'Sensitive reviewer explanation';
    await acknowledgeSemanticWarning(f.context, {
      version: '1.0.0',
      findingId: warning.id,
      reason,
      idempotencyKey: crypto.randomUUID(),
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'validation.warning_acknowledged', targetId: warning.id },
    });
    expect(Object.keys(audit.metadata as object).sort()).toEqual([
      'findingId',
      'reasonClass',
      'reasonHash',
      'validationRunId',
    ]);
    expect(audit.metadata).toMatchObject({
      findingId: warning.id,
      validationRunId: f.run.id,
      reasonClass: 'ACKNOWLEDGEMENT',
    });
    expect((audit.metadata as { reasonHash: string }).reasonHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit.metadata)).not.toContain(reason);
  });

  it('A05 keeps validation request and retry outbox payloads ID-only', async () => {
    const f = await fixture();
    const key = crypto.randomUUID();
    const first = await requestRevisionValidation(f.context, validationInput(f, key));
    const replay = await requestRevisionValidation(f.context, validationInput(f, key));
    expect(replay.id).toBe(first.id);
    const events = await prisma.outboxEvent.findMany({
      where: { eventType: 'validation.requested', idempotencyKey: `validation:${first.id}` },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ validationRunId: first.id });
    expect(Object.keys(events[0]!.payload as object)).toEqual(['validationRunId']);
  });

  it('A08 rejects direct audit/evidence UPDATE and DELETE and retains original rows', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f);
    const audit = await prisma.auditEvent.create({
      data: {
        actorUserId: f.workspace.user.id,
        organizationId: f.workspace.organization.id,
        eventType: 'validation.test_evidence',
        targetType: 'validation_run',
        targetId: complete.run.id,
        metadata: { validationRunId: complete.run.id },
      },
    });
    const execution = await prisma.validationRuleExecution.findUniqueOrThrow({
      where: { id: complete.executions[0]!.id },
    });
    await expect(
      prisma.$executeRaw`UPDATE audit_events SET metadata='{}'::jsonb WHERE id=${audit.id}::uuid`,
    ).rejects.toThrow('audit_events are append-only');
    await expect(
      prisma.$executeRaw`DELETE FROM audit_events WHERE id=${audit.id}::uuid`,
    ).rejects.toThrow('audit_events are append-only');
    await expect(
      prisma.$executeRaw`UPDATE validation_rule_executions SET evidence='{}'::jsonb WHERE id=${execution.id}::uuid`,
    ).rejects.toThrow('phase50 immutable evidence');
    await expect(
      prisma.$executeRaw`DELETE FROM validation_rule_executions WHERE id=${execution.id}::uuid`,
    ).rejects.toThrow('phase50 immutable evidence');
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: audit.id } })).toEqual(audit);
    expect(
      await prisma.validationRuleExecution.findUniqueOrThrow({ where: { id: execution.id } }),
    ).toEqual(execution);
  });

  it('fails closed when eleven PASS rows contain missing or forged persisted evidence', async () => {
    const f = await fixture();
    const complete = await completePersistedRun(f);
    const execution = complete.executions[0]!;
    const original = execution.evidence;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_rule_executions SET evidence='{}'::jsonb WHERE id=${execution.id}::uuid`;
      });
      expect(
        await prisma.validationRuleExecution.count({
          where: { validationRunId: complete.run.id, outcome: 'PASS' },
        }),
      ).toBe(11);
      await expect(getValidationResult(f.context, complete.run.id)).rejects.toThrow(
        'Validation evidence integrity mismatch',
      );
      await expect(
        getRevisionValidationReadiness(f.context, f.assessment.id, f.revision.id),
      ).resolves.toMatchObject({
        status: 'BLOCKED',
        reasonCode: 'VALIDATION_FAILED',
        validationRunId: complete.run.id,
      });
      await expect(
        assertRevisionApprovable(f.workspace.organization.id, f.revision.id),
      ).rejects.toThrow('phase50 revision is not approvable');
    } finally {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_rule_executions SET evidence=${JSON.stringify(original)}::jsonb WHERE id=${execution.id}::uuid`;
      });
    }
  });
});
