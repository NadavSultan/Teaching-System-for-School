import { validateScoreTree } from './index.js';

type Answer = { key: string; order: number; text: string; explanation?: string | null | undefined };
type Rubric = { key: string; order: number; description: string; scoreUnits: number | null };
type SubQuestion = {
  key: string;
  prompt: string;
  order: number;
  scoreUnits: number | null;
  answers: Answer[];
  rubrics: Rubric[];
};
export type EditorQuestion = {
  logicalId?: string | undefined;
  key: string;
  type: string;
  prompt: string;
  instructions?: string | null | undefined;
  order: number;
  scoreUnits: number | null;
  answers: Answer[];
  rubrics: Rubric[];
  subQuestions: SubQuestion[];
};
export type EditorSection = {
  key: string;
  title: string;
  instructions?: string | null | undefined;
  order: number;
  scoreUnits: number | null;
  questions: EditorQuestion[];
};
export type AuthoritativeEditorBase = {
  scoringMode: 'NONE' | 'POINTS';
  totalScoreUnits: number | null;
  sections: EditorSection[];
};

export class EditorSnapshotError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'EditorSnapshotError';
  }
}

function unique(values: readonly (string | number)[], code: string) {
  if (new Set(values).size !== values.length) throw new EditorSnapshotError(code);
}

function validateCollections(sections: EditorSection[]) {
  unique(
    sections.map((x) => x.key),
    'DUPLICATE_SECTION_KEY',
  );
  unique(
    sections.map((x) => x.order),
    'DUPLICATE_SECTION_ORDER',
  );
  const logicalIds: string[] = [];
  for (const section of sections) {
    unique(
      section.questions.map((x) => x.key),
      'DUPLICATE_QUESTION_KEY',
    );
    unique(
      section.questions.map((x) => x.order),
      'DUPLICATE_QUESTION_ORDER',
    );
    for (const question of section.questions) {
      if (question.logicalId) logicalIds.push(question.logicalId);
      unique(
        question.answers.map((x) => x.key),
        'DUPLICATE_ANSWER_KEY',
      );
      unique(
        question.answers.map((x) => x.order),
        'DUPLICATE_ANSWER_ORDER',
      );
      unique(
        question.rubrics.map((x) => x.key),
        'DUPLICATE_RUBRIC_KEY',
      );
      unique(
        question.rubrics.map((x) => x.order),
        'DUPLICATE_RUBRIC_ORDER',
      );
      unique(
        question.subQuestions.map((x) => x.key),
        'DUPLICATE_SUBQUESTION_KEY',
      );
      unique(
        question.subQuestions.map((x) => x.order),
        'DUPLICATE_SUBQUESTION_ORDER',
      );
      for (const sub of question.subQuestions) {
        unique(
          sub.answers.map((x) => x.key),
          'DUPLICATE_SUBQUESTION_ANSWER_KEY',
        );
        unique(
          sub.answers.map((x) => x.order),
          'DUPLICATE_SUBQUESTION_ANSWER_ORDER',
        );
        unique(
          sub.rubrics.map((x) => x.key),
          'DUPLICATE_SUBQUESTION_RUBRIC_KEY',
        );
        unique(
          sub.rubrics.map((x) => x.order),
          'DUPLICATE_SUBQUESTION_RUBRIC_ORDER',
        );
      }
    }
  }
  unique(logicalIds, 'DUPLICATE_LOGICAL_QUESTION_IDENTITY');
}

export function prepareEditedSnapshot(input: {
  assessmentType: 'WORKSHEET' | 'TEST';
  base: AuthoritativeEditorBase;
  sections: EditorSection[];
  allocateLogicalId: () => string;
}) {
  validateCollections(input.sections);
  const baseIds = new Set(
    input.base.sections.flatMap((section) =>
      section.questions.map((question) => question.logicalId!),
    ),
  );
  const baseSlots = new Set(
    input.base.sections.flatMap((section) =>
      section.questions.map((question) => `${section.key}\0${question.key}`),
    ),
  );
  const sections = structuredClone(input.sections);
  for (const section of sections) {
    for (const question of section.questions) {
      if (question.logicalId && !baseIds.has(question.logicalId))
        throw new EditorSnapshotError('UNKNOWN_LOGICAL_QUESTION_IDENTITY');
      if (!question.logicalId && baseSlots.has(`${section.key}\0${question.key}`))
        throw new EditorSnapshotError('MISSING_LOGICAL_QUESTION_IDENTITY');
      question.logicalId ??= input.allocateLogicalId();
    }
  }
  validateCollections(sections);
  const scoreErrors = validateScoreTree(
    input.base.scoringMode,
    input.assessmentType,
    input.base.totalScoreUnits,
    sections.map((section) => ({
      scoreUnits: section.scoreUnits,
      questions: section.questions.map((question) => ({
        scoreUnits: question.scoreUnits,
        rubricScores: question.rubrics.map((rubric) => rubric.scoreUnits),
        subQuestions: question.subQuestions.map((sub) => ({
          scoreUnits: sub.scoreUnits,
          rubricScores: sub.rubrics.map((rubric) => rubric.scoreUnits),
        })),
      })),
    })),
  );
  if (scoreErrors.length)
    throw new EditorSnapshotError(scoreErrors.map((error) => error.code).join(','));
  return { sections };
}
