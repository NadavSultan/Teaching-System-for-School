import { z } from 'zod';

export const semanticEvaluatorRegistry = Object.freeze({
  evaluatorVersion: 'local-disabled-v1', promptVersion: 'validation-prompt-v1', modelConfigurationVersion: 'local-none-v1', schemaVersion: '1.0.0', timeoutMs: 2_000, maxAttempts: 3, maxFindings: 100,
});
const categories = ['HEBREW_CORRECTNESS', 'AMBIGUITY', 'ANSWER_VALIDITY', 'DIFFICULTY_FIT', 'CURRICULUM_FIT', 'DUPLICATION', 'ANSWER_LEAKAGE'] as const;
const codes: Readonly<Record<(typeof categories)[number], readonly string[]>> = Object.freeze({ HEBREW_CORRECTNESS: ['HEBREW_CORRECTNESS_V1'], AMBIGUITY: ['AMBIGUITY_V1'], ANSWER_VALIDITY: ['ANSWER_VALIDITY_V1'], DIFFICULTY_FIT: ['DIFFICULTY_FIT_V1'], CURRICULUM_FIT: ['CURRICULUM_FIT_V1'], DUPLICATION: ['DUPLICATION_V1'], ANSWER_LEAKAGE: ['ANSWER_LEAKAGE_V1'] });
const findingSchema = z.object({ category: z.enum(categories), code: z.string().min(1).max(120), severity: z.enum(['BLOCKING', 'WARNING', 'INFO']), path: z.string().max(500), messageKey: z.string().min(1).max(160), evidence: z.record(z.unknown()), confidenceBasisPoints: z.number().int().min(0).max(10000).optional() }).strict().superRefine((value, context) => { if (!codes[value.category].includes(value.code)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'unregistered semantic code' }); });
function boundedEvidence(value: unknown, revisionId: string, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === 'string') return value.length <= 1000;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return true;
  if (Array.isArray(value)) return value.length <= 50 && value.every((item) => boundedEvidence(item, revisionId, depth + 1));
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length > 20 || Object.prototype.hasOwnProperty.call(record, 'revisionId') && record.revisionId !== revisionId) return false;
  try { if (JSON.stringify(record).length > 20_000) return false; } catch { return false; }
  return Object.entries(record).every(([key, item]) => key.length <= 100 && boundedEvidence(item, revisionId, depth + 1));
}
const outputSchema = z.object({ version: z.literal('1.0.0'), evaluatorVersion: z.literal(semanticEvaluatorRegistry.evaluatorVersion), promptVersion: z.literal(semanticEvaluatorRegistry.promptVersion), modelConfigurationVersion: z.literal(semanticEvaluatorRegistry.modelConfigurationVersion), schemaVersion: z.literal(semanticEvaluatorRegistry.schemaVersion), revisionId: z.string().min(1).max(200), findings: z.array(findingSchema).max(semanticEvaluatorRegistry.maxFindings) }).strict().superRefine((value, context) => { const identities = value.findings.map((finding) => `${finding.category}:${finding.code}:${finding.path}`); if (new Set(identities).size !== identities.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate semantic finding identity' }); for (const finding of value.findings) { const evidence = finding.evidence; if (evidence.revisionId !== value.revisionId || !boundedEvidence(evidence, value.revisionId)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'evidence exceeds safe bounds or identity' }); } });
export type SemanticFinding = Readonly<z.infer<typeof findingSchema>>;
export type SemanticEvaluation = Readonly<Omit<z.infer<typeof outputSchema>, 'findings'> & { findings: readonly SemanticFinding[] }>;
export type SemanticEvaluatorInput = Readonly<{ revisionId: string; operationId: string; signal: AbortSignal }>;
export type SemanticEvaluator = { evaluate(input: SemanticEvaluatorInput): Promise<unknown> };
export class SemanticEvaluatorFailure extends Error { constructor(public readonly code: 'TIMEOUT' | 'TRANSIENT_EXHAUSTED' | 'PERMANENT_EVALUATOR_ERROR' | 'OUTPUT_INVALID') { super(code); this.name = 'SemanticEvaluatorFailure'; } }
export class TransientSemanticEvaluatorError extends Error { constructor() { super('TRANSIENT_EVALUATOR_ERROR'); this.name = 'TransientSemanticEvaluatorError'; } }
export function parseSemanticEvaluatorOutput(output: unknown, revisionId: string): SemanticEvaluation {
  const parsed = outputSchema.safeParse(output);
  if (!parsed.success || parsed.data.revisionId !== revisionId) throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
  return Object.freeze({ ...parsed.data, findings: Object.freeze(parsed.data.findings.map((finding) => Object.freeze({ ...finding, evidence: Object.freeze({ ...finding.evidence }) }))) });
}
export class DeterministicFakeSemanticEvaluator implements SemanticEvaluator {
  public readonly attempts: number[] = [];
  private readonly behavior: (input: SemanticEvaluatorInput, attempt: number) => unknown | Promise<unknown>;
  constructor(output?: unknown, behavior?: (input: SemanticEvaluatorInput, attempt: number) => unknown | Promise<unknown>) { this.behavior = behavior ?? ((input) => output ?? { version: '1.0.0', evaluatorVersion: semanticEvaluatorRegistry.evaluatorVersion, promptVersion: semanticEvaluatorRegistry.promptVersion, modelConfigurationVersion: semanticEvaluatorRegistry.modelConfigurationVersion, schemaVersion: semanticEvaluatorRegistry.schemaVersion, revisionId: input.revisionId, findings: [] }); }
  async evaluate(input: SemanticEvaluatorInput | Readonly<{ revisionId: string; operationId: string }>): Promise<unknown> { if (!('signal' in input)) throw new SemanticEvaluatorFailure('PERMANENT_EVALUATOR_ERROR'); const attempt = this.attempts.length + 1; this.attempts.push(attempt); return this.behavior(input, attempt); }
}
function classify(error: unknown): 'TIMEOUT' | 'TRANSIENT' | 'PERMANENT' { if (error instanceof SemanticEvaluatorFailure) return error.code === 'TIMEOUT' ? 'TIMEOUT' : 'PERMANENT'; if (error instanceof TransientSemanticEvaluatorError) return 'TRANSIENT'; if (error instanceof DOMException && error.name === 'AbortError') return 'TIMEOUT'; return 'PERMANENT'; }
async function attemptWithTimeout(evaluator: SemanticEvaluator, input: { revisionId: string; operationId: string }, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { const result = evaluator.evaluate(Object.freeze({ ...input, signal: controller.signal })); return await new Promise<unknown>((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SemanticEvaluatorFailure('TIMEOUT')); }, timeoutMs); result.then(resolve, reject); }); } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
export async function evaluateSemanticWithRetry(evaluator: SemanticEvaluator, input: { revisionId: string; operationId: string }, maxAttempts: number = semanticEvaluatorRegistry.maxAttempts, timeoutMs: number = semanticEvaluatorRegistry.timeoutMs): Promise<SemanticEvaluation> {
  const attempts = Math.min(Math.max(1, maxAttempts), semanticEvaluatorRegistry.maxAttempts); let last: 'TIMEOUT' | 'TRANSIENT' = 'TRANSIENT';
  for (let attempt = 0; attempt < attempts; attempt += 1) { try { return parseSemanticEvaluatorOutput(await attemptWithTimeout(evaluator, input, timeoutMs), input.revisionId); } catch (error) { const kind = classify(error); if (kind === 'PERMANENT') throw error instanceof SemanticEvaluatorFailure ? error : new SemanticEvaluatorFailure('PERMANENT_EVALUATOR_ERROR'); last = kind; } }
  throw new SemanticEvaluatorFailure(last === 'TIMEOUT' ? 'TIMEOUT' : 'TRANSIENT_EXHAUSTED');
}
export function liveSemanticEvaluatorPreflight(): Readonly<{ enabled: false; reason: 'LIVE_EVALUATOR_REQUIRES_OWNER_APPROVAL' }> { return { enabled: false, reason: 'LIVE_EVALUATOR_REQUIRES_OWNER_APPROVAL' }; }
export function resolveLiveSemanticEvaluator(): null { return null; }
