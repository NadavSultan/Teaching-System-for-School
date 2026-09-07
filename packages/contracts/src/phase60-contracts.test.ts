import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  approvalRequestSchema,
  approvalResultSchema,
  approvalStatusSchema,
  editorSaveRequestSchema,
  editorSaveResultSchema,
  studentSafePreviewSchema,
  teacherAssessmentListResponseSchema,
  teacherQuestionRegenerationRequestSchema,
  teacherQuestionRegenerationResultSchema,
  teacherQuestionRegenerationStatusSchema,
  teacherWorkspaceSchema,
} from './phase60.js';

const id = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const nodeId = '33333333-3333-4333-8333-333333333333';
const answer = { id: nodeId, key: 'a', order: 0, text: 'Answer', explanation: null };
const rubric = { id: nodeId, key: 'r', description: 'Rubric', order: 0, scoreUnits: 3 };
const question = {
  id: nodeId,
  logicalId: id,
  key: 'q',
  type: 'SHORT_TEXT',
  prompt: 'Question',
  instructions: null,
  order: 0,
  scoreUnits: 6,
  answers: [answer],
  rubrics: [rubric],
  subQuestions: [
    {
      id: nodeId,
      key: 'sq',
      prompt: 'Sub',
      order: 0,
      scoreUnits: 3,
      answers: [answer],
      rubrics: [rubric],
    },
  ],
};
const section = {
  id: nodeId,
  key: 's',
  title: 'Section',
  instructions: null,
  order: 0,
  scoreUnits: 6,
  questions: [question],
};
const workspace = {
  version: '1.0.0',
  assessment: {
    version: '1.0.0',
    id,
    type: 'WORKSHEET',
    title: 'Worksheet',
    latestRevisionNumber: 1,
    latestRevisionId: revisionId,
    latestApprovalRevisionId: null,
    updatedAt: '2026-09-03T00:00:00.000Z',
  },
  revision: {
    version: '1.0.0',
    id: revisionId,
    assessmentId: id,
    revisionNumber: 1,
    curriculumVersionId: nodeId,
    scoringMode: 'POINTS',
    totalScoreUnits: 6,
    finalized: true,
    curriculumNodeIds: [nodeId],
    sections: [section],
    baseRevisionId: null,
  },
  history: [
    {
      id: revisionId,
      assessmentId: id,
      revisionNumber: 1,
      baseRevisionId: null,
      createdAt: '2026-09-03T00:00:00.000Z',
      approvedAt: null,
      isLatest: true,
    },
  ],
  validation: {
    version: '1.0.0',
    id: id,
    assessmentId: id,
    assessmentRevisionId: revisionId,
    revisionSequence: 1,
    rulesetVersion: 'v1',
    evaluatorVersion: 'local-disabled-v1',
    attempts: 0,
    deterministicPassCount: 0,
    deterministicFailCount: 0,
    semanticFindingCount: 0,
    state: 'PENDING',
    failureCode: null,
    completedAt: null,
  },
  readiness: {
    version: '1.0.0',
    status: 'BLOCKED',
    reasonCode: 'VALIDATION_PENDING',
    validationRunId: id,
  },
  approval: {
    version: '1.0.0',
    assessmentRevisionId: revisionId,
    approved: false,
    approvalId: null,
    approvalSequence: null,
  },
};
const editor = {
  version: '1.0.0',
  assessmentId: id,
  baseRevisionId: revisionId,
  baseRevisionNumber: 1,
  idempotencyKey: 'save-1',
  sections: [
    {
      key: 's',
      title: 'Section',
      order: 0,
      scoreUnits: 6,
      questions: [
        {
          logicalId: id,
          key: 'q',
          type: 'SHORT_TEXT',
          prompt: 'Question',
          order: 0,
          scoreUnits: 6,
          answers: [{ key: 'a', order: 0, text: 'Answer' }],
          rubrics: [{ key: 'r', description: 'Rubric', order: 0, scoreUnits: 6 }],
          subQuestions: [
            {
              key: 'sq',
              prompt: 'Sub question',
              order: 0,
              scoreUnits: 3,
              answers: [{ key: 'sa', order: 0, text: 'Sub answer' }],
              rubrics: [{ key: 'sr', description: 'Sub rubric', order: 0, scoreUnits: 3 }],
            },
          ],
        },
      ],
    },
  ],
};
const safePreview = {
  version: '1.0.0',
  assessmentId: id,
  revisionId,
  title: 'דף',
  sections: [
    {
      title: 'סעיף',
      order: 0,
      questions: [{ logicalId: id, prompt: 'שאלה', instructions: null, order: 0, scoreUnits: 6 }],
    },
  ],
};

