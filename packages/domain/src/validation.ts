export const validationRules = Object.freeze([
  'REVISION_FINALIZED_AND_OWNED', 'STRICT_REVISION_CONTRACT', 'PLAN_COUNT_KEY_ORDER',
  'CURRICULUM_SCOPE_PUBLISHED', 'ANSWER_COMPLETENESS_AND_TARGETS', 'EXACT_SCORE_TREE',
  'STABLE_ID_AND_EXACT_DUPLICATE', 'DETERMINISTIC_ANSWER_LEAKAGE',
  'SOURCE_LINK_COMPLETENESS_AND_IDENTITY', 'CURRENT_SOURCE_ELIGIBILITY',
  'GENERATION_REVISION_PROVENANCE',
] as const);
export type ValidationRunState = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
const transitions: Readonly<Record<ValidationRunState, readonly ValidationRunState[]>> = {
  PENDING: ['PROCESSING'], PROCESSING: ['PENDING', 'SUCCEEDED', 'FAILED'], SUCCEEDED: [], FAILED: [],
};
export function canTransitionValidationRun(from: ValidationRunState, to: ValidationRunState): boolean {
  return transitions[from].includes(to);
}
export function normalizeValidationText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('he-IL');
}
export function hasExactAnswerLeakage(prompt: string, answer: string): boolean {
  const normalized = normalizeValidationText(answer);
  return normalized.length > 0 && normalizeValidationText(prompt).includes(normalized);
}
