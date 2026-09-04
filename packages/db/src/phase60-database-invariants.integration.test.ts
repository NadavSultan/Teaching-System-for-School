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
  email: 'phase60@example.test',
  provider: 'test',
  providerSubject: userId,
  platformAdmin: false,
});

async function fixture() {
  const workspace = await createPersonalWorkspace({
    email: `phase60-${crypto.randomUUID()}@example.test`,
    workspaceName: 'phase60',
  });
  const curriculum = await prisma.curriculum.create({
    data: {
      code: `P60_${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      educationSystemCode: 'IL',
      subjectCode: 'HE',
      displayName: 'Phase 60',
    },
  });
  const version = await prisma.curriculumVersion.create({
    data: { curriculumId: curriculum.id, versionNumber: 1 },
  });
  const node = await prisma.curriculumNode.create({
    data: {
      versionId: version.id,
      type: 'GRADE',
      code: `G${Math.floor(Math.random() * 9_000 + 1_000)}`,
      label: 'Grade',
      sortOrder: 1,
    },
  });
  await publishCurriculumVersion(version.id, workspace.user.id);
  const assessment = await prisma.assessment.create({
    data: {
      organizationId: workspace.organization.id,
      type: 'WORKSHEET',
      title: 'Phase 60',
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
    idempotencyKey: crypto.randomUUID(),
    curriculumVersionId: version.id,
    curriculumNodeIds: [node.id],
    scoringMode: 'NONE',
    sections: [
      {
        key: 's',
        title: 'Section',
        order: 0,
        questions: [
          {
            key: 'q',
            type: 'SHORT_TEXT',
            prompt: 'Question',
            order: 0,
            answers: [{ key: 'a', order: 0, text: 'Answer' }],
            rubrics: [],
            subQuestions: [],
          },
        ],
      },
    ],
  });
  return { workspace, assessment, revision, context, version, node };
}

async function readyRun(f: Awaited<ReturnType<typeof fixture>>) {
  const run = await prisma.validationRun.create({
    data: {
      organizationId: f.workspace.organization.id,
      assessmentId: f.assessment.id,
      assessmentRevisionId: f.revision.id,
      requestingUserId: f.workspace.user.id,
      rulesetVersion: 'v1',
      evaluatorVersion: 'local-disabled-v1',
      revisionSequence: 1,
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: 'a'.repeat(64),
    },
  });
  await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute', deterministic_pass_count=11 WHERE id=${run.id}::uuid`;
  const rules = await prisma.validationRuleDefinition.findMany({
    where: { rulesetVersion: 'v1' },
    orderBy: { deterministicOrder: 'asc' },
  });
  for (const rule of rules)
    await prisma.validationRuleExecution.create({
      data: {
        validationRunId: run.id,
        ruleDefinitionId: rule.id,
        outcome: 'PASS',
        evidence: { identity: rule.ruleId, revisionId: f.revision.id },
      },
    });
  await prisma.semanticEvaluation.create({
    data: {
      validationRunId: run.id,
      evaluatorVersion: 'local-disabled-v1',
      promptVersion: 'validation-prompt-v1',
      modelConfigurationVersion: 'local-none-v1',
      schemaVersion: '1.0.0',
      state: 'SUCCEEDED',
    },
  });
  await prisma.$executeRaw`UPDATE validation_runs SET state='SUCCEEDED', completed_at=now(), lease_expires_at=NULL WHERE id=${run.id}::uuid`;
  return run;
}

const insertApproval = (
  f: Awaited<ReturnType<typeof fixture>>,
  runId: string,
  key = crypto.randomUUID(),
) =>
  prisma.$executeRaw`INSERT INTO assessment_approvals (organization_id,assessment_id,assessment_revision_id,validation_run_id,approving_user_id,approval_sequence,idempotency_key,request_fingerprint,contract_version,validation_ruleset_version) VALUES (${f.workspace.organization.id}::uuid,${f.assessment.id}::uuid,${f.revision.id}::uuid,${runId}::uuid,${f.workspace.user.id}::uuid,1,${key},${'b'.repeat(64)},'1.0.0','v1')`;
const rejects = async (operation: () => Promise<unknown>, code: string, message: string) => {
  try {
    await operation();
    throw new Error('operation unexpectedly succeeded');
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    expect(raw).toContain(code);
    expect(raw).toContain(message);
  }
};

describe('Phase 60 direct PostgreSQL database invariants', () => {
  afterAll(() => prisma.$disconnect());
  it('D01 rejects a forged organization/assessment ownership tuple', async () => {
    const f = await fixture();
    const other = await fixture();
    await rejects(
      () =>
        prisma.$executeRaw`INSERT INTO assessment_approvals (organization_id,assessment_id,assessment_revision_id,validation_run_id,approving_user_id,approval_sequence,idempotency_key,request_fingerprint,contract_version,validation_ruleset_version) VALUES (${other.workspace.organization.id}::uuid,${f.assessment.id}::uuid,${f.revision.id}::uuid,${crypto.randomUUID()}::uuid,${other.workspace.user.id}::uuid,1,'d01',${'a'.repeat(64)},'1.0.0','v1')`,
      'P6010',
      'phase60 approval assessment owner does not match organization',
    );
  });
  it('D02 rejects a validation run that belongs to another revision', async () => {
    const f = await fixture();
    const other = await fixture();
    const run = await readyRun(f);
    const foreignRun = await readyRun(other);
    await rejects(
      () =>
        prisma.$executeRaw`INSERT INTO assessment_approvals (organization_id,assessment_id,assessment_revision_id,validation_run_id,approving_user_id,approval_sequence,idempotency_key,request_fingerprint,contract_version,validation_ruleset_version) VALUES (${f.workspace.organization.id}::uuid,${f.assessment.id}::uuid,${f.revision.id}::uuid,${foreignRun.id}::uuid,${f.workspace.user.id}::uuid,1,'d02',${'a'.repeat(64)},'1.0.0','v1')`,
      'P6014',
      'phase60 approval validation identity is not approvable',
    );
    expect(run.id).toBeTruthy();
  });
  it('D03 rejects inactive persisted actor authority', async () => {
    const f = await fixture();
    const run = await readyRun(f);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE memberships SET status='INACTIVE' WHERE user_id=${f.workspace.user.id}::uuid AND organization_id=${f.workspace.organization.id}::uuid`;
    });
    await rejects(
      () => insertApproval(f, run.id),
      'P6013',
      'phase60 approval requires an active non-platform teacher authority',
    );
  });
  it('D04 rejects approval of a nonlatest revision', async () => {
    const f = await fixture();
    const run = await readyRun(f);
    await createAssessmentRevision(f.context, {
      version: '1.0.0',
      assessmentId: f.assessment.id,
      idempotencyKey: crypto.randomUUID(),
      curriculumVersionId: f.version.id,
      curriculumNodeIds: [f.node.id],
      scoringMode: 'NONE',
      sections: [
        {
          key: 's2',
          title: 'Section',
          order: 0,
          questions: [
            {
              key: 'q2',
              type: 'SHORT_TEXT',
              prompt: 'Question',
              order: 0,
              answers: [{ key: 'a2', order: 0, text: 'Answer' }],
              rubrics: [],
              subQuestions: [],
            },
          ],
        },
      ],
    });
    await rejects(
      () => insertApproval(f, run.id),
      'P6012',
      'phase60 approval requires the latest revision',
    );
  });
  it('D05 rejects approval without complete Phase 50 readiness evidence', async () => {
    const f = await fixture();
    await rejects(
      () => insertApproval(f, crypto.randomUUID()),
      'P5029',
      'phase50 revision is not approvable',
    );
    const nonready = await prisma.validationRun.create({
      data: {
        organizationId: f.workspace.organization.id,
        assessmentId: f.assessment.id,
        assessmentRevisionId: f.revision.id,
        requestingUserId: f.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 1,
        idempotencyKey: 'd05-pending',
        requestFingerprint: 'e'.repeat(64),
      },
    });
    await rejects(
      () => insertApproval(f, nonready.id),
      'P5029',
      'phase50 revision is not approvable',
    );
    const corrupt = await fixture();
    const corruptRun = await readyRun(corrupt);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRaw`UPDATE validation_rule_executions SET evidence='{}'::jsonb WHERE validation_run_id=${corruptRun.id}::uuid`;
    });
    await rejects(
      () => insertApproval(corrupt, corruptRun.id),
      'P5029',
      'phase50 revision is not approvable',
    );
    const incomplete = await fixture();
    const incompleteRun = await prisma.validationRun.create({
      data: {
        organizationId: incomplete.workspace.organization.id,
        assessmentId: incomplete.assessment.id,
        assessmentRevisionId: incomplete.revision.id,
        requestingUserId: incomplete.workspace.user.id,
        rulesetVersion: 'v1',
        evaluatorVersion: 'local-disabled-v1',
        revisionSequence: 1,
        idempotencyKey: 'd05-incomplete',
        requestFingerprint: 'f'.repeat(64),
      },
    });
    await prisma.$executeRaw`UPDATE validation_runs SET state='PROCESSING', attempts=1, processing_started_at=now(), lease_expires_at=now()+interval '1 minute' WHERE id=${incompleteRun.id}::uuid`;
    await rejects(
      () => insertApproval(incomplete, incompleteRun.id),
      'P5029',
      'phase50 revision is not approvable',
    );
  });
  it('D06 rejects direct approval update', async () => {
    const f = await fixture();
    const run = await readyRun(f);
    await insertApproval(f, run.id);
    const approval = await prisma.assessmentApproval.findUniqueOrThrow({
      where: { assessmentRevisionId: f.revision.id },
    });
    await rejects(
      () =>
        prisma.$executeRaw`UPDATE assessment_approvals SET request_fingerprint=${'c'.repeat(64)} WHERE id=${approval.id}::uuid`,
      'P6018',
      'phase60 approvals are append-only',
    );
  });
  it('D07 rejects direct approval delete', async () => {
    const f = await fixture();
    const run = await readyRun(f);
    await insertApproval(f, run.id);
    await rejects(
      () =>
        prisma.$executeRaw`DELETE FROM assessment_approvals WHERE assessment_revision_id=${f.revision.id}::uuid`,
      'P6018',
      'phase60 approvals are append-only',
    );
  });
  it('D08 rejects forged cross-assessment revision lineage', async () => {
    const f = await fixture();
    const other = await fixture();
    await rejects(
      () =>
        prisma.$executeRaw`INSERT INTO assessment_revisions (assessment_id,revision_number,idempotency_key,request_fingerprint,state,curriculum_version_id,scoring_mode,base_revision_id) VALUES (${f.assessment.id}::uuid,2,'d08',${'d'.repeat(64)},'BUILDING',${f.version.id}::uuid,'NONE',${other.revision.id}::uuid)`,
      'P6003',
      'phase60 base revision must be finalized and owned by the same assessment',
    );
    const otherQuestion = await prisma.assessmentQuestion.findFirstOrThrow({
      where: { section: { revisionId: other.revision.id } },
    });
    const building = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      return tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO assessment_revisions (assessment_id,revision_number,idempotency_key,request_fingerprint,state,curriculum_version_id,scoring_mode) VALUES (${f.assessment.id}::uuid,2,'d08-question',${'e'.repeat(64)},'BUILDING',${f.version.id}::uuid,'NONE') RETURNING id`;
    });
    const buildingSection = await prisma.$queryRaw<
      Array<{ id: string }>
    >`INSERT INTO assessment_sections (revision_id,key,title,"order") VALUES (${building[0]!.id}::uuid,'d08','D08',0) RETURNING id`;
    await rejects(
      () =>
        prisma.$executeRaw`INSERT INTO assessment_questions (section_id,logical_id,key,type,prompt,"order") VALUES (${buildingSection[0]!.id}::uuid,${otherQuestion.logicalId}::uuid,'d08','SHORT_TEXT','D08',0)`,
      'P6002',
      'phase60 logical question identity cannot cross assessments',
    );
  });

  it('serializes concurrent revision creation and rejects a stale approval after the newer revision', async () => {
    const f = await fixture();
    const run = await readyRun(f);
    const create = (key: string) =>
      createAssessmentRevision(f.context, {
        version: '1.0.0',
        assessmentId: f.assessment.id,
        idempotencyKey: key,
        curriculumVersionId: f.version.id,
        curriculumNodeIds: [f.node.id],
        scoringMode: 'NONE',
        sections: [
          {
            key,
            title: 'Concurrent',
            order: 0,
            questions: [
              {
                key: `${key}-q`,
                type: 'SHORT_TEXT',
                prompt: 'Concurrent question',
                order: 0,
                answers: [{ key: 'a', order: 0, text: 'Answer' }],
                rubrics: [],
                subQuestions: [],
              },
            ],
          },
        ],
      });
    const outcomes = await Promise.all([
      create('lock-a').then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      create('lock-b').then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
    ]);
    const created = outcomes.flatMap((outcome) => ('value' in outcome ? [outcome.value] : []));
    expect(created).toHaveLength(2);
    expect(created.map((value) => value.revisionNumber).sort()).toEqual([2, 3]);
    expect(
      await prisma.assessmentRevision.count({ where: { assessmentId: f.assessment.id } }),
    ).toBe(3);
    await rejects(
      () => insertApproval(f, run.id),
      'P6012',
      'phase60 approval requires the latest revision',
    );
    expect(
      await prisma.assessmentApproval.count({ where: { assessmentId: f.assessment.id } }),
    ).toBe(0);
  });
});
