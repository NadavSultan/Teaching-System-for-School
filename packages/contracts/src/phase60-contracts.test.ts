import { describe, expect, it } from 'vitest';
import {
  approvalRequestSchema,
  approvalResultSchema,
  approvalStatusSchema,
  editorSaveRequestSchema,
  editorSaveResultSchema,
  studentSafePreviewSchema,
  teacherAssessmentListResponseSchema,
  teacherWorkspaceSchema,
} from './phase60.js';

const id = '11111111-1111-4111-8111-111111111111';
const anotherId = '22222222-2222-4222-8222-222222222222';

describe('Phase 60 contracts', () => {
  it('K01 accepts only a versioned strict assessment list response', () => {
    expect(
      teacherAssessmentListResponseSchema.parse({ version: '1.0.0', items: [], nextCursor: null }),
    ).toMatchObject({ items: [] });
    expect(() =>
      teacherAssessmentListResponseSchema.parse({
        version: '1.0.0',
        items: [],
        nextCursor: null,
        organizationId: id,
      }),
    ).toThrow();
  });

  it('K02 requires an immutable revision and deterministic history fields in the workspace', () => {
    expect(() =>
      teacherWorkspaceSchema.parse({ version: '1.0.0', assessment: {}, revision: {}, history: [] }),
    ).toThrow();
  });

  it('K03 rejects editor-save authority and approval fields supplied by a client', () => {
    expect(() =>
      editorSaveRequestSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        baseRevisionId: anotherId,
        idempotencyKey: 'save',
        sections: [],
        organizationId: id,
      }),
    ).toThrow();
  });

  it('K04 bounds and normalizes editor-save identity fields', () => {
    expect(() =>
      editorSaveRequestSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        baseRevisionId: anotherId,
        idempotencyKey: ' ',
        sections: [],
      }),
    ).toThrow();
  });

  it('K05 makes the editor-save result carry a new revision and exact base revision', () => {
    expect(
      editorSaveResultSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        revisionId: anotherId,
        revisionNumber: 2,
        baseRevisionId: id,
      }),
    ).toMatchObject({ revisionNumber: 2 });
  });

  it('K06 constructs student preview with no answer, rubric, explanation, or internal-note field', () => {
    const preview = studentSafePreviewSchema.parse({
      version: '1.0.0',
      assessmentId: id,
      revisionId: anotherId,
      title: 'דף עבודה',
      sections: [],
    });
    expect(JSON.stringify(preview)).not.toMatch(/answer|rubric|explanation|internal/i);
  });

  it('K07 rejects client-supplied validation and approval sequence authority', () => {
    expect(() =>
      approvalRequestSchema.parse({
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: anotherId,
        idempotencyKey: 'approve',
        validationRunId: id,
        approvalSequence: 1,
      }),
    ).toThrow();
  });

  it('K08 exposes only versioned approval result/status contracts', () => {
    expect(
      approvalResultSchema.parse({
        version: '1.0.0',
        approvalId: id,
        assessmentId: id,
        assessmentRevisionId: anotherId,
        validationRunId: id,
        approvalSequence: 1,
        createdAt: '2026-09-03T00:00:00.000Z',
      }),
    ).toMatchObject({ approvalSequence: 1 });
    expect(
      approvalStatusSchema.parse({
        version: '1.0.0',
        assessmentRevisionId: anotherId,
        approved: false,
        approvalId: null,
        approvalSequence: null,
      }),
    ).toMatchObject({ approved: false });
  });
});
