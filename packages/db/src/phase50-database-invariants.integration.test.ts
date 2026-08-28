import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessmentRevision,
  createPersonalWorkspace,
  prisma,
  publishCurriculumVersion,
  resolveAccessContext,
} from './index.js';

const principal = (userId: string) => ({
  version: '1.0.0' as const,
  userId,
  email: 'phase50@example.test',
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase50-db-${Date.now()}-${Math.random()}@example.test`,
    workspaceName: 'phase50-db',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P50-${Date.now()}-${Math.random()}`,
      educationSystemCode: 'IL',
      subjectCode: 'MATH',
      displayName: 'Phase 50',
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
      title: 'Phase 50',
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
    idempotencyKey: `revision-${Math.random()}`,
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

async function run(
  f: Awaited<ReturnType<typeof fixture>>,
  sequence = 1,
  key = `run-${Math.random()}`,
) {
  return prisma.validationRun.create({
    data: {
      organizationId: f.workspace.organization.id,
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      requestingUserId: f.workspace.user.id,
      rulesetVersion: 'v1',
      evaluatorVersion: 'local-disabled-v1',
      revisionSequence: sequence,
      idempotencyKey: key,
      requestFingerprint: 'a'.repeat(64),
    },
  });
}

async function reject(operation: () => Promise<unknown>, sqlState: string, message: string) {
  try {
    await operation();
    throw new Error('operation unexpectedly succeeded');
  } catch (error) {
    const e = error as {
      code?: string;
      meta?: { code?: string; message?: string };
      message?: string;
    };
    const raw = e.meta?.message ?? e.message ?? '';
    const actualCode =
      e.meta?.code ??
      raw.match(/Code:\s*`?([A-Z0-9]{5})/)?.[1] ??
      raw.match(/code:\s*"([A-Z0-9]{5})"/)?.[1] ??
      raw.match(/(P\d{4}|23505)/)?.[1] ??
      e.code;
    const actualMessage =
      raw.match(/Message:\s*`(?:ERROR:\s*)?([^`]+)`/)?.[1] ??
      raw.match(/message:\s*"([^"]+)"/)?.[1] ??
      raw.match(/(Unique constraint failed on the fields: \([^\n]+\))/)?.[1] ??
      raw.replace(/^ERROR:\s*/, '').trim();
    expect(actualCode).toBe(sqlState);
    expect(actualMessage).toBe(message);
  }
}

async function completeRun(f: Awaited<ReturnType<typeof fixture>>) {
  const value = await run(f);
  await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute', deterministic_pass_count=11 WHERE id=${value.id}::uuid`;
  const rules = await prisma.validationRuleDefinition.findMany({
    where: { rulesetVersion: 'v1' },
    orderBy: { deterministicOrder: 'asc' },
  });
  for (const rule of rules)
    await prisma.validationRuleExecution.create({
      data: { validationRunId: value.id, ruleDefinitionId: rule.id, outcome: 'PASS', evidence: {} },
    });
  await prisma.semanticEvaluation.create({
    data: {
      validationRunId: value.id,
      evaluatorVersion: 'local-disabled-v1',
      promptVersion: 'validation-prompt-v1',
      modelConfigurationVersion: 'local-none-v1',
      schemaVersion: '1.0.0',
      state: 'SUCCEEDED',
    },
  });
  return { value, rules };
}

async function incompleteRun(f: Awaited<ReturnType<typeof fixture>>) {
  const value = await run(f);
  await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute' WHERE id=${value.id}::uuid`;
  const rules = await prisma.validationRuleDefinition.findMany({
    where: { rulesetVersion: 'v1' },
    orderBy: { deterministicOrder: 'asc' },
  });
  for (const rule of rules.slice(0, 10))
    await prisma.validationRuleExecution.create({
      data: { validationRunId: value.id, ruleDefinitionId: rule.id, outcome: 'PASS', evidence: {} },
    });
  return value;
}

describe('Phase 50 direct PostgreSQL database invariants', () => {
  afterAll(() => prisma.$disconnect());

  it('B01 forged organization/assessment owner reaches the owner guard', async () => {
    const f = await fixture();
    const other = await fixture();
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_runs (organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,idempotency_key,request_fingerprint) VALUES (${other.workspace.organization.id}::uuid,${f.assessment.id}::uuid,${f.revision.id}::uuid,${other.workspace.user.id}::uuid,'v1','local-disabled-v1',1,'b01','${'a'.repeat(64)}')`,
      'P5010',
      'phase50 assessment owner does not match organization',
    );
  });
  it('B02 mismatched assessment/revision reaches the revision guard', async () => {
    const f = await fixture();
    const other = await fixture();
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_runs (organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,idempotency_key,request_fingerprint) VALUES (${f.workspace.organization.id}::uuid,${f.assessment.id}::uuid,${other.revision.id}::uuid,${f.workspace.user.id}::uuid,'v1','local-disabled-v1',1,'b02',${'a'.repeat(64)})`,
      'P5011',
      'phase50 revision does not belong to assessment',
    );
  });
  it('B03 BUILDING or non-FINALIZED revision is rejected', async () => {
    const f = await fixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE assessment_revisions SET state='BUILDING' WHERE id=${f.revision.id}::uuid`;
    });
    await reject(() => run(f), 'P5012', 'phase50 revision must be FINALIZED');
  });
  it('B04 requester without active persisted authority is rejected', async () => {
    const f = await fixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE memberships SET status='INACTIVE' WHERE user_id=${f.workspace.user.id}::uuid AND organization_id=${f.workspace.organization.id}::uuid`;
    });
    await reject(() => run(f), 'P5014', 'phase50 requester lacks active organization authority');
  });
  it('B05 immutable run identity/config/sequence/idempotency update is rejected', async () => {
    const f = await fixture();
    const value = await run(f);
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET revision_sequence=2 WHERE id=${value.id}::uuid`,
      'P5016',
      'phase50 validation run identity is immutable',
    );
  });
  it('B06 illegal lifecycle pair is rejected', async () => {
    const f = await fixture();
    const value = await run(f);
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET state='FAILED', failure_code='x', completed_at=now() WHERE id=${value.id}::uuid`,
      'P5018',
      'phase50 validation lifecycle transition is forbidden',
    );
  });
  it('B07 SUCCEEDED with missing, duplicate or wrong-version rule set is rejected', async () => {
    const f = await fixture();
    const value = await incompleteRun(f);
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${value.id}::uuid`,
      'P5022',
      'phase50 success requires the complete pinned evidence shape',
    );
  });
  it('B08 SUCCEEDED without successful semantic evaluation is rejected', async () => {
    const f = await fixture();
    const value = await run(f);
    await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute' WHERE id=${value.id}::uuid`;
    const rules = await prisma.validationRuleDefinition.findMany({
      where: { rulesetVersion: 'v1' },
    });
    for (const rule of rules)
      await prisma.validationRuleExecution.create({
        data: {
          validationRunId: value.id,
          ruleDefinitionId: rule.id,
          outcome: 'PASS',
          evidence: {},
        },
      });
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', deterministic_pass_count=11, completed_at=now(), lease_expires_at=NULL WHERE id=${value.id}::uuid`,
      'P5022',
      'phase50 success requires the complete pinned evidence shape',
    );
  });
  it('B09 execution using unknown rule/version is rejected', async () => {
    const f = await fixture();
    const value = await run(f);
    const foreign = await prisma.validationRuleDefinition.create({
      data: {
        rulesetVersion: 'v2',
        ruleId: 'UNKNOWN',
        ruleVersion: '9.0.0',
        category: 'X',
        defaultSeverity: 'BLOCKING',
        deterministicOrder: 1,
      },
    });
    await reject(
      () =>
        prisma.validationRuleExecution.create({
          data: {
            validationRunId: value.id,
            ruleDefinitionId: foreign.id,
            outcome: 'PASS',
            evidence: {},
          },
        }),
      'P5023',
      'phase50 execution rule is unknown or wrong version',
    );
  });
  it('B10 finding with foreign run/revision/evaluator identity is rejected', async () => {
    const f = await fixture();
    const other = await fixture();
    const a = await completeRun(f);
    const b = await run(other);
    const foreignExecution = await prisma.validationRuleExecution.findFirstOrThrow({
      where: { validationRunId: a.value.id },
    });
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_findings (organization_id,validation_run_id,assessment_revision_id,execution_id,kind,code,category,severity,path,message_key,rule_version) VALUES (${other.workspace.organization.id}::uuid,${b.id}::uuid,${other.revision.id}::uuid,${foreignExecution.id}::uuid,'DETERMINISTIC','x','X','BLOCKING','p','m','1.0.0')`,
      'P5025',
      'phase50 deterministic finding identity does not match execution',
    );
  });
  it('B11 acknowledgement of deterministic finding is rejected', async () => {
    const f = await fixture();
    const { value, rules } = await completeRun(f);
    const execution = await prisma.validationRuleExecution.findFirstOrThrow({
      where: { validationRunId: value.id },
    });
    const finding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: value.id,
        assessmentRevisionId: f.revision.id,
        executionId: execution.id,
        kind: 'DETERMINISTIC',
        code: 'X',
        category: 'X',
        severity: 'BLOCKING',
        path: 'p',
        messageKey: 'm',
        ruleVersion: rules[0]!.ruleVersion,
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_finding_acknowledgements (organization_id,finding_id,actor_user_id,idempotency_key,reason,reason_hash) VALUES (${f.workspace.organization.id}::uuid,${finding.id}::uuid,${f.workspace.user.id}::uuid,'b11','reviewed',${'a'.repeat(64)})`,
      'P5028',
      'phase50 acknowledgement requires an owned semantic warning and active actor',
    );
  });
  it('B12 acknowledgement of semantic BLOCKING and semantic INFO is rejected', async () => {
    const f = await fixture();
    const { value } = await completeRun(f);
    const semantic = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: value.id },
    });
    const finding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: value.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: semantic.id,
        kind: 'SEMANTIC',
        code: 'ANSWER_VALIDITY_V1',
        category: 'ANSWER_VALIDITY',
        severity: 'BLOCKING',
        path: 'p',
        messageKey: 'm',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_finding_acknowledgements (organization_id,finding_id,actor_user_id,idempotency_key,reason,reason_hash) VALUES (${f.workspace.organization.id}::uuid,${finding.id}::uuid,${f.workspace.user.id}::uuid,'b12','reviewed',${'a'.repeat(64)})`,
      'P5028',
      'phase50 acknowledgement requires an owned semantic warning and active actor',
    );
  });
  it('B13 UPDATE/DELETE registry, execution, semantic evidence or finding is rejected', async () => {
    const f = await fixture();
    const { value } = await completeRun(f);
    const rule = await prisma.validationRuleDefinition.findFirstOrThrow();
    const execution = await prisma.validationRuleExecution.findFirstOrThrow({
      where: { validationRunId: value.id },
    });
    const semantic = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: value.id },
    });
    const finding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: value.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: semantic.id,
        kind: 'SEMANTIC',
        code: 'ANSWER_VALIDITY_V1',
        category: 'ANSWER_VALIDITY',
        severity: 'WARNING',
        path: 'p',
        messageKey: 'm',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    for (const operation of [
      () =>
        prisma.$executeRaw`UPDATE validation_rule_definitions SET category='x' WHERE id=${rule.id}::uuid`,
      () =>
        prisma.$executeRaw`DELETE FROM validation_rule_executions WHERE id=${execution.id}::uuid`,
      () => prisma.$executeRaw`DELETE FROM semantic_evaluations WHERE id=${semantic.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_findings SET path='x' WHERE id=${finding.id}::uuid`,
    ])
      await reject(operation, 'P5001', 'phase50 immutable evidence');
  });
  it('B14 UPDATE/DELETE/reparent acknowledgement is rejected', async () => {
    const f = await fixture();
    const { value } = await completeRun(f);
    const semantic = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: value.id },
    });
    const finding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: value.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: semantic.id,
        kind: 'SEMANTIC',
        code: 'ANSWER_VALIDITY_V1',
        category: 'ANSWER_VALIDITY',
        severity: 'WARNING',
        path: 'p',
        messageKey: 'm',
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const ack = await prisma.validationFindingAcknowledgement.create({
      data: {
        organizationId: f.workspace.organization.id,
        findingId: finding.id,
        actorUserId: f.workspace.user.id,
        idempotencyKey: 'b14',
        reason: 'reviewed',
        reasonHash: 'a'.repeat(64),
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_finding_acknowledgements SET reason='changed' WHERE id=${ack.id}::uuid`,
      'P5001',
      'phase50 immutable evidence',
    );
  });
  it('B15 duplicate revision sequence and conflicting idempotency identity are rejected', async () => {
    const f = await fixture();
    const value = await run(f, 1, 'b15');
    await reject(
      () => run(f, 1, 'b15-other'),
      'P2002',
      'Unique constraint failed on the fields: (`organization_id`,`assessment_revision_id`,`revision_sequence`)',
    );
    await reject(
      () => run(f, 2, 'b15'),
      'P2002',
      'Unique constraint failed on the fields: (`organization_id`,`assessment_revision_id`,`idempotency_key`)',
    );
    expect(value.revisionSequence).toBe(1);
  });
  it('B16 database readiness uses the newest sequence and fails closed after a newer non-ready run', async () => {
    const f = await fixture();
    const { value } = await completeRun(f);
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${value.id}::uuid`;
    const ready = await prisma.$queryRaw<
      Array<{ assert_revision_approvable: string }>
    >`SELECT assert_revision_approvable(${f.workspace.organization.id}::uuid,${f.revision.id}::uuid)`;
    expect(ready[0]?.assert_revision_approvable).toBe(value.id);
    await run(f, 2, 'b16-newer');
    await reject(
      () =>
        prisma.$queryRaw`SELECT assert_revision_approvable(${f.workspace.organization.id}::uuid,${f.revision.id}::uuid)`,
      'P5029',
      'phase50 revision is not approvable',
    );
  });
});
