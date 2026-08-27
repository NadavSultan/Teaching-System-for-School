import { describe, expect, it } from 'vitest';
import {
  evaluateDeterministicRules,
  hasExactAnswerLeakage,
  validationRules,
} from './validation.js';

const link = () => ({
  questionId: 'q1',
  revisionId: 'r1',
  sourceVersionId: 'sv1',
  knowledgeItemId: 'ki1',
  locator: 'paragraph:1',
  contentHash: 'hash-1',
  sourceVersion: { id: 'sv1', sourceId: 'source1', sourceOrganizationId: 'org1' },
  knowledgeItem: { id: 'ki1', sourceVersionId: 'sv1', organizationId: 'org1' },
  eligibility: {
    pedagogicalApproved: true,
    usageAllowed: true,
    sourceLifecycle: 'ACTIVE',
    itemLifecycle: 'ACTIVE',
    visibilityPermitted: true,
    exactPublishedCurriculum: true,
  },
  provenance: {
    generationRunId: 'g1',
    generationRunState: 'SUCCEEDED',
    operation: 'DRAFT',
    assessmentId: 'a1',
    curriculumVersionId: 'cv1',
    outputRevisionId: 'r1',
    promptTemplateVersion: 'draft-v1',
    promptTemplateHash: 'prompt-hash',
    modelConfigurationVersion: 'fake-v1',
    modelConfigurationHash: 'model-hash',
    responseSchemaVersion: '1.0.0',
    responseSchemaHash: 'schema-hash',
    revisionId: 'r1',
    questionId: 'q1',
    sourceVersionId: 'sv1',
    knowledgeItemId: 'ki1',
  },
});
export const snapshot = () => ({
  id: 'r1',
  generationRunId: 'g1',
  generationOperation: 'DRAFT' as const,
  promptTemplateVersion: 'draft-v1',
  promptTemplateHash: 'prompt-hash',
  modelConfigurationVersion: 'fake-v1',
  modelConfigurationHash: 'model-hash',
  responseSchemaVersion: '1.0.0',
  responseSchemaHash: 'schema-hash',
  assessmentId: 'a1',
  organizationId: 'org1',
  ownerOrganizationId: 'org1',
  state: 'FINALIZED' as const,
  assessmentType: 'WORKSHEET' as const,
  scoringMode: 'NONE' as const,
  totalScoreUnits: null,
  curriculumVersion: { id: 'cv1', status: 'PUBLISHED' as const, nodeIds: ['n1'] },
  curriculumNodeIds: ['n1'],
  frozenPlan: { questions: [{ key: 'q1', order: 0 }] },
  sections: [
    {
      key: 's1',
      order: 0,
      scoreUnits: null,
      questions: [
        {
          id: 'q1',
          key: 'q1',
          prompt: 'שאלה',
          instructions: 'בחר',
          order: 0,
          scoreUnits: null,
          answers: [{ ownerType: 'QUESTION', ownerId: 'q1', text: 'תשובה' }],
          rubrics: [],
          subQuestions: [],
          questionSourceLinks: [link()],
        },
      ],
    },
  ],
});
const result = (value: unknown) => evaluateDeterministicRules(value);
const expectAllPass = (value: unknown) => {
  const rows = result(value);
  expect(rows).toHaveLength(11);
  expect(rows.map((row) => row.ruleId)).toEqual(validationRules);
  expect(rows.map((row) => row.ruleVersion)).toEqual(Array(11).fill('1.0.0'));
  expect(rows.map((row) => row.outcome)).toEqual(Array(11).fill('PASS'));
  expect(rows.map((row) => row.finding)).toEqual(Array(11).fill(undefined));
  for (const row of rows) {
    expect(row.evidence).toMatchObject({ ruleId: row.ruleId });
    expect(Object.isFrozen(row.evidence)).toBe(true);
  }
};
const expectFails = (value: unknown, ids: string[]) => {
  const rows = result(value);
  expect(rows).toHaveLength(11);
  expect(rows.filter((r) => r.outcome === 'FAIL').map((r) => r.ruleId)).toEqual(ids);
  for (const row of rows.filter((r) => r.outcome === 'FAIL')) {
    expect(row.severity).toBe('BLOCKING');
    expect(row.finding?.code).toBe(`${row.ruleId}_FAILED`);
    expect(row.messageKey).toBe(`${row.ruleId}_FAILED`);
    expect(Object.isFrozen(row.evidence)).toBe(true);
  }
};
const withSubQuestion = (changes: Record<string, unknown> = {}) => {
  const base = snapshot();
  const question = base.sections[0]!.questions[0]!;
  return {
    ...base,
    sections: [
      {
        ...base.sections[0]!,
        questions: [
          {
            ...question,
            subQuestions: [
              {
                id: 'sq1',
                key: 'sq1',
                prompt: 'תת שאלה',
                instructions: '',
                order: 0,
                scoreUnits: null,
                answers: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', text: 'תשובת משנה' }],
                rubrics: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', scoreUnits: null }],
                subQuestions: [],
                questionSourceLinks: [],
                ...changes,
              },
            ],
          },
        ],
      },
    ],
  };
};
describe('Package 1B deterministic matrix', () => {
  it('D01 valid WORKSHEET revision has all eleven ordered executions PASS', () =>
    expectAllPass(snapshot()));
  it('D02 valid TEST revision has exact 10000-unit scoring and all eleven executions PASS', () => {
    const subQuestion = {
      id: 'sq1',
      key: 'sq1',
      prompt: 'תת שאלה',
      instructions: '',
      order: 0,
      scoreUnits: 10000,
      answers: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', text: 'תשובת משנה' }],
      rubrics: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', scoreUnits: 10000 }],
      subQuestions: [],
      questionSourceLinks: [],
    };
    const s = {
      ...snapshot(),
      assessmentType: 'TEST' as const,
      scoringMode: 'POINTS' as const,
      totalScoreUnits: 10000,
      sections: [
        {
          ...snapshot().sections[0]!,
          scoreUnits: 10000,
          questions: [
            {
              ...snapshot().sections[0]!.questions[0]!,
              scoreUnits: 10000,
              rubrics: [],
              subQuestions: [subQuestion],
            },
          ],
        },
      ],
    };
    expectAllPass(s);
  });
  it('D03 persisted graph that cannot map to the strict revision contract is rejected', () => {
    expectFails({}, [...validationRules]);
  });
  it('D04 required revision field absent fails strict contract', () => {
    const { ownerOrganizationId: _ownerOrganizationId, ...withoutOwner } = snapshot();
    expectFails(withoutOwner, [...validationRules]);
  });
  it('missing strict field fails closed at contract boundary', () => {
    expectFails(
      {
        ...snapshot(),
        sections: [
          {
            ...snapshot().sections[0]!,
            questions: [{ ...snapshot().sections[0]!.questions[0]!, prompt: undefined }],
          },
        ],
      },
      [...validationRules],
    );
    expectFails({ ...snapshot(), assessmentType: 'ALIEN' }, [...validationRules]);
    expectFails({ ...snapshot(), scoringMode: 'ALIEN' }, [...validationRules]);
  });
  it('D05 frozen-plan question count differs and fails only the plan rule', () =>
    expectFails({ ...snapshot(), frozenPlan: { questions: [] } }, ['PLAN_COUNT_KEY_ORDER']));
  it('D06 frozen-plan keys or order differ and fail only the plan rule', () =>
    expectFails({ ...snapshot(), frozenPlan: { questions: [{ key: 'wrong', order: 0 }] } }, [
      'PLAN_COUNT_KEY_ORDER',
    ]));
  it('D08 curriculum version is not currently PUBLISHED', () =>
    expectFails(
      {
        ...snapshot(),
        curriculumVersion: { ...snapshot().curriculumVersion, status: 'DRAFT' as never },
      },
      ['CURRICULUM_SCOPE_PUBLISHED'],
    ));
  it('D07 unknown or cross-version curriculum node fails curriculum scope', () => {
    expectFails({ ...snapshot(), curriculumNodeIds: ['unknown'] }, ['CURRICULUM_SCOPE_PUBLISHED']);
    const crossVersion = snapshot();
    expectFails(
      {
        ...crossVersion,
        curriculumVersion: { id: 'cv2', status: 'PUBLISHED' as const, nodeIds: ['n2'] },
        sections: [
          {
            ...crossVersion.sections[0]!,
            questions: [
              {
                ...crossVersion.sections[0]!.questions[0]!,
                questionSourceLinks: [
                  { ...link(), provenance: { ...link().provenance, curriculumVersionId: 'cv2' } },
                ],
              },
            ],
          },
        ],
      },
      ['CURRICULUM_SCOPE_PUBLISHED'],
    );
  });
  it('D09 required question and subquestion answers are independently required', () => {
    expectFails(
      {
        ...snapshot(),
        sections: [
          {
            ...snapshot().sections[0]!,
            questions: [{ ...snapshot().sections[0]!.questions[0]!, answers: [] }],
          },
        ],
      },
      ['ANSWER_COMPLETENESS_AND_TARGETS'],
    );
    expectFails(withSubQuestion({ answers: [] }), ['ANSWER_COMPLETENESS_AND_TARGETS']);
  });
  it('D10 question and subquestion answer or rubric owner type and ID must match', () => {
    const positive = withSubQuestion();
    const question = positive.sections[0]!.questions[0]!;
    const subQuestion = question.subQuestions[0]!;
    const valid = {
      ...positive,
      sections: [
        {
          ...positive.sections[0]!,
          questions: [
            {
              ...question,
              rubrics: [{ ownerType: 'QUESTION', ownerId: 'q1', scoreUnits: null }],
            },
          ],
        },
      ],
    };
    const mutate = (changes: Record<string, unknown>) => {
      const { subQuestion: subChanges, ...questionChanges } = changes;
      expectFails(
        {
          ...valid,
          sections: [
            {
              ...valid.sections[0]!,
              questions: [
                {
                  ...valid.sections[0]!.questions[0]!,
                  ...questionChanges,
                  subQuestions: [
                    {
                      ...subQuestion,
                      ...(subChanges as Record<string, unknown> | undefined),
                    },
                  ],
                },
              ],
            },
          ],
        },
        ['ANSWER_COMPLETENESS_AND_TARGETS'],
      );
    };
    mutate({ answers: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', text: 'תשובה' }] });
    mutate({ answers: [{ ownerType: 'QUESTION', ownerId: 'wrong', text: 'תשובה' }] });
    mutate({ rubrics: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', scoreUnits: null }] });
    mutate({ rubrics: [{ ownerType: 'QUESTION', ownerId: 'wrong', scoreUnits: null }] });
    mutate({ subQuestion: { answers: [{ ownerType: 'QUESTION', ownerId: 'q1', text: 'x' }] } });
    mutate({
      subQuestion: { answers: [{ ownerType: 'SUBQUESTION', ownerId: 'wrong', text: 'x' }] },
    });
    mutate({
      subQuestion: { rubrics: [{ ownerType: 'QUESTION', ownerId: 'q1', scoreUnits: null }] },
    });
    mutate({
      subQuestion: { rubrics: [{ ownerType: 'SUBQUESTION', ownerId: 'wrong', scoreUnits: null }] },
    });
  });
  it('D11 assessment section question and subquestion score totals use the approved score tree', () => {
    const base = withSubQuestion();
    const sub = base.sections[0]!.questions[0]!.subQuestions[0]!;
    const valid = {
      ...base,
      assessmentType: 'TEST' as const,
      scoringMode: 'POINTS' as const,
      totalScoreUnits: 10000,
      sections: [
        {
          ...base.sections[0]!,
          scoreUnits: 10000,
          questions: [
            {
              ...base.sections[0]!.questions[0]!,
              scoreUnits: 10000,
              subQuestions: [
                {
                  ...sub,
                  scoreUnits: 10000,
                  rubrics: [{ ownerType: 'SUBQUESTION', ownerId: 'sq1', scoreUnits: 10000 }],
                },
              ],
            },
          ],
        },
      ],
    };
    expectFails({ ...valid, totalScoreUnits: 9999 }, ['EXACT_SCORE_TREE']);
    expectFails({ ...valid, sections: [{ ...valid.sections[0]!, scoreUnits: 9999 }] }, [
      'EXACT_SCORE_TREE',
    ]);
    expectFails(
      {
        ...valid,
        sections: [
          {
            ...valid.sections[0]!,
            questions: [{ ...valid.sections[0]!.questions[0]!, scoreUnits: 9999 }],
          },
        ],
      },
      ['EXACT_SCORE_TREE'],
    );
    expectFails(
      {
        ...valid,
        sections: [
          {
            ...valid.sections[0]!,
            questions: [
              {
                ...valid.sections[0]!.questions[0]!,
                subQuestions: [{ ...sub, scoreUnits: 9999 }],
              },
            ],
          },
        ],
      },
      ['EXACT_SCORE_TREE'],
    );
  });
  it('D12 rubric allocation incomplete or internally inconsistent fails scoring', () => {
    const base = withSubQuestion();
    const q = base.sections[0]!.questions[0]!;
    const valid = {
      ...base,
      assessmentType: 'TEST' as const,
      scoringMode: 'POINTS' as const,
      totalScoreUnits: 100,
      sections: [
        {
          ...base.sections[0]!,
          scoreUnits: 100,
          questions: [
            {
              ...q,
              scoreUnits: 100,
              subQuestions: [],
              rubrics: [{ ownerType: 'QUESTION', ownerId: 'q1', scoreUnits: 100 }],
            },
          ],
        },
      ],
    };
    expectFails(
      {
        ...valid,
        sections: [
          {
            ...valid.sections[0]!,
            questions: [
              {
                ...q,
                scoreUnits: 100,
                subQuestions: [],
                rubrics: [{ ownerType: 'QUESTION', ownerId: 'q1', scoreUnits: 50 }],
              },
            ],
          },
        ],
      },
      ['EXACT_SCORE_TREE'],
    );
    expectFails(
      {
        ...valid,
        sections: [
          {
            ...valid.sections[0]!,
            questions: [
              {
                ...valid.sections[0]!.questions[0]!,
                rubrics: [
                  { ownerType: 'QUESTION', ownerId: 'q1', scoreUnits: 60 },
                  { ownerType: 'QUESTION', ownerId: 'q1', scoreUnits: 60 },
                ],
              },
            ],
          },
        ],
      },
      ['EXACT_SCORE_TREE'],
    );
  });
  it('D13 duplicate stable question and subquestion IDs fail identity', () => {
    expectFails(
      {
        ...snapshot(),
        sections: [
          {
            ...snapshot().sections[0]!,
            questions: [
              snapshot().sections[0]!.questions[0]!,
              {
                ...snapshot().sections[0]!.questions[0]!,
                key: 'q2',
                order: 1,
                prompt: 'אחר',
                answers: [{ ownerType: 'QUESTION', ownerId: 'q1', text: 'תגובה' }],
                questionSourceLinks: [link()],
              },
            ],
          },
        ],
        frozenPlan: {
          questions: [
            { key: 'q1', order: 0 },
            { key: 'q2', order: 1 },
          ],
        },
      },
      ['STABLE_ID_AND_EXACT_DUPLICATE'],
    );
    const base = withSubQuestion();
    const sub = base.sections[0]!.questions[0]!.subQuestions[0]!;
    expectFails(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            questions: [
              {
                ...base.sections[0]!.questions[0]!,
                subQuestions: [sub, { ...sub }],
              },
            ],
          },
        ],
      },
      ['STABLE_ID_AND_EXACT_DUPLICATE'],
    );
  });
  it('D14 exact normalized duplicate question text fails identity', () => {
    expectFails(
      {
        ...snapshot(),
        sections: [
          {
            ...snapshot().sections[0]!,
            questions: [
              snapshot().sections[0]!.questions[0]!,
              {
                ...snapshot().sections[0]!.questions[0]!,
                id: 'q2',
                key: 'q2',
                order: 1,
                prompt: '  שאלה  ',
                answers: [{ ownerType: 'QUESTION', ownerId: 'q2', text: 'תגובה' }],
                questionSourceLinks: [
                  {
                    ...link(),
                    questionId: 'q2',
                    provenance: { ...link().provenance, questionId: 'q2' },
                  },
                ],
              },
            ],
          },
        ],
        frozenPlan: {
          questions: [
            { key: 'q1', order: 0 },
            { key: 'q2', order: 1 },
          ],
        },
      },
      ['STABLE_ID_AND_EXACT_DUPLICATE'],
    );
    const duplicate = (first: string, second: string) =>
      expectFails(
        {
          ...snapshot(),
          sections: [
            {
              ...snapshot().sections[0]!,
              questions: [
                { ...snapshot().sections[0]!.questions[0]!, prompt: first },
                {
                  ...snapshot().sections[0]!.questions[0]!,
                  id: 'q2',
                  key: 'q2',
                  order: 1,
                  prompt: second,
                  answers: [{ ownerType: 'QUESTION', ownerId: 'q2', text: 'תגובה' }],
                  questionSourceLinks: [
                    {
                      ...link(),
                      questionId: 'q2',
                      provenance: { ...link().provenance, questionId: 'q2' },
                    },
                  ],
                },
              ],
            },
          ],
          frozenPlan: {
            questions: [
              { key: 'q1', order: 0 },
              { key: 'q2', order: 1 },
            ],
          },
        },
        ['STABLE_ID_AND_EXACT_DUPLICATE'],
      );
    duplicate('Ａ ב', 'A ב');
    duplicate('ש\u00a0אלה', 'ש אלה');
  });
  it('near match remains distinct', () =>
    expect(
      result({
        ...snapshot(),
        sections: [
          {
            ...snapshot().sections[0]!,
            questions: [
              snapshot().sections[0]!.questions[0]!,
              {
                ...snapshot().sections[0]!.questions[0]!,
                id: 'q2',
                key: 'q2',
                order: 1,
                prompt: 'שאלות',
                answers: [{ ownerType: 'QUESTION', ownerId: 'q2', text: 'תגובה' }],
                questionSourceLinks: [
                  {
                    ...link(),
                    questionId: 'q2',
                    provenance: { ...link().provenance, questionId: 'q2' },
                  },
                ],
              },
            ],
          },
        ],
        frozenPlan: {
          questions: [
            { key: 'q1', order: 0 },
            { key: 'q2', order: 1 },
          ],
        },
      }).filter((r) => r.outcome === 'FAIL'),
    ).toHaveLength(0));
  it('D15 exact normalized answer leakage into visible prompt fails leakage', () => {
    expectFails(
      {
        ...snapshot(),
        sections: [
          {
            ...snapshot().sections[0]!,
            questions: [
              {
                ...snapshot().sections[0]!.questions[0]!,
                prompt: 'שאלה ארוכה',
                answers: [{ ownerType: 'QUESTION', ownerId: 'q1', text: 'שאלה' }],
              },
            ],
          },
        ],
      },
      ['DETERMINISTIC_ANSWER_LEAKAGE'],
    );
    expect(hasExactAnswerLeakage('שאלה נכונה', 'שאלה נכונות')).toBe(false);
  });
  it('source identity fixture rejects missing or forged link fields', () => {
    const base = snapshot();
    expectFails(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            questions: [{ ...base.sections[0]!.questions[0]!, questionSourceLinks: [] }],
          },
        ],
      },
      [
        'SOURCE_LINK_COMPLETENESS_AND_IDENTITY',
        'CURRENT_SOURCE_ELIGIBILITY',
        'GENERATION_REVISION_PROVENANCE',
      ],
    );
    for (const change of [{ locator: '' }, { contentHash: '' }])
      expectFails(
        {
          ...base,
          sections: [
            {
              ...base.sections[0]!,
              questions: [
                {
                  ...base.sections[0]!.questions[0]!,
                  questionSourceLinks: [
                    {
                      ...link(),
                      ...change,
                      knowledgeItem: { id: 'ki1', locator: 'paragraph:1', textHash: 'hash-1' },
                    },
                  ],
                },
              ],
            },
          ],
        },
        ['SOURCE_LINK_COMPLETENESS_AND_IDENTITY'],
      );
  });
  it('D16 generated question without a source link fails source completeness only', () => {
    const base = snapshot();
    expectFails(
      {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            questions: [{ ...base.sections[0]!.questions[0]!, questionSourceLinks: [] }],
          },
        ],
      },
      [
        'SOURCE_LINK_COMPLETENESS_AND_IDENTITY',
        'CURRENT_SOURCE_ELIGIBILITY',
        'GENERATION_REVISION_PROVENANCE',
      ],
    );
  });
  it('wrong non-empty canonical locator or content hash fails source identity only', () => {
    const base = snapshot();
    for (const change of [{ locator: 'paragraph:99' }, { contentHash: 'f'.repeat(64) }])
      expectFails(
        {
          ...base,
          sections: [
            {
              ...base.sections[0]!,
              questions: [
                {
                  ...base.sections[0]!.questions[0]!,
                  questionSourceLinks: [
                    {
                      ...link(),
                      ...change,
                      knowledgeItem: { id: 'ki1', locator: 'paragraph:1', textHash: 'hash-1' },
                    },
                  ],
                },
              ],
            },
          ],
        },
        ['SOURCE_LINK_COMPLETENESS_AND_IDENTITY'],
      );
  });
  it('linked source rejected denied expired or inactive fails current eligibility only', () => {
    const base = snapshot();
    const denied = [
      { pedagogicalApproved: false },
      { usageAllowed: false },
      { sourceLifecycle: 'SUSPENDED' },
      { itemLifecycle: 'SUSPENDED' },
      { visibilityPermitted: false },
      { exactPublishedCurriculum: false },
    ];
    for (const change of denied)
      expectFails(
        {
          ...base,
          sections: [
            {
              ...base.sections[0]!,
              questions: [
                {
                  ...base.sections[0]!.questions[0]!,
                  questionSourceLinks: [
                    { ...link(), eligibility: { ...link().eligibility, ...change } },
                  ],
                },
              ],
            },
          ],
        },
        ['CURRENT_SOURCE_ELIGIBILITY'],
      );
    expect(result(base).find((r) => r.ruleId === 'CURRENT_SOURCE_ELIGIBILITY')?.outcome).toBe(
      'PASS',
    );
  });
  it('D19 generation run output revision and lineage identities must agree', () => {
    const base = snapshot();
    const mutate = (p: Record<string, unknown>) =>
      expectFails(
        {
          ...base,
          sections: [
            {
              ...base.sections[0]!,
              questions: [
                {
                  ...base.sections[0]!.questions[0]!,
                  questionSourceLinks: [{ ...link(), provenance: { ...link().provenance, ...p } }],
                },
              ],
            },
          ],
        },
        ['GENERATION_REVISION_PROVENANCE'],
      );
    mutate({ generationRunId: 'other' });
    mutate({ outputRevisionId: 'other' });
    mutate({ promptTemplateHash: 'other' });
    mutate({ modelConfigurationHash: 'other' });
    mutate({ responseSchemaHash: 'other' });
    mutate({ questionId: 'other' });
    mutate({ sourceVersionId: 'other' });
    mutate({ knowledgeItemId: 'other' });
    mutate({ curriculumVersionId: 'other' });
  });
});