type Schema = {
  $ref?: string;
  type?: string;
  additionalProperties?: boolean;
  definitions?: Record<string, Schema>;
  properties?: Record<string, Schema>;
  items?: Schema;
};
const phase60Schemas = [
  'teacher-assessment-list-item.phase60.v1.json',
  'teacher-assessment-list-response.phase60.v1.json',
  'teacher-workspace.phase60.v1.json',
  'editor-save-request.phase60.v1.json',
  'editor-save-result.phase60.v1.json',
  'question-regeneration-request.phase60.v1.json',
  'question-regeneration-status.phase60.v1.json',
  'question-regeneration-result.phase60.v1.json',
  'student-safe-preview.phase60.v1.json',
  'approval-request.phase60.v1.json',
  'approval-result.phase60.v1.json',
  'approval-status.phase60.v1.json',
] as const;

function rejectsOneMutation<T>(
  schema: { parse(value: unknown): T },
  valid: unknown,
  mutate: (value: any) => void,
) {
  const pristine = structuredClone(valid);
  expect(schema.parse(pristine)).toEqual(pristine);
  const invalid = structuredClone(valid) as any;
  mutate(invalid);
  expect(() => schema.parse(invalid)).toThrow();
}

function assertStrictObjects(schema: Schema, root: Schema, seen = new Set<Schema>()) {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (schema.$ref) {
    const target = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<any>((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root);
    expect(target, `missing ${schema.$ref}`).toBeDefined();
    assertStrictObjects(target as Schema, root, seen);
    return;
  }
  if (schema.type === 'object') expect(schema.additionalProperties).toBe(false);
  for (const child of Object.values(schema.properties ?? {}))
    assertStrictObjects(child, root, seen);
  if (schema.items) assertStrictObjects(schema.items, root, seen);
  for (const child of Object.values(schema.definitions ?? {}))
    assertStrictObjects(child, root, seen);
}

describe('Phase 60 contracts', () => {
  it('K01 accepts valid fixtures for every Phase 60 request and response boundary', () => {
    expect(
      teacherAssessmentListResponseSchema.parse({
        version: '1.0.0',
        items: [workspace.assessment],
        nextCursor: null,
      }).items,
    ).toHaveLength(1);
    expect(teacherWorkspaceSchema.parse(workspace).revision.sections).toHaveLength(1);
    expect(editorSaveRequestSchema.parse(editor).sections).toHaveLength(1);
    expect(
      editorSaveResultSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        revisionId,
        revisionNumber: 2,
        baseRevisionId: revisionId,
      }).revisionNumber,
    ).toBe(2);
    expect(
      teacherQuestionRegenerationRequestSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        baseRevisionId: revisionId,
        logicalQuestionId: id,
        idempotencyKey: 'regen-1',
      }).logicalQuestionId,
    ).toBe(id);
    expect(
      teacherQuestionRegenerationStatusSchema.parse({
        version: '1.0.0',
        generationRunId: id,
        state: 'SUCCEEDED',
      }).state,
    ).toBe('SUCCEEDED');
    expect(
      teacherQuestionRegenerationResultSchema.parse({
        version: '1.0.0',
        generationRunId: id,
        outputRevisionId: revisionId,
        logicalQuestionId: id,
      }).outputRevisionId,
    ).toBe(revisionId);
    expect(studentSafePreviewSchema.parse(safePreview).sections).toHaveLength(1);
    expect(
      approvalRequestSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: revisionId,
        idempotencyKey: 'approve-1',
      }).assessmentId,
    ).toBe(id);
    expect(
      approvalResultSchema.parse({
        version: '1.0.0',
        approvalId: id,
        assessmentId: id,
        assessmentRevisionId: revisionId,
        validationRunId: nodeId,
        approvalSequence: 1,
        createdAt: '2026-09-03T00:00:00.000Z',
      }).approvalSequence,
    ).toBe(1);
    expect(
      approvalStatusSchema.parse({
        version: '1.0.0',
        assessmentRevisionId: revisionId,
        approved: false,
        approvalId: null,
        approvalSequence: null,
      }).approved,
    ).toBe(false);
  });
  it('K02 rejects added unknown keys at every top-level and nested boundary', () => {
    rejectsOneMutation(
      teacherAssessmentListResponseSchema,
      { version: '1.0.0', items: [workspace.assessment], nextCursor: null },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(
      teacherAssessmentListResponseSchema,
      { version: '1.0.0', items: [workspace.assessment], nextCursor: null },
      (v) => {
        v.items[0].extra = true;
      },
    );
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.assessment.extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].questions[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].questions[0].answers[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].questions[0].rubrics[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].questions[0].subQuestions[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].questions[0].subQuestions[0].answers[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.revision.sections[0].questions[0].subQuestions[0].rubrics[0].extra = true;
    });
    rejectsOneMutation(teacherWorkspaceSchema, workspace, (v) => {
      v.history[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].answers[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].rubrics[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].subQuestions[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].subQuestions[0].answers[0].extra = true;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].subQuestions[0].rubrics[0].extra = true;
    });
    rejectsOneMutation(
      editorSaveResultSchema,
      {
        version: '1.0.0',
        assessmentId: id,
        revisionId,
        revisionNumber: 2,
        baseRevisionId: revisionId,
      },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(
      teacherQuestionRegenerationRequestSchema,
      {
        version: '1.0.0',
        assessmentId: id,
        baseRevisionId: revisionId,
        logicalQuestionId: id,
        idempotencyKey: 'regen-1',
      },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(
      teacherQuestionRegenerationStatusSchema,
      { version: '1.0.0', generationRunId: id, state: 'SUCCEEDED' },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(
      teacherQuestionRegenerationResultSchema,
      {
        version: '1.0.0',
        generationRunId: id,
        outputRevisionId: revisionId,
        logicalQuestionId: id,
      },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.extra = true;
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].extra = true;
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].questions[0].extra = true;
    });
    rejectsOneMutation(
      approvalRequestSchema,
      {
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: revisionId,
        idempotencyKey: 'approve',
      },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(
      approvalResultSchema,
      {
        version: '1.0.0',
        approvalId: id,
        assessmentId: id,
        assessmentRevisionId: revisionId,
        validationRunId: nodeId,
        approvalSequence: 1,
        createdAt: '2026-09-03T00:00:00.000Z',
      },
      (v) => {
        v.extra = true;
      },
    );
    rejectsOneMutation(
      approvalStatusSchema,
      {
        version: '1.0.0',
        assessmentRevisionId: revisionId,
        approved: false,
        approvalId: null,
        approvalSequence: null,
      },
      (v) => {
        v.extra = true;
      },
    );
  });
  it('K03 rejects invalid UUID version text order score-unit and idempotency fixtures', () => {
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.assessmentId = 'bad';
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.version = '2.0.0';
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.baseRevisionNumber = 0;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.baseRevisionNumber = 1.5;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.idempotencyKey = ' ';
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.idempotencyKey = 'x'.repeat(256);
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].title = ' ';
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].order = -1;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].scoreUnits = 1.5;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].prompt = 'x'.repeat(20_001);
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].answers[0].order = 0.5;
    });
    rejectsOneMutation(
      approvalRequestSchema,
      {
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: revisionId,
        idempotencyKey: 'approve',
      },
      (v) => {
        v.assessmentRevisionId = 'bad';
      },
    );
  });
  it('K04 rejects every prohibited editor authority and evidence field', () => {
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.organizationId = id;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.actorUserId = id;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.revisionNumber = 2;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.state = 'FINALIZED';
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.provenance = {};
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.validationRunId = id;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.approvalSequence = 1;
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.audit = {};
    });
    rejectsOneMutation(editorSaveRequestSchema, editor, (v) => {
      v.sections[0].questions[0].evidence = {};
    });
  });
  it('K05 rejects every prohibited approval authority readiness and evidence field', () => {
    const valid = {
      version: '1.0.0',
      assessmentId: id,
      assessmentRevisionId: revisionId,
      idempotencyKey: 'approve',
    };
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.organizationId = id;
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.approvingUserId = id;
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.approvalSequence = 1;
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.validationRunId = id;
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.readiness = 'READY';
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.verdict = 'PASS';
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.createdAt = '2026-09-03T00:00:00.000Z';
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.contractVersion = '1.0.0';
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.validationRulesetVersion = 'v1';
    });
    rejectsOneMutation(approvalRequestSchema, valid, (v) => {
      v.evidence = {};
    });
  });
  it('K06 accepts nonempty student-safe content and rejects teacher-only keys at every depth', () => {
    expect(studentSafePreviewSchema.parse(safePreview).sections[0]?.questions[0]?.prompt).toBe(
      'שאלה',
    );
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.answer = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.explanation = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.rubric = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.internalNote = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.teacherOnly = true;
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].answer = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].questions[0].answer = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].questions[0].explanation = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].questions[0].rubric = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].questions[0].internalNote = 'x';
    });
    rejectsOneMutation(studentSafePreviewSchema, safePreview, (v) => {
      v.sections[0].questions[0].teacherOnly = true;
    });
  });
  it('K07 keeps committed generated schemas strict and exactly generation-checkable', () => {
    expect(phase60Schemas).toHaveLength(12);
    expect(() =>
      execFileSync(
        process.execPath,
        ['node_modules/typescript/bin/tsc', '-p', 'packages/contracts/tsconfig.json'],
        {
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
    expect(() =>
      execFileSync(
        process.execPath,
        ['packages/contracts/scripts/generate-schemas.mjs', '--check'],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
    for (const file of phase60Schemas) {
      const schema = JSON.parse(
        readFileSync(`packages/contracts/schemas/${file}`, 'utf8'),
      ) as Schema;
      assertStrictObjects(schema, schema);
    }
  });
  it('K08 preserves logical IDs ordering nullability and integer score units losslessly', () => {
    const parsed = teacherWorkspaceSchema.parse(workspace);
    expect(parsed.revision.sections[0]?.questions[0]?.logicalId).toBe(id);
    expect(parsed.revision.sections[0]?.order).toBe(0);
    expect(parsed.revision.sections[0]?.questions[0]?.instructions).toBeNull();
    expect(parsed.revision.sections[0]?.questions[0]?.answers[0]?.explanation).toBeNull();
    expect(parsed.history[0]?.baseRevisionId).toBeNull();
    expect(parsed.revision.sections[0]?.questions[0]?.scoreUnits).toBe(6);
    expect(Number.isInteger(parsed.revision.sections[0]?.questions[0]?.scoreUnits)).toBe(true);
    expect(parsed.revision.totalScoreUnits).toBe(6);
    expect(parsed.revision.sections[0]?.questions[0]?.subQuestions[0]?.order).toBe(0);
    expect(editorSaveRequestSchema.parse(editor).sections[0]?.questions[0]?.logicalId).toBe(id);
    expect(
      approvalStatusSchema.parse({
        version: '1.0.0',
        assessmentRevisionId: revisionId,
        approved: false,
        approvalId: null,
        approvalSequence: null,
      }).approvalSequence,
    ).toBeNull();
  });
});
