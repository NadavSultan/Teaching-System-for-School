import type { AuthenticatedPrincipal } from '@teach/contracts';

export type MembershipRole = 'TEACHER' | 'COORDINATOR' | 'SCHOOL_ADMIN' | 'PLATFORM_ADMIN';
export type WorkspaceType = 'PERSONAL' | 'SCHOOL';
export type WorkspaceOperation =
  | 'READ_WORKSPACE_CONTEXT'
  | 'RENAME_WORKSPACE'
  | 'CREATE_ASSESSMENT'
  | 'READ_ASSESSMENT'
  | 'CREATE_ASSESSMENT_REVISION';
export type AccessContext = {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  userStatus: 'ACTIVE' | 'INACTIVE';
  membershipStatus: 'ACTIVE' | 'INACTIVE';
  role: MembershipRole;
  organizationStatus: 'ACTIVE' | 'INACTIVE';
  workspaceType: WorkspaceType;
};

export class AccessDeniedError extends Error {
  constructor() {
    super('Resource not found or unavailable');
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export function authorizeWorkspace(
  context: AccessContext,
  trustedOrganizationId: string,
  operation: WorkspaceOperation,
): void {
  const allowed: readonly MembershipRole[] =
    operation === 'READ_WORKSPACE_CONTEXT' ||
    operation === 'CREATE_ASSESSMENT' ||
    operation === 'READ_ASSESSMENT' ||
    operation === 'CREATE_ASSESSMENT_REVISION'
      ? ['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN']
      : context.workspaceType === 'PERSONAL'
        ? ['TEACHER']
        : ['SCHOOL_ADMIN'];
  if (
    context.userStatus !== 'ACTIVE' ||
    context.membershipStatus !== 'ACTIVE' ||
    context.organizationStatus !== 'ACTIVE' ||
    context.organizationId !== trustedOrganizationId ||
    context.role === 'PLATFORM_ADMIN' ||
    !allowed.includes(context.role)
  ) {
    throw new AccessDeniedError();
  }
}

export function assertPersonalWorkspaceMembers(activeMembers: number): void {
  if (activeMembers !== 1)
    throw new Error('A personal workspace must have exactly one active member');
}

export type CurriculumNodeInput = {
  type: 'GRADE' | 'DOMAIN' | 'TOPIC' | 'SUBTOPIC' | 'SKILL';
  code: string;
  sortOrder: number;
  children?: CurriculumNodeInput[] | undefined;
  difficulties?: string[] | undefined;
};
const childType: Record<CurriculumNodeInput['type'], CurriculumNodeInput['type'] | null> = {
  GRADE: 'DOMAIN',
  DOMAIN: 'TOPIC',
  TOPIC: 'SUBTOPIC',
  SUBTOPIC: 'SKILL',
  SKILL: null,
};
export function validateCurriculumHierarchy(roots: CurriculumNodeInput[]): string[] {
  const errors: string[] = [];
  const walk = (
    nodes: CurriculumNodeInput[],
    expected: CurriculumNodeInput['type'] | null,
    path: string,
  ) => {
    const codes = new Set<string>(),
      orders = new Set<number>();
    for (const [i, node] of nodes.entries()) {
      const p = `${path}[${i}]`;
      if (node.type !== expected && !(expected === null && node.type === 'GRADE'))
        errors.push(`${p}: invalid parent type`);
      if (codes.has(node.code)) errors.push(`${p}: duplicate sibling code`);
      codes.add(node.code);
      if (orders.has(node.sortOrder)) errors.push(`${p}: duplicate sibling order`);
      orders.add(node.sortOrder);
      if (node.type !== 'SKILL' && node.difficulties?.length)
        errors.push(`${p}: difficulty only applies to skills`);
      if (
        node.type === 'SKILL' &&
        new Set(node.difficulties ?? []).size !== (node.difficulties ?? []).length
      )
        errors.push(`${p}: duplicate difficulty`);
      walk(node.children ?? [], childType[node.type], p + '.children');
    }
  };
  walk(roots, null, 'nodes');
  return errors;
}

export type ScoreNode = {
  scoreUnits: number | null;
  subQuestions?: ScoreNode[];
  rubricScores?: Array<number | null>;
};
export const SCORE_UNIT_SCALE = 100;
export const MAX_SCORE_UNITS = 1_000_000;
export function canTransitionCurriculumLifecycle(
  from: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED',
  to: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED',
): boolean {
  return (from === 'DRAFT' && to === 'PUBLISHED') || (from === 'PUBLISHED' && to === 'DEPRECATED');
}
export function validateScoreTree(
  mode: 'NONE' | 'POINTS',
  type: 'WORKSHEET' | 'TEST',
  total: number | null,
  sections: Array<{ scoreUnits: number | null; questions: ScoreNode[] }>,
) {
  const errors: Array<{ path: string; code: string; message: string }> = [];
  const validateNode = (node: ScoreNode, path: string, requireScore: boolean) => {
    if (
      node.scoreUnits !== null &&
      (!Number.isInteger(node.scoreUnits) ||
        node.scoreUnits < 0 ||
        node.scoreUnits > MAX_SCORE_UNITS)
    )
      errors.push({ path, code: 'INVALID_SCORE', message: 'score must be an in-range integer' });
    if (requireScore && node.scoreUnits === null)
      errors.push({ path, code: 'INVALID_SCORE', message: 'score required' });
    if (node.rubricScores?.length) {
      if (node.rubricScores.some((score) => score === null))
        errors.push({
          path: `${path}.rubrics`,
          code: 'RUBRIC_TOTAL_MISMATCH',
          message: 'rubrics cannot mix null and scored values',
        });
      else if (
        node.rubricScores.some(
          (score) => !Number.isInteger(score) || score! < 0 || score! > MAX_SCORE_UNITS,
        ) ||
        node.rubricScores.reduce<number>((sum, score) => sum + (score ?? 0), 0) !== node.scoreUnits
      )
        errors.push({
          path: `${path}.rubrics`,
          code: 'RUBRIC_TOTAL_MISMATCH',
          message: 'rubric total mismatch',
        });
    }
    node.subQuestions?.forEach((child, index) =>
      validateNode(child, `${path}.subQuestions.${index}`, requireScore),
    );
  };
  if (total !== null && (total < 0 || total > MAX_SCORE_UNITS))
    errors.push({
      path: 'totalScoreUnits',
      code: 'SCORE_OUT_OF_RANGE',
      message: 'score is out of range',
    });
  if (type === 'TEST' && mode !== 'POINTS')
    errors.push({
      path: 'scoringMode',
      code: 'TEST_REQUIRES_POINTS',
      message: 'Tests require POINTS scoring',
    });
  if (mode === 'NONE') {
    if (
      total !== null ||
      sections.some(
        (s) =>
          s.scoreUnits !== null ||
          s.questions.some((q) => {
            validateNode(q, 'none', false);
            return (
              q.scoreUnits !== null ||
              q.rubricScores?.some((score) => score !== null) ||
              q.subQuestions?.some(
                (subQuestion) =>
                  subQuestion.scoreUnits !== null ||
                  subQuestion.rubricScores?.some((score) => score !== null),
              )
            );
          }),
      )
    )
      errors.push({
        path: 'totalScoreUnits',
        code: 'NONE_MUST_BE_NULL',
        message: 'NONE scores must be null',
      });
    return errors;
  }
  if (total === null)
    errors.push({
      path: 'totalScoreUnits',
      code: 'POINTS_REQUIRES_TOTAL',
      message: 'POINTS requires a total',
    });
  let sectionSum = 0;
  sections.forEach((s, si) => {
    if (s.scoreUnits === null || s.scoreUnits < 0 || s.scoreUnits > MAX_SCORE_UNITS)
      errors.push({
        path: `sections.${si}`,
        code: 'INVALID_SCORE',
        message: 'section score required',
      });
    else {
      sectionSum += s.scoreUnits;
      let qsum = 0;
      s.questions.forEach((q, qi) => {
        validateNode(q, `sections.${si}.questions.${qi}`, true);
        if (q.scoreUnits === null || q.scoreUnits < 0 || q.scoreUnits > MAX_SCORE_UNITS)
          errors.push({
            path: `sections.${si}.questions.${qi}`,
            code: 'INVALID_SCORE',
            message: 'question score required',
          });
        else {
          const own = q.subQuestions?.length
            ? q.subQuestions.reduce((a, x) => a + (x.scoreUnits ?? -1), 0)
            : q.scoreUnits;
          if (own !== q.scoreUnits)
            errors.push({
              path: `sections.${si}.questions.${qi}`,
              code: 'SUBTOTAL_MISMATCH',
              message: 'question subtotal mismatch',
            });
          qsum += q.scoreUnits;
        }
      });
      if (qsum !== s.scoreUnits)
        errors.push({
          path: `sections.${si}`,
          code: 'SECTION_TOTAL_MISMATCH',
          message: 'section total mismatch',
        });
    }
  });
  if (total !== null && sectionSum !== total)
    errors.push({
      path: 'totalScoreUnits',
      code: 'TOTAL_MISMATCH',
      message: 'revision total mismatch',
    });
  return errors;
}
