import { afterAll, describe, expect, it } from 'vitest';
import {
  createAssessmentRevision,
  createPersonalWorkspace,
  getRevisionValidationReadiness,
  prisma,
  publishCurriculumVersion,
  resolveAccessContext,
  setSourceLifecycle,
} from './index.js';
import { createGenerationFixture } from './phase40.acceptance.fixtures.js';
import { processGenerationRun } from './generation.js';
import { DeterministicFakeModelGateway } from '@teach/ai';

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
      data: {
        validationRunId: value.id,
        ruleDefinitionId: rule.id,
        outcome: 'PASS',
        evidence: { identity: rule.ruleId, revisionId: f.revision.id },
      },
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
      data: {
        validationRunId: value.id,
        ruleDefinitionId: rule.id,
        outcome: 'PASS',
        evidence: { identity: rule.ruleId, revisionId: f.revision.id },
      },
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
    const other = await fixture();
    const value = await run(f);
    const original = await prisma.validationRun.findUniqueOrThrow({ where: { id: value.id } });
    const attempts = [
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET organization_id=${other.workspace.organization.id}::uuid WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET assessment_id=${other.assessment.id}::uuid WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET assessment_revision_id=${other.revision.id}::uuid WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET requesting_user_id=${other.workspace.user.id}::uuid WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET operation='RECHECK' WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET ruleset_version='v2' WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET evaluator_version='wrong' WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET revision_sequence=2 WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET idempotency_key='changed' WHERE id=${value.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET request_fingerprint=${'b'.repeat(64)} WHERE id=${value.id}::uuid`,
    ];
    for (const attempt of attempts) {
      await reject(attempt, 'P5016', 'phase50 validation run identity is immutable');
      expect(await prisma.validationRun.findUniqueOrThrow({ where: { id: value.id } })).toEqual(
        original,
      );
    }
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
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET state='PENDING' WHERE id=${value.id}::uuid`,
      'P5017',
      'phase50 same-state validation update is forbidden',
    );
    const terminal = await completeRun(await fixture());
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${terminal.value.id}::uuid`;
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING' WHERE id=${terminal.value.id}::uuid`,
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
    const duplicate = await completeRun(await fixture());
    const duplicateRule = duplicate.rules[0]!;
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_rule_executions (validation_run_id,rule_definition_id,outcome,evidence) VALUES (${duplicate.value.id}::uuid,${duplicateRule.id}::uuid,'PASS',jsonb_build_object('identity',${duplicateRule.ruleId},'revisionId',${duplicate.value.assessmentRevisionId}))`,
      '23505',
      `Key (validation_run_id, rule_definition_id)=(${duplicate.value.id}, ${duplicateRule.id}) already exists.`,
    );
    const wrongVersion = await fixture();
    const wrongRun = await run(wrongVersion);
    const wrongRule = await prisma.validationRuleDefinition.create({
      data: {
        rulesetVersion: 'v2',
        ruleId: 'WRONG_VERSION',
        ruleVersion: '2.0.0',
        category: 'X',
        defaultSeverity: 'BLOCKING',
        deterministicOrder: 1,
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_rule_executions (validation_run_id,rule_definition_id,outcome,evidence) VALUES (${wrongRun.id}::uuid,${wrongRule.id}::uuid,'PASS','{}'::jsonb)`,
      'P5023',
      'phase50 execution rule is unknown or wrong version',
    );
    for (const arrangement of ['duplicate-logical', 'stale-version'] as const) {
      const arranged = await completeRun(await fixture());
      const original = arranged.rules[0]!;
      const replacedRule = arranged.rules[1]!;
      const forgedRule = await prisma.validationRuleDefinition.create({
        data: {
          rulesetVersion: 'v1',
          ruleId: arrangement === 'duplicate-logical' ? original.ruleId : `STALE_${arrangement}`,
          ruleVersion: arrangement === 'duplicate-logical' ? '1.0.1' : '0.9.0',
          category: original.category,
          defaultSeverity: original.defaultSeverity,
          deterministicOrder: 99,
        },
      });
      const execution = await prisma.validationRuleExecution.findFirstOrThrow({
        where: { validationRunId: arranged.value.id, ruleDefinitionId: replacedRule.id },
      });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_rule_executions SET rule_definition_id=${forgedRule.id}::uuid WHERE id=${execution.id}::uuid`;
      });
      try {
        if (arrangement === 'duplicate-logical') {
          const logical = await prisma.$queryRaw<
            Array<{ total: bigint; distinct: bigint; selected: bigint; missing: bigint }>
          >`SELECT count(*) AS total, count(DISTINCT d.rule_id) AS distinct, count(*) FILTER (WHERE d.rule_id=${original.ruleId}) AS selected, count(*) FILTER (WHERE d.rule_id=${replacedRule.ruleId}) AS missing FROM validation_rule_executions e JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.validation_run_id=${arranged.value.id}::uuid`;
          expect(Number(logical[0]!.total)).toBe(11);
          expect(Number(logical[0]!.distinct)).toBe(10);
          expect(Number(logical[0]!.selected)).toBe(2);
          expect(Number(logical[0]!.missing)).toBe(0);
        } else {
          const mismatch = await prisma.validationRuleExecution.findFirstOrThrow({
            where: { id: execution.id },
            include: { ruleDefinition: true },
          });
          expect(mismatch.ruleDefinition.ruleVersion).toBe('0.9.0');
        }
        await reject(
          () =>
            prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${arranged.value.id}::uuid`,
          'P5022',
          'phase50 success requires the complete pinned evidence shape',
        );
        expect(
          await prisma.validationRuleExecution.count({
            where: { validationRunId: arranged.value.id },
          }),
        ).toBe(11);
      } finally {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRaw`UPDATE validation_rule_executions SET rule_definition_id=${replacedRule.id}::uuid WHERE id=${execution.id}::uuid`;
          await tx.$executeRaw`DELETE FROM validation_rule_definitions WHERE id=${forgedRule.id}::uuid`;
        });
      }
    }
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
          evidence: { identity: rule.ruleId, revisionId: f.revision.id },
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
        deterministicOrder: 99,
      },
    });
    await reject(
      () =>
        prisma.validationRuleExecution.create({
          data: {
            validationRunId: value.id,
            ruleDefinitionId: foreign.id,
            outcome: 'PASS',
            evidence: { identity: foreign.ruleId, revisionId: f.revision.id },
          },
        }),
      'P5023',
      'phase50 execution rule is unknown or wrong version',
    );
  });
  it('B10 finding identity subcases are independently rejected', async () => {
    const base = await fixture();
    const valid = await completeRun(base);
    const execution = await prisma.validationRuleExecution.findFirstOrThrow({
      where: { validationRunId: valid.value.id },
    });
    const foreign = await fixture();
    const cases = [
      [
        'organization',
        foreign.workspace.organization.id,
        valid.value.id,
        base.revision.id,
        execution.id,
        'P5025',
      ],
      [
        'run',
        base.workspace.organization.id,
        (await run(base, 2, 'b10-run')).id,
        base.revision.id,
        execution.id,
        'P5025',
      ],
      [
        'revision',
        base.workspace.organization.id,
        valid.value.id,
        foreign.revision.id,
        execution.id,
        'P5025',
      ],
      [
        'execution',
        base.workspace.organization.id,
        valid.value.id,
        base.revision.id,
        (
          await prisma.validationRuleExecution.findFirstOrThrow({
            where: { validationRunId: (await completeRun(await fixture())).value.id },
          })
        ).id,
        'P5025',
      ],
    ] as const;
    for (const [label, organizationId, runId, revisionId, executionId, code] of cases) {
      await reject(
        () =>
          prisma.$executeRaw`INSERT INTO validation_findings (organization_id,validation_run_id,assessment_revision_id,execution_id,kind,code,category,severity,path,message_key,rule_version) VALUES (${organizationId}::uuid,${runId}::uuid,${revisionId}::uuid,${executionId}::uuid,'DETERMINISTIC',${`b10-${label}`},'X','BLOCKING','p','m','1.0.0')`,
        code,
        'phase50 deterministic finding identity does not match execution',
      );
    }
    const semantic = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: valid.value.id },
    });
    const semanticCases = [
      [
        'organization',
        foreign.workspace.organization.id,
        valid.value.id,
        base.revision.id,
        semantic.id,
        'local-disabled-v1',
      ],
      [
        'run',
        base.workspace.organization.id,
        (await run(base, 3, 'b10-semantic-run')).id,
        base.revision.id,
        semantic.id,
        'local-disabled-v1',
      ],
      [
        'revision',
        base.workspace.organization.id,
        valid.value.id,
        foreign.revision.id,
        semantic.id,
        'local-disabled-v1',
      ],
      [
        'evaluation',
        base.workspace.organization.id,
        valid.value.id,
        base.revision.id,
        (
          await prisma.semanticEvaluation.findUniqueOrThrow({
            where: { validationRunId: (await completeRun(await fixture())).value.id },
          })
        ).id,
        'local-disabled-v1',
      ],
      [
        'evaluator',
        base.workspace.organization.id,
        valid.value.id,
        base.revision.id,
        semantic.id,
        'wrong-evaluator',
      ],
    ] as const;
    for (const [
      label,
      organizationId,
      runId,
      revisionId,
      evaluationId,
      evaluator,
    ] of semanticCases) {
      await reject(
        () =>
          prisma.$executeRaw`INSERT INTO validation_findings (organization_id,validation_run_id,assessment_revision_id,semantic_evaluation_id,kind,code,category,severity,path,message_key,evaluator_version) VALUES (${organizationId}::uuid,${runId}::uuid,${revisionId}::uuid,${evaluationId}::uuid,'SEMANTIC',${`b10-${label}`},'ANSWER_VALIDITY','BLOCKING','p','m',${evaluator})`,
        'P5026',
        'phase50 semantic finding identity does not match evaluation',
      );
    }
    expect(
      await prisma.validationFinding.count({ where: { validationRunId: valid.value.id } }),
    ).toBe(0);
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
        evidence: { identity: 'X', revisionId: f.revision.id },
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
        evidence: { identity: 'ANSWER_VALIDITY_V1', revisionId: f.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_finding_acknowledgements (organization_id,finding_id,actor_user_id,idempotency_key,reason,reason_hash) VALUES (${f.workspace.organization.id}::uuid,${finding.id}::uuid,${f.workspace.user.id}::uuid,'b12','reviewed',${'a'.repeat(64)})`,
      'P5028',
      'phase50 acknowledgement requires an owned semantic warning and active actor',
    );
    const infoFinding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: value.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: semantic.id,
        kind: 'SEMANTIC',
        code: 'DIFFICULTY_FIT_V1',
        category: 'DIFFICULTY_FIT',
        severity: 'INFO',
        path: 'p-info',
        messageKey: 'm-info',
        evidence: { identity: 'DIFFICULTY_FIT_V1', revisionId: f.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_finding_acknowledgements (organization_id,finding_id,actor_user_id,idempotency_key,reason,reason_hash) VALUES (${f.workspace.organization.id}::uuid,${infoFinding.id}::uuid,${f.workspace.user.id}::uuid,'b12-info','reviewed',${'b'.repeat(64)})`,
      'P5028',
      'phase50 acknowledgement requires an owned semantic warning and active actor',
    );
    expect(
      await prisma.validationFindingAcknowledgement.count({
        where: { idempotencyKey: { in: ['b12', 'b12-info'] } },
      }),
    ).toBe(0);
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
        evidence: { identity: 'ANSWER_VALIDITY_V1', revisionId: f.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    const snapshots = {
      rule: await prisma.validationRuleDefinition.findUniqueOrThrow({ where: { id: rule.id } }),
      execution: await prisma.validationRuleExecution.findUniqueOrThrow({
        where: { id: execution.id },
      }),
      semantic: await prisma.semanticEvaluation.findUniqueOrThrow({ where: { id: semantic.id } }),
      finding: await prisma.validationFinding.findUniqueOrThrow({ where: { id: finding.id } }),
    };
    for (const operation of [
      () =>
        prisma.$executeRaw`UPDATE validation_rule_definitions SET category='x' WHERE id=${rule.id}::uuid`,
      () => prisma.$executeRaw`DELETE FROM validation_rule_definitions WHERE id=${rule.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_rule_executions SET evidence='{"x":1}'::jsonb WHERE id=${execution.id}::uuid`,
      () =>
        prisma.$executeRaw`DELETE FROM validation_rule_executions WHERE id=${execution.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE semantic_evaluations SET failure_code='x' WHERE id=${semantic.id}::uuid`,
      () => prisma.$executeRaw`DELETE FROM semantic_evaluations WHERE id=${semantic.id}::uuid`,
      () => prisma.$executeRaw`DELETE FROM validation_findings WHERE id=${finding.id}::uuid`,
      () =>
        prisma.$executeRaw`UPDATE validation_findings SET path='x' WHERE id=${finding.id}::uuid`,
    ])
      await reject(operation, 'P5001', 'phase50 immutable evidence');
    expect(
      await prisma.validationRuleDefinition.findUniqueOrThrow({ where: { id: rule.id } }),
    ).toEqual(snapshots.rule);
    expect(
      await prisma.validationRuleExecution.findUniqueOrThrow({ where: { id: execution.id } }),
    ).toEqual(snapshots.execution);
    expect(
      await prisma.semanticEvaluation.findUniqueOrThrow({ where: { id: semantic.id } }),
    ).toEqual(snapshots.semantic);
    expect(await prisma.validationFinding.findUniqueOrThrow({ where: { id: finding.id } })).toEqual(
      snapshots.finding,
    );
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
        evidence: { identity: 'ANSWER_VALIDITY_V1', revisionId: f.revision.id },
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
    const other = await fixture();
    const alternateFinding = await prisma.validationFinding.create({
      data: {
        organizationId: f.workspace.organization.id,
        validationRunId: value.id,
        assessmentRevisionId: f.revision.id,
        semanticEvaluationId: semantic.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'WARNING',
        path: 'alternate',
        messageKey: 'alternate',
        evidence: { identity: 'AMBIGUITY_V1', revisionId: f.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_finding_acknowledgements SET reason='changed' WHERE id=${ack.id}::uuid`,
      'P5001',
      'phase50 immutable evidence',
    );
    await reject(
      () =>
        prisma.$executeRaw`DELETE FROM validation_finding_acknowledgements WHERE id=${ack.id}::uuid`,
      'P5001',
      'phase50 immutable evidence',
    );
    await reject(
      () =>
        prisma.$executeRaw`UPDATE validation_finding_acknowledgements SET finding_id=${alternateFinding.id}::uuid, organization_id=${f.workspace.organization.id}::uuid, actor_user_id=${other.workspace.user.id}::uuid WHERE id=${ack.id}::uuid`,
      'P5001',
      'phase50 immutable evidence',
    );
    expect(
      await prisma.validationFindingAcknowledgement.findUniqueOrThrow({ where: { id: ack.id } }),
    ).toEqual(ack);
  });
  it('B15 duplicate revision sequence and conflicting idempotency identity are rejected', async () => {
    const f = await fixture();
    const value = await run(f, 1, 'b15');
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_runs (organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,idempotency_key,request_fingerprint) SELECT organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,'b15-sequence',request_fingerprint FROM validation_runs WHERE id=${value.id}::uuid`,
      '23505',
      `Key (organization_id, assessment_revision_id, revision_sequence)=(${f.workspace.organization.id}, ${f.revision.id}, 1) already exists.`,
    );
    await reject(
      () =>
        prisma.$executeRaw`INSERT INTO validation_runs (organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,revision_sequence,idempotency_key,request_fingerprint) SELECT organization_id,assessment_id,assessment_revision_id,requesting_user_id,ruleset_version,evaluator_version,2,idempotency_key,request_fingerprint FROM validation_runs WHERE id=${value.id}::uuid`,
      '23505',
      `Key (organization_id, assessment_revision_id, idempotency_key)=(${f.workspace.organization.id}, ${f.revision.id}, b15) already exists.`,
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
    const sourceFixture = await createGenerationFixture();
    await processGenerationRun(
      sourceFixture.generationRunId,
      prisma,
      new DeterministicFakeModelGateway(),
    );
    const generatedRevision = await prisma.assessmentRevision.findFirstOrThrow({
      where: { assessmentId: sourceFixture.assessmentId },
      orderBy: { createdAt: 'desc' },
    });
    const sourceRun = await prisma.validationRun.create({
      data: {
        organizationId: sourceFixture.context.organizationId,
        assessmentId: sourceFixture.assessmentId,
        assessmentRevisionId: generatedRevision.id,
        requestingUserId: sourceFixture.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 1,
        idempotencyKey: 'b16-source',
        requestFingerprint: 'b'.repeat(64),
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute', deterministic_pass_count=11 WHERE id=${sourceRun.id}::uuid`;
    const sourceRules = await prisma.validationRuleDefinition.findMany({
      where: { rulesetVersion: 'v1' },
      orderBy: { deterministicOrder: 'asc' },
    });
    for (const rule of sourceRules)
      await prisma.validationRuleExecution.create({
        data: {
          validationRunId: sourceRun.id,
          ruleDefinitionId: rule.id,
          outcome: 'PASS',
          evidence: { identity: rule.ruleId, revisionId: generatedRevision.id },
        },
      });
    await prisma.semanticEvaluation.create({
      data: {
        validationRunId: sourceRun.id,
        evaluatorVersion: 'local-disabled-v1',
        promptVersion: 'validation-prompt-v1',
        modelConfigurationVersion: 'local-none-v1',
        schemaVersion: '1.0.0',
        state: 'SUCCEEDED',
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${sourceRun.id}::uuid`;
    await setSourceLifecycle(
      sourceFixture.context,
      sourceFixture.sourceVersionId,
      'SUSPENDED',
      'b16 revocation',
    );
    await reject(
      () =>
        prisma.$queryRaw`SELECT assert_revision_approvable(${sourceFixture.context.organizationId}::uuid,${generatedRevision.id}::uuid)`,
      'P5030',
      'phase50 current source eligibility is revoked',
    );
    await setSourceLifecycle(
      sourceFixture.context,
      sourceFixture.sourceVersionId,
      'ACTIVE',
      'b16 node-link probe',
    );
    const unlinkedRows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      return tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO curriculum_nodes (version_id,type,code,label,sort_order) VALUES (${generatedRevision.curriculumVersionId}::uuid,'GRADE','UNLINKED','Unlinked',99) RETURNING id`;
    });
    const unlinkedNode = unlinkedRows[0]!;
    const sourceLink = await prisma.questionSourceLink.findFirstOrThrow({
      where: { assessmentQuestion: { section: { revisionId: generatedRevision.id } } },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE question_source_links SET curriculum_node_id=${unlinkedNode.id}::uuid WHERE id=${sourceLink.id}::uuid`;
    });
    await reject(
      () =>
        prisma.$queryRaw`SELECT assert_revision_approvable(${sourceFixture.context.organizationId}::uuid,${generatedRevision.id}::uuid)`,
      'P5030',
      'phase50 current source eligibility is revoked',
    );
    const forgedFixture = await fixture();
    const forgedRun = await completeRun(forgedFixture);
    const forgedExecution = await prisma.validationRuleExecution.findFirstOrThrow({
      where: { validationRunId: forgedRun.value.id, ruleDefinitionId: forgedRun.rules[1]!.id },
    });
    const forgedRule = await prisma.validationRuleDefinition.create({
      data: {
        rulesetVersion: 'v1',
        ruleId: 'B16_FORGED_RULE',
        ruleVersion: '1.0.0',
        category: forgedRun.rules[1]!.category,
        defaultSeverity: forgedRun.rules[1]!.defaultSeverity,
        deterministicOrder: 99,
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${forgedRun.value.id}::uuid`;
    const forgedRevision = await prisma.assessmentRevision.findUniqueOrThrow({
      where: { id: forgedRun.value.assessmentRevisionId },
      include: { assessment: true },
    });
    const forgedReady = await prisma.$queryRaw<
      Array<{ assert_revision_approvable: string }>
    >`SELECT assert_revision_approvable(${forgedRevision.assessment.organizationId}::uuid,${forgedRun.value.assessmentRevisionId}::uuid)`;
    expect(forgedReady[0]?.assert_revision_approvable).toBe(forgedRun.value.id);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_rule_executions SET rule_definition_id=${forgedRule.id}::uuid WHERE id=${forgedExecution.id}::uuid`;
      });
      expect(
        await prisma.validationRuleExecution.count({
          where: { validationRunId: forgedRun.value.id },
        }),
      ).toBe(11);
      const forgedStored = await prisma.validationRun.findUniqueOrThrow({
        where: { id: forgedRun.value.id },
      });
      expect(forgedStored.deterministicPassCount).toBe(11);
      expect(forgedStored.deterministicFailCount).toBe(0);
      expect(
        await prisma.semanticEvaluation.count({
          where: { validationRunId: forgedRun.value.id, state: 'SUCCEEDED' },
        }),
      ).toBe(1);
      expect(forgedStored.semanticFindingCount).toBe(0);
      expect(
        await prisma.validationFinding.count({ where: { validationRunId: forgedRun.value.id } }),
      ).toBe(0);
      const forgedSet = await prisma.$queryRaw<
        Array<{ forged: bigint; current: bigint }>
      >`SELECT count(*) FILTER (WHERE rule_definition_id=${forgedRule.id}::uuid) AS forged, count(*) FILTER (WHERE rule_definition_id IN (SELECT id FROM validation_rule_definitions WHERE ruleset_version='v1' AND rule_version='1.0.0' AND deterministic_order BETWEEN 1 AND 11)) AS current FROM validation_rule_executions WHERE validation_run_id=${forgedRun.value.id}::uuid`;
      expect(Number(forgedSet[0]!.forged)).toBe(1);
      expect(Number(forgedSet[0]!.current)).toBe(10);
      await reject(
        () =>
          prisma.$queryRaw`SELECT assert_revision_approvable(${forgedRevision.assessment.organizationId}::uuid,${forgedRun.value.assessmentRevisionId}::uuid)`,
        'P5029',
        'phase50 revision is not approvable',
      );
    } finally {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_rule_executions SET rule_definition_id=${forgedRun.rules[1]!.id}::uuid WHERE id=${forgedExecution.id}::uuid`;
        await tx.$executeRaw`DELETE FROM validation_rule_definitions WHERE id=${forgedRule.id}::uuid`;
      });
    }
    const forgedOther = await fixture();
    const warningFixture = await fixture();
    const warningRun = await completeRun(warningFixture);
    const warningEvaluation = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: warningRun.value.id },
    });
    const warningFinding = await prisma.validationFinding.create({
      data: {
        organizationId: warningFixture.workspace.organization.id,
        validationRunId: warningRun.value.id,
        assessmentRevisionId: warningFixture.revision.id,
        semanticEvaluationId: warningEvaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'WARNING',
        path: 'b16',
        messageKey: 'b16-warning',
        evidence: { identity: 'AMBIGUITY_V1', revisionId: warningFixture.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL, semantic_finding_count=1 WHERE id=${warningRun.value.id}::uuid`;
    const warningAck = await prisma.validationFindingAcknowledgement.create({
      data: {
        organizationId: warningFixture.workspace.organization.id,
        findingId: warningFinding.id,
        actorUserId: warningFixture.workspace.user.id,
        idempotencyKey: 'b16-warning',
        reason: 'reviewed',
        reasonHash: 'c'.repeat(64),
      },
    });
    const warningReady = await prisma.$queryRaw<
      Array<{ assert_revision_approvable: string }>
    >`SELECT assert_revision_approvable(${warningFixture.workspace.organization.id}::uuid,${warningFixture.revision.id}::uuid)`;
    expect(warningReady[0]?.assert_revision_approvable).toBe(warningRun.value.id);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_finding_acknowledgements SET organization_id=${forgedOther.workspace.organization.id}::uuid WHERE id=${warningAck.id}::uuid`;
      });
      await reject(
        () =>
          prisma.$queryRaw`SELECT assert_revision_approvable(${warningFixture.workspace.organization.id}::uuid,${warningFixture.revision.id}::uuid)`,
        'P5029',
        'phase50 revision is not approvable',
      );
    } finally {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`UPDATE validation_finding_acknowledgements SET organization_id=${warningFixture.workspace.organization.id}::uuid WHERE id=${warningAck.id}::uuid`;
      });
    }
  });

  it('rejects missing or forged execution and finding evidence at the direct database boundary', async () => {
    const f = await fixture();
    const value = await run(f);
    const rule = await prisma.validationRuleDefinition.findFirstOrThrow({
      where: { rulesetVersion: 'v1' },
      orderBy: { deterministicOrder: 'asc' },
    });
    await reject(
      () =>
        prisma.validationRuleExecution.create({
          data: {
            validationRunId: value.id,
            ruleDefinitionId: rule.id,
            outcome: 'PASS',
            evidence: {},
          },
        }),
      'P5031',
      'phase50 execution evidence identity is invalid',
    );
    expect(
      await prisma.validationRuleExecution.count({ where: { validationRunId: value.id } }),
    ).toBe(0);

    const complete = await completeRun(await fixture());
    const semantic = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: complete.value.id },
    });
    await reject(
      () =>
        prisma.validationFinding.create({
          data: {
            organizationId: complete.value.organizationId,
            validationRunId: complete.value.id,
            assessmentRevisionId: complete.value.assessmentRevisionId,
            semanticEvaluationId: semantic.id,
            kind: 'SEMANTIC',
            code: 'AMBIGUITY_V1',
            category: 'AMBIGUITY',
            severity: 'WARNING',
            path: 'evidence',
            messageKey: 'evidence.invalid',
            evidence: {
              identity: 'FORGED',
              revisionId: complete.value.assessmentRevisionId,
            },
            evaluatorVersion: 'local-disabled-v1',
          },
        }),
      'P5032',
      'phase50 finding evidence identity is invalid',
    );
    expect(
      await prisma.validationFinding.count({ where: { validationRunId: complete.value.id } }),
    ).toBe(0);
  });

  it('completed validation retains findings and defers blocker policy to readiness', async () => {
    const deterministic = await fixture();
    const deterministicRun = await completeRun(deterministic);
    const execution = await prisma.validationRuleExecution.findFirstOrThrow({
      where: { validationRunId: deterministicRun.value.id },
    });
    await prisma.validationFinding.create({
      data: {
        organizationId: deterministic.workspace.organization.id,
        validationRunId: deterministicRun.value.id,
        assessmentRevisionId: deterministic.revision.id,
        executionId: execution.id,
        kind: 'DETERMINISTIC',
        code: 'RULE_FAIL',
        category: 'REVISION',
        severity: 'BLOCKING',
        path: 'revision',
        messageKey: 'RULE_FAIL',
        evidence: { identity: 'RULE_FAIL', revisionId: deterministic.revision.id },
        ruleVersion: deterministicRun.rules[0]!.ruleVersion,
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${deterministicRun.value.id}::uuid`;
    expect(
      (
        await getRevisionValidationReadiness(
          deterministic.context,
          deterministic.assessment.id,
          deterministic.revision.id,
        )
      ).reasonCode,
    ).toBe('DETERMINISTIC_BLOCKER');

    const semanticBlock = await fixture();
    const semanticBlockRun = await completeRun(semanticBlock);
    const semanticBlockEvaluation = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: semanticBlockRun.value.id },
    });
    await prisma.validationFinding.create({
      data: {
        organizationId: semanticBlock.workspace.organization.id,
        validationRunId: semanticBlockRun.value.id,
        assessmentRevisionId: semanticBlock.revision.id,
        semanticEvaluationId: semanticBlockEvaluation.id,
        kind: 'SEMANTIC',
        code: 'ANSWER_VALIDITY_V1',
        category: 'ANSWER_VALIDITY',
        severity: 'BLOCKING',
        path: 'question',
        messageKey: 'ANSWER_INVALID',
        evidence: { identity: 'ANSWER_VALIDITY_V1', revisionId: semanticBlock.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL, semantic_finding_count=1 WHERE id=${semanticBlockRun.value.id}::uuid`;
    expect(
      (
        await getRevisionValidationReadiness(
          semanticBlock.context,
          semanticBlock.assessment.id,
          semanticBlock.revision.id,
        )
      ).reasonCode,
    ).toBe('SEMANTIC_BLOCKER');

    const warning = await fixture();
    const warningRun = await completeRun(warning);
    const warningEvaluation = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: warningRun.value.id },
    });
    await prisma.validationFinding.create({
      data: {
        organizationId: warning.workspace.organization.id,
        validationRunId: warningRun.value.id,
        assessmentRevisionId: warning.revision.id,
        semanticEvaluationId: warningEvaluation.id,
        kind: 'SEMANTIC',
        code: 'AMBIGUITY_V1',
        category: 'AMBIGUITY',
        severity: 'WARNING',
        path: 'question',
        messageKey: 'AMBIGUOUS',
        evidence: { identity: 'AMBIGUITY_V1', revisionId: warning.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL, semantic_finding_count=1 WHERE id=${warningRun.value.id}::uuid`;
    expect(
      (
        await getRevisionValidationReadiness(
          warning.context,
          warning.assessment.id,
          warning.revision.id,
        )
      ).reasonCode,
    ).toBe('WARNING_ACKNOWLEDGEMENT_REQUIRED');

    const info = await fixture();
    const infoRun = await completeRun(info);
    const infoEvaluation = await prisma.semanticEvaluation.findUniqueOrThrow({
      where: { validationRunId: infoRun.value.id },
    });
    await prisma.validationFinding.create({
      data: {
        organizationId: info.workspace.organization.id,
        validationRunId: infoRun.value.id,
        assessmentRevisionId: info.revision.id,
        semanticEvaluationId: infoEvaluation.id,
        kind: 'SEMANTIC',
        code: 'DIFFICULTY_FIT_V1',
        category: 'DIFFICULTY_FIT',
        severity: 'INFO',
        path: 'question',
        messageKey: 'INFO_ONLY',
        evidence: { identity: 'DIFFICULTY_FIT_V1', revisionId: info.revision.id },
        evaluatorVersion: 'local-disabled-v1',
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL, semantic_finding_count=1 WHERE id=${infoRun.value.id}::uuid`;
    expect(
      (await getRevisionValidationReadiness(info.context, info.assessment.id, info.revision.id))
        .status,
    ).toBe('READY');
  });
});
