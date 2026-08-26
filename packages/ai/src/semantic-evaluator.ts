const categories = new Set(['HEBREW_CORRECTNESS', 'AMBIGUITY', 'ANSWER_VALIDITY', 'DIFFICULTY_FIT', 'CURRICULUM_FIT', 'DUPLICATION', 'ANSWER_LEAKAGE']);
const severities = new Set(['BLOCKING', 'WARNING', 'INFO']);
export type SemanticEvaluator = { evaluate(input: { revisionId: string; operationId: string; signal?: AbortSignal }): Promise<unknown> };
export class SemanticEvaluatorFailure extends Error { constructor(public readonly code: 'TIMEOUT' | 'TRANSIENT_EXHAUSTED' | 'PERMANENT_EVALUATOR_ERROR' | 'OUTPUT_INVALID') { super(code); } }
export class DeterministicFakeSemanticEvaluator implements SemanticEvaluator {
  constructor(private readonly output: unknown = { version: '1.0.0', revisionId: '00000000-0000-4000-8000-000000000000', findings: [] }) {}
  async evaluate(): Promise<unknown> { return this.output; }
}
export function parseSemanticEvaluatorOutput(output: unknown, revisionId: string) {
  if (!output || typeof output !== 'object') throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
  const parsed = output as { version?: unknown; revisionId?: unknown; findings?: unknown };
  if (parsed.version !== '1.0.0' || parsed.revisionId !== revisionId || !Array.isArray(parsed.findings) || parsed.findings.length > 100) throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
  for (const finding of parsed.findings) {
    if (!finding || typeof finding !== 'object') throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
    const row = finding as Record<string, unknown>;
    if (!categories.has(String(row.category)) || !severities.has(String(row.severity)) || typeof row.code !== 'string' || typeof row.path !== 'string' || typeof row.messageKey !== 'string') throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
  }
  return parsed as { version: '1.0.0'; revisionId: string; findings: Array<Record<string, unknown>> };
}
export function liveSemanticEvaluatorPreflight() { return { enabled: false as const, reason: 'LIVE_EVALUATOR_REQUIRES_OWNER_APPROVAL' }; }
