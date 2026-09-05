import { describe, expect, it } from 'vitest';
import { EditorSnapshotError, prepareEditedSnapshot } from './editor.js';

const logicalId = '11111111-1111-4111-8111-111111111111';
const base = {
  scoringMode: 'NONE' as const,
  totalScoreUnits: null,
  sections: [
    {
      key: 's1',
      title: 'Base',
      instructions: null,
      order: 0,
      scoreUnits: null,
      questions: [
        {
          logicalId,
          key: 'q1',
          type: 'SHORT_TEXT',
          prompt: 'Base prompt',
          instructions: null,
          order: 0,
          scoreUnits: null,
          answers: [{ key: 'a1', order: 0, text: 'A', explanation: null }],
          rubrics: [],
          subQuestions: [],
        },
      ],
    },
  ],
};

describe('Phase 60 pure editor', () => {
  it('preserves a carried question identity and allocates identity only for a new question', () => {
    const target: any[] = structuredClone(base.sections);
    target[0]!.questions.push({
      logicalId: undefined as unknown as string,
      key: 'q2',
      type: 'SHORT_TEXT',
      prompt: 'New',
      instructions: null,
      order: 1,
      scoreUnits: null,
      answers: [],
      rubrics: [],
      subQuestions: [],
    });
    const result = prepareEditedSnapshot({
      assessmentType: 'WORKSHEET',
      base,
      sections: target,
      allocateLogicalId: () => '22222222-2222-4222-8222-222222222222',
    });
    expect(result.sections[0]!.questions.map((q) => q.logicalId)).toEqual([
      logicalId,
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(base.sections[0]!.questions[0]!.prompt).toBe('Base prompt');
  });

  it('rejects unknown supplied logical identity instead of accepting a client-forged identity', () => {
    const target: any[] = structuredClone(base.sections);
    target[0]!.questions[0]!.logicalId = '33333333-3333-4333-8333-333333333333';
    expect(() =>
      prepareEditedSnapshot({
        assessmentType: 'WORKSHEET',
        base,
        sections: target,
        allocateLogicalId: () => crypto.randomUUID(),
      }),
    ).toThrowError(EditorSnapshotError);
  });

  it('rejects omission of the identity for an existing keyed question', () => {
    const target: any[] = structuredClone(base.sections);
    delete target[0]!.questions[0]!.logicalId;
    expect(() =>
      prepareEditedSnapshot({
        assessmentType: 'WORKSHEET',
        base,
        sections: target,
        allocateLogicalId: () => crypto.randomUUID(),
      }),
    ).toThrow(/MISSING_LOGICAL_QUESTION_IDENTITY/);
  });

  it('rejects duplicate keys orders and logical identities before persistence', () => {
    const target: any[] = structuredClone(base.sections);
    target.push(structuredClone(target[0]!));
    expect(() =>
      prepareEditedSnapshot({
        assessmentType: 'WORKSHEET',
        base,
        sections: target,
        allocateLogicalId: () => crypto.randomUUID(),
      }),
    ).toThrow(/DUPLICATE_/);
  });

  it('uses inherited scoring mode and rejects an invalid integer score tree', () => {
    const target: any[] = structuredClone(base.sections);
    target[0]!.scoreUnits = 1;
    expect(() =>
      prepareEditedSnapshot({
        assessmentType: 'WORKSHEET',
        base,
        sections: target,
        allocateLogicalId: () => crypto.randomUUID(),
      }),
    ).toThrow(/NONE_MUST_BE_NULL/);
  });
});
