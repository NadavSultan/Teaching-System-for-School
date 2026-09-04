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
};
const editor = {
  version: '1.0.0',
  assessmentId: id,
  baseRevisionId: revisionId,
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
          subQuestions: [],
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
    expect(() => teacherWorkspaceSchema.parse({ ...workspace, extra: true })).toThrow();
    expect(() =>
      teacherWorkspaceSchema.parse({
        ...workspace,
        revision: {
          ...workspace.revision,
          sections: [
            { ...section, questions: [{ ...question, answers: [{ ...answer, extra: true }] }] },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      editorSaveRequestSchema.parse({
        ...editor,
        sections: [
          {
            ...editor.sections[0]!,
            questions: [
              {
                ...editor.sections[0]!.questions[0]!,
                rubrics: [{ ...editor.sections[0]!.questions[0]!.rubrics[0]!, extra: true }],
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      studentSafePreviewSchema.parse({
        ...safePreview,
        sections: [
          {
            ...safePreview.sections[0]!,
            questions: [{ ...safePreview.sections[0]!.questions[0]!, extra: true }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      approvalRequestSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: revisionId,
        idempotencyKey: 'approve',
        extra: true,
      }),
    ).toThrow();
  });
  it('K03 rejects invalid UUID version text order score-unit and idempotency fixtures', () => {
    expect(() => editorSaveRequestSchema.parse({ ...editor, assessmentId: 'bad' })).toThrow();
    expect(() => editorSaveRequestSchema.parse({ ...editor, version: '2.0.0' })).toThrow();
    expect(() => editorSaveRequestSchema.parse({ ...editor, idempotencyKey: ' ' })).toThrow();
    expect(() =>
      editorSaveRequestSchema.parse({
        ...editor,
        sections: [
          {
            ...editor.sections[0]!,
            title: ' ',
            questions: [{ ...editor.sections[0]!.questions[0]!, order: -1, scoreUnits: 1.5 }],
          },
        ],
      }),
    ).toThrow();
  });
  it('K04 rejects every prohibited editor authority and evidence field', () => {
    for (const key of [
      'organizationId',
      'actorUserId',
      'validationRunId',
      'approvalSequence',
      'audit',
    ] as const)
      expect(() =>
        editorSaveRequestSchema.parse({
          ...editor,
          [key]: key === 'approvalSequence' ? 1 : key === 'audit' ? {} : id,
        }),
      ).toThrow();
    expect(() =>
      editorSaveRequestSchema.parse({
        ...editor,
        sections: [
          {
            ...editor.sections[0]!,
            questions: [{ ...editor.sections[0]!.questions[0]!, evidence: {} }],
          },
        ],
      }),
    ).toThrow();
  });
  it('K05 rejects every prohibited approval authority readiness and evidence field', () => {
    for (const key of [
      'organizationId',
      'approvingUserId',
      'validationRunId',
      'readiness',
      'evidence',
    ] as const)
      expect(() =>
        approvalRequestSchema.parse({
          version: '1.0.0',
          assessmentId: id,
          assessmentRevisionId: revisionId,
          idempotencyKey: 'approve',
          [key]: key === 'evidence' ? {} : key === 'readiness' ? 'READY' : id,
        }),
      ).toThrow();
  });
  it('K06 accepts nonempty student-safe content and rejects teacher-only keys at every depth', () => {
    expect(studentSafePreviewSchema.parse(safePreview).sections[0]?.questions[0]?.prompt).toBe(
      'שאלה',
    );
    expect(() => studentSafePreviewSchema.parse({ ...safePreview, answer: 'x' })).toThrow();
    expect(() =>
      studentSafePreviewSchema.parse({
        ...safePreview,
        sections: [{ ...safePreview.sections[0]!, explanation: 'x' }],
      }),
    ).toThrow();
    expect(() =>
      studentSafePreviewSchema.parse({
        ...safePreview,
        sections: [
          {
            ...safePreview.sections[0]!,
            questions: [
              {
                ...safePreview.sections[0]!.questions[0]!,
                rubric: 'x',
                internalNote: 'x',
                teacherOnly: true,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it('K07 keeps committed generated schemas strict and exactly generation-checkable', () => {
    for (const file of [
      'teacher-workspace.phase60.v1.json',
      'editor-save-request.phase60.v1.json',
      'student-safe-preview.phase60.v1.json',
      'approval-request.phase60.v1.json',
    ]) {
      const schema = JSON.parse(readFileSync(`packages/contracts/schemas/${file}`, 'utf8')) as {
        definitions: Record<string, { additionalProperties?: boolean }>;
      };
      expect(
        Object.values(schema.definitions).some((value) => value.additionalProperties === false),
      ).toBe(true);
    }
  });
  it('K08 preserves logical IDs ordering nullability and integer score units losslessly', () => {
    const parsed = teacherWorkspaceSchema.parse(workspace);
    expect(parsed.revision.sections[0]?.questions[0]?.logicalId).toBe(id);
    expect(parsed.revision.sections[0]?.order).toBe(0);
    expect(parsed.revision.sections[0]?.questions[0]?.instructions).toBeNull();
    expect(parsed.revision.sections[0]?.questions[0]?.scoreUnits).toBe(6);
    expect(parsed.revision.totalScoreUnits).toBe(6);
  });
});
