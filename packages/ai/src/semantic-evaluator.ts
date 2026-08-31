export const semanticEvaluatorRegistry = Object.freeze({
  evaluatorVersion: 'local-disabled-v1',
  promptVersion: 'validation-prompt-v1',
  modelConfigurationVersion: 'local-none-v1',
  schemaVersion: '1.0.0',
  timeoutMs: 2_000,
  maxAttempts: 3,
  maxFindings: 100,
});
const categories = [
  'HEBREW_CORRECTNESS',
  'AMBIGUITY',
  'ANSWER_VALIDITY',
  'DIFFICULTY_FIT',
  'CURRICULUM_FIT',
  'DUPLICATION',
  'ANSWER_LEAKAGE',
] as const;
const severities = ['BLOCKING', 'WARNING', 'INFO'] as const;
const codes: Readonly<Record<(typeof categories)[number], readonly string[]>> = Object.freeze({
  HEBREW_CORRECTNESS: ['HEBREW_CORRECTNESS_V1'],
  AMBIGUITY: ['AMBIGUITY_V1'],
  ANSWER_VALIDITY: ['ANSWER_VALIDITY_V1'],
  DIFFICULTY_FIT: ['DIFFICULTY_FIT_V1'],
  CURRICULUM_FIT: ['CURRICULUM_FIT_V1'],
  DUPLICATION: ['DUPLICATION_V1'],
  ANSWER_LEAKAGE: ['ANSWER_LEAKAGE_V1'],
});
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCategory = (value: unknown): value is (typeof categories)[number] =>
  typeof value === 'string' && (categories as readonly string[]).includes(value);
const isSeverity = (value: unknown): value is (typeof severities)[number] =>
  typeof value === 'string' && (severities as readonly string[]).includes(value);
