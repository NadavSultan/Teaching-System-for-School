import { describe, expect, it } from 'vitest';
import {
  canTransitionCurriculumLifecycle,
  MAX_SCORE_UNITS,
  validateCurriculumHierarchy,
  validateScoreTree,
} from './index.js';

describe('Phase 20 domain invariants', () => {
  it('accepts the typed curriculum chain and rejects invalid hierarchy rules', () => {
    expect(
      validateCurriculumHierarchy([
        {
          type: 'GRADE',
          code: 'G7',
          sortOrder: 0,
          children: [
            {
              type: 'DOMAIN',
              code: 'D',
              sortOrder: 0,
              children: [
                {
                  type: 'TOPIC',
                  code: 'T',
                  sortOrder: 0,
                  children: [
                    {
                      type: 'SUBTOPIC',
                      code: 'S',
                      sortOrder: 0,
                      children: [{ type: 'SKILL', code: 'K', sortOrder: 0, difficulties: ['LOW'] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual([]);
    expect(validateCurriculumHierarchy([{ type: 'DOMAIN', code: 'D', sortOrder: 0 }])).not.toEqual(
      [],
    );
    expect(
      validateCurriculumHierarchy([
        { type: 'GRADE', code: 'G', sortOrder: 0, difficulties: ['LOW'] },
      ]),
    ).not.toEqual([]);
    expect(
      validateCurriculumHierarchy([
        {
          type: 'GRADE',
          code: 'G',
          sortOrder: 0,
          children: [
            {
              type: 'DOMAIN',
              code: 'D',
              sortOrder: 0,
              children: [
                {
                  type: 'TOPIC',
                  code: 'T',
                  sortOrder: 0,
                  children: [
                    {
                      type: 'SUBTOPIC',
                      code: 'S',
                      sortOrder: 0,
                      children: [
                        {
                          type: 'SKILL',
                          code: 'K',
                          sortOrder: 0,
                          children: [{ type: 'GRADE', code: 'BAD', sortOrder: 0 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ).not.toEqual([]);
  });

  it('uses exact integer scoring and rejects inconsistent totals', () => {
    const sections = [
      {
        scoreUnits: 10_000,
        questions: [
          { scoreUnits: 10_000, subQuestions: [{ scoreUnits: 5_000 }, { scoreUnits: 5_000 }] },
        ],
      },
    ];
    expect(validateScoreTree('POINTS', 'TEST', 10_000, sections)).toEqual([]);
    expect(validateScoreTree('NONE', 'TEST', null, [])).not.toEqual([]);
    expect(validateScoreTree('POINTS', 'WORKSHEET', MAX_SCORE_UNITS + 1, [])).not.toEqual([]);
    expect(
      validateScoreTree('NONE', 'WORKSHEET', null, [
        { scoreUnits: null, questions: [{ scoreUnits: 1, subQuestions: [] }] },
      ]),
    ).not.toEqual([]);
    expect(
      validateScoreTree('POINTS', 'WORKSHEET', 100, [
        { scoreUnits: 100, questions: [{ scoreUnits: 100, rubricScores: [50, null] }] },
      ]),
    ).not.toEqual([]);
    expect(
      validateScoreTree('POINTS', 'WORKSHEET', 100, [
        { scoreUnits: 100, questions: [{ scoreUnits: 100, rubricScores: [null, null] }] },
      ]),
    ).toEqual([]);
  });

  it('allows only forward curriculum lifecycle transitions', () => {
    expect(canTransitionCurriculumLifecycle('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransitionCurriculumLifecycle('PUBLISHED', 'DEPRECATED')).toBe(true);
    expect(canTransitionCurriculumLifecycle('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransitionCurriculumLifecycle('DEPRECATED', 'PUBLISHED')).toBe(false);
  });

  it('enforces the aggregate hierarchy-size boundary', () => {
    const nodes = Array.from({ length: 10_001 }, (_, index) => ({
      type: 'GRADE' as const,
      code: `G${index}`,
      sortOrder: index,
    }));
    expect(validateCurriculumHierarchy(nodes)).toContain('nodes: hierarchy exceeds 10000 nodes');
  });

  it('makes depth greater than five and cycles impossible after terminal SKILL', () => {
    const errors = validateCurriculumHierarchy([
      {
        type: 'GRADE',
        code: 'G',
        sortOrder: 0,
        children: [
          {
            type: 'DOMAIN',
            code: 'D',
            sortOrder: 0,
            children: [
              {
                type: 'TOPIC',
                code: 'T',
                sortOrder: 0,
                children: [
                  {
                    type: 'SUBTOPIC',
                    code: 'S',
                    sortOrder: 0,
                    children: [
                      {
                        type: 'SKILL',
                        code: 'K',
                        sortOrder: 0,
                        difficulties: ['LOW'],
                        children: [{ type: 'GRADE', code: 'CYCLE', sortOrder: 0 }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(errors.some((error) => error.includes('SKILL cannot have children'))).toBe(true);
  });
});