function bounded(value: unknown, revisionId: string, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === 'string') return value.length <= 1000;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return true;
  if (Array.isArray(value))
    return value.length <= 50 && value.every((item) => bounded(item, revisionId, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 20) return false;
  if (value.revisionId !== undefined && value.revisionId !== revisionId) return false;
  try {
    if (JSON.stringify(value).length > 20_000) return false;
  } catch {
    return false;
  }
  return Object.entries(value).every(
    ([key, item]) => key.length <= 100 && bounded(item, revisionId, depth + 1),
  );
}
function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
export type SemanticFinding = Readonly<{
  category: (typeof categories)[number];
  code: string;
  severity: (typeof severities)[number];
  path: string;
  messageKey: string;
  evidence: Readonly<Record<string, unknown>>;
  confidenceBasisPoints?: number;
}>;
export type SemanticEvaluation = Readonly<{
  version: '1.0.0';
  evaluatorVersion: typeof semanticEvaluatorRegistry.evaluatorVersion;
  promptVersion: typeof semanticEvaluatorRegistry.promptVersion;
  modelConfigurationVersion: typeof semanticEvaluatorRegistry.modelConfigurationVersion;
  schemaVersion: typeof semanticEvaluatorRegistry.schemaVersion;
  revisionId: string;
  findings: readonly SemanticFinding[];
}>;
export type SemanticEvaluatorInput = Readonly<{
  revisionId: string;
  operationId: string;
  signal: AbortSignal;
}>;
export type SemanticEvaluator = { evaluate(input: SemanticEvaluatorInput): Promise<unknown> };
export class SemanticEvaluatorFailure extends Error {
  constructor(
    public readonly code:
      | 'TIMEOUT'
      | 'TRANSIENT_EXHAUSTED'
      | 'PERMANENT_EVALUATOR_ERROR'
      | 'OUTPUT_INVALID',
  ) {
    super(code);
    this.name = 'SemanticEvaluatorFailure';
  }
}
export class TransientSemanticEvaluatorError extends Error {
  constructor() {
    super('TRANSIENT_EVALUATOR_ERROR');
    this.name = 'TransientSemanticEvaluatorError';
  }
}
export function parseSemanticEvaluatorOutput(
  output: unknown,
  revisionId: string,
): SemanticEvaluation {
  const root = output;
  if (
    !isRecord(root) ||
    !exactKeys(root, [
      'version',
      'evaluatorVersion',
      'promptVersion',
      'modelConfigurationVersion',
      'schemaVersion',
      'revisionId',
      'findings',
    ]) ||
    root.version !== '1.0.0' ||
    root.evaluatorVersion !== semanticEvaluatorRegistry.evaluatorVersion ||
    root.promptVersion !== semanticEvaluatorRegistry.promptVersion ||
    root.modelConfigurationVersion !== semanticEvaluatorRegistry.modelConfigurationVersion ||
    root.schemaVersion !== semanticEvaluatorRegistry.schemaVersion ||
    root.revisionId !== revisionId ||
    !Array.isArray(root.findings) ||
    root.findings.length > semanticEvaluatorRegistry.maxFindings
  )
    throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
  const findings: SemanticFinding[] = [];
  const identities = new Set<string>();
  for (const raw of root.findings) {
    if (
      !isRecord(raw) ||
      (!exactKeys(raw, ['category', 'code', 'severity', 'path', 'messageKey', 'evidence']) &&
        !exactKeys(raw, [
          'category',
          'code',
          'severity',
          'path',
          'messageKey',
          'evidence',
          'confidenceBasisPoints',
        ])) ||
      !isCategory(raw.category) ||
      !isSeverity(raw.severity) ||
      typeof raw.code !== 'string' ||
      !codes[raw.category].includes(raw.code) ||
      typeof raw.path !== 'string' ||
      raw.path.length > 500 ||
      typeof raw.messageKey !== 'string' ||
      raw.messageKey.length === 0 ||
      raw.messageKey.length > 160 ||
      !isRecord(raw.evidence) ||
      !exactKeys(raw.evidence, ['identity', 'revisionId']) ||
      typeof raw.evidence.identity !== 'string' ||
      raw.evidence.identity.length === 0 ||
      raw.evidence.identity !== raw.code ||
      !bounded(raw.evidence, revisionId) ||
      raw.evidence.revisionId !== revisionId ||
      (raw.confidenceBasisPoints !== undefined &&
        (typeof raw.confidenceBasisPoints !== 'number' ||
          !Number.isInteger(raw.confidenceBasisPoints) ||
          raw.confidenceBasisPoints < 0 ||
          raw.confidenceBasisPoints > 10000))
    )
      throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
    const identity = `${raw.category}:${raw.code}:${raw.path}`;
    if (identities.has(identity)) throw new SemanticEvaluatorFailure('OUTPUT_INVALID');
    identities.add(identity);
    findings.push(
      Object.freeze({
        category: raw.category,
        code: raw.code,
        severity: raw.severity,
        path: raw.path,
        messageKey: raw.messageKey,
        evidence: Object.freeze(raw.evidence),
        ...(raw.confidenceBasisPoints === undefined
          ? {}
          : { confidenceBasisPoints: raw.confidenceBasisPoints }),
      }),
    );
  }
  return Object.freeze({
    version: '1.0.0',
    evaluatorVersion: semanticEvaluatorRegistry.evaluatorVersion,
    promptVersion: semanticEvaluatorRegistry.promptVersion,
    modelConfigurationVersion: semanticEvaluatorRegistry.modelConfigurationVersion,
    schemaVersion: semanticEvaluatorRegistry.schemaVersion,
    revisionId,
    findings: Object.freeze(findings),
  });
}
export class DeterministicFakeSemanticEvaluator implements SemanticEvaluator {
  public readonly attempts: number[] = [];
  private readonly behavior: (
    input: SemanticEvaluatorInput,
    attempt: number,
  ) => unknown | Promise<unknown>;
  constructor(
    output?: unknown,
    behavior?: (input: SemanticEvaluatorInput, attempt: number) => unknown | Promise<unknown>,
  ) {
    this.behavior =
      behavior ??
      ((input) =>
        output ?? {
          version: '1.0.0',
          evaluatorVersion: semanticEvaluatorRegistry.evaluatorVersion,
          promptVersion: semanticEvaluatorRegistry.promptVersion,
          modelConfigurationVersion: semanticEvaluatorRegistry.modelConfigurationVersion,
          schemaVersion: semanticEvaluatorRegistry.schemaVersion,
          revisionId: input.revisionId,
          findings: [],
        });
  }
  async evaluate(input: SemanticEvaluatorInput): Promise<unknown> {
    const attempt = this.attempts.length + 1;
    this.attempts.push(attempt);
    return this.behavior(input, attempt);
  }
}
function classify(error: unknown): 'TIMEOUT' | 'TRANSIENT' | 'PERMANENT' {
  if (error instanceof SemanticEvaluatorFailure)
    return error.code === 'TIMEOUT' ? 'TIMEOUT' : 'PERMANENT';
  if (error instanceof TransientSemanticEvaluatorError) return 'TRANSIENT';
  if (error instanceof DOMException && error.name === 'AbortError') return 'TIMEOUT';
  return 'PERMANENT';
}
async function attemptWithTimeout(
  evaluator: SemanticEvaluator,
  input: { revisionId: string; operationId: string },
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = evaluator.evaluate(Object.freeze({ ...input, signal: controller.signal }));
    return await new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SemanticEvaluatorFailure('TIMEOUT'));
      }, timeoutMs);
      result.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
export async function evaluateSemanticWithRetry(
  evaluator: SemanticEvaluator,
  input: { revisionId: string; operationId: string },
  maxAttempts: number = semanticEvaluatorRegistry.maxAttempts,
  timeoutMs: number = semanticEvaluatorRegistry.timeoutMs,
): Promise<SemanticEvaluation> {
  const attempts = Math.min(Math.max(1, maxAttempts), semanticEvaluatorRegistry.maxAttempts);
  let last: 'TIMEOUT' | 'TRANSIENT' = 'TRANSIENT';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return parseSemanticEvaluatorOutput(
        await attemptWithTimeout(evaluator, input, timeoutMs),
        input.revisionId,
      );
    } catch (error) {
      const kind = classify(error);
      if (kind === 'PERMANENT')
        throw error instanceof SemanticEvaluatorFailure
          ? error
          : new SemanticEvaluatorFailure('PERMANENT_EVALUATOR_ERROR');
      last = kind;
    }
  }
  throw new SemanticEvaluatorFailure(last === 'TIMEOUT' ? 'TIMEOUT' : 'TRANSIENT_EXHAUSTED');
}
export function liveSemanticEvaluatorPreflight(): Readonly<{
  enabled: false;
  reason: 'LIVE_EVALUATOR_REQUIRES_OWNER_APPROVAL';
}> {
  return { enabled: false, reason: 'LIVE_EVALUATOR_REQUIRES_OWNER_APPROVAL' };
}
export function resolveLiveSemanticEvaluator(): null {
  return null;
}
