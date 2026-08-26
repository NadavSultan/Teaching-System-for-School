import { createHash } from 'node:crypto';
export * from './semantic-evaluator.js';

export type GatewayOutcome =
  | 'valid-draft'
  | 'valid-regeneration'
  | 'malformed'
  | 'schema-violation'
  | 'timeout'
  | 'hang'
  | 'rate-limit'
  | 'transient'
  | 'permanent'
  | 'over-budget'
  | 'replay';

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicros: number;
  finishReason: string;
};

export type ModelRequest = {
  operationId: string;
  idempotencyKey: string;
  operation: 'DRAFT' | 'REGENERATE_QUESTION';
  promptTemplateVersion: string;
  promptTemplateHash: string;
  modelConfigurationVersion: string;
  modelConfigurationHash: string;
  responseSchemaVersion: string;
  responseSchemaHash: string;
  input: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
};

export type ModelResponse = {
  provider: string;
  model: string;
  requestId: string;
  output: unknown;
  usage: ModelUsage;
  finishReason: string;
};

export interface ModelGateway {
  execute(request: ModelRequest): Promise<ModelResponse>;
}

export class GatewayFailure extends Error {
  constructor(
    public readonly code: 'TIMEOUT' | 'RATE_LIMITED' | 'TRANSIENT' | 'PERMANENT',
    message = code,
  ) {
    super(message);
    this.name = `Gateway${code}`;
  }
}

const promptContent =
  'Generate only schema-valid educational content grounded in selected context.';
const modelConfiguration = Object.freeze({
  version: 'fake-v1',
  provider: 'fake' as const,
  model: 'deterministic-hebrew-v1',
  timeoutMs: 2_000,
  maxAttempts: 3,
  maxContextItems: 20,
  maxContextChars: 40_000,
  maxContextTokens: 10_000,
  maxOutputTokens: 2_000,
  maxCostMicros: 100_000,
});

export const generationPromptTemplates = Object.freeze({
  draft: Object.freeze({
    version: 'draft-v1',
    content: promptContent,
    hash: createHash('sha256').update(promptContent).digest('hex'),
  }),
  regeneration: Object.freeze({
    version: 'regeneration-v1',
    content: `${promptContent} Regenerate only the target question content.`,
    hash: createHash('sha256')
      .update(`${promptContent} Regenerate only the target question content.`)
      .digest('hex'),
  }),
});

export const generationModelConfigurations = Object.freeze({
  fake: Object.freeze({
    ...modelConfiguration,
    hash: createHash('sha256').update(JSON.stringify(modelConfiguration)).digest('hex'),
  }),
});

export function getGenerationModelConfiguration() {
  return generationModelConfigurations.fake;
}

export function getGenerationPromptTemplate(operation: 'DRAFT' | 'REGENERATE_QUESTION') {
  return operation === 'DRAFT'
    ? generationPromptTemplates.draft
    : generationPromptTemplates.regeneration;
}

export function liveEvaluationPreflight(): { enabled: false; reason: string } {
  return {
    enabled: false,
    reason: 'LIVE_PROVIDER_EVALUATION_REQUIRES_OWNER_APPROVAL_AND_SEPARATE_ADAPTER',
  };
}

export function resolveConfiguredGenerationGateway(): ModelGateway | null {
  if (
    process.env.PHASE40_GATEWAY === 'fake' &&
    ['test', 'development'].includes(process.env.NODE_ENV ?? '')
  ) {
    return new DeterministicFakeModelGateway();
  }
  return null;
}

function contextIds(input: Readonly<Record<string, unknown>>): string[] {
  const context = input.context;
  if (!Array.isArray(context)) return [];
  return context
    .map((item) =>
      item && typeof item === 'object' && 'knowledgeItemId' in item ? item.knowledgeItemId : null,
    )
    .filter((id): id is string => typeof id === 'string');
}

function fakeDraft(input: Readonly<Record<string, unknown>>) {
  const specification = input.specification as {
    sections?: Array<{
      key: string;
      order: number;
      questions: Array<{
        key: string;
        order: number;
        type: string;
        difficulty: string;
        scoreUnits: number | null;
      }>;
    }>;
  };
  const citations = contextIds(input);
  return {
    version: '1.0.0',
    sections: (specification.sections ?? []).map((section) => ({
      key: section.key,
      order: section.order,
      questions: section.questions.map((question) => ({
        key: question.key,
        order: question.order,
        type: question.type,
        difficulty: question.difficulty,
        scoreUnits: question.scoreUnits,
        content: {
          prompt: `שאלה בעברית ${question.key}`,
          instructions: 'ענו לפי הקטע המצורף.',
          answers: [],
          rubrics: [],
          subQuestions: [],
        },
        citations: citations.slice(0, 2),
      })),
    })),
  };
}

function fakeRegeneration(input: Readonly<Record<string, unknown>>) {
  const citations = contextIds(input);
  return {
    version: '1.0.0',
    content: {
      prompt: 'שאלה מחודשת בעברית המבוססת על מקור מאושר.',
      instructions: 'ענו לפי ההקשר שנבחר.',
      answers: [],
      rubrics: [],
      subQuestions: [],
    },
    citations: citations.slice(0, 2),
  };
}

export class DeterministicFakeModelGateway implements ModelGateway {
  private readonly outcomes = new Map<string, GatewayOutcome>();

  constructor(outcomes: Readonly<Record<string, GatewayOutcome>> = {}) {
    for (const [operationId, outcome] of Object.entries(outcomes))
      this.outcomes.set(operationId, outcome);
  }

  setOutcome(operationId: string, outcome: GatewayOutcome): void {
    this.outcomes.set(operationId, outcome);
  }

  async execute(request: ModelRequest): Promise<ModelResponse> {
    const outcome = this.outcomes.get(request.operationId) ?? 'valid-draft';
    if (outcome === 'timeout') throw new GatewayFailure('TIMEOUT');
    if (outcome === 'hang') {
      await new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new GatewayFailure('TIMEOUT')), 60_000);
        request.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new GatewayFailure('TIMEOUT'));
          },
          { once: true },
        );
      });
    }
    if (outcome === 'rate-limit') throw new GatewayFailure('RATE_LIMITED');
    if (outcome === 'transient') throw new GatewayFailure('TRANSIENT');
    if (outcome === 'permanent') throw new GatewayFailure('PERMANENT');
    const output =
      outcome === 'malformed'
        ? 'malformed'
        : outcome === 'schema-violation'
          ? { version: '1.0.0', unexpected: true }
          : request.operation === 'DRAFT'
            ? fakeDraft(request.input)
            : fakeRegeneration(request.input);
    const inputTokens = Math.max(1, JSON.stringify(request.input).length >> 2);
    const outputTokens = Math.max(1, JSON.stringify(output).length >> 2);
    const usage: ModelUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costMicros: inputTokens + outputTokens,
      finishReason: outcome === 'over-budget' ? 'length' : 'stop',
    };
    return {
      provider: modelConfiguration.provider,
      model: modelConfiguration.model,
      requestId: `fake:${request.operationId}`,
      output,
      usage,
      finishReason: usage.finishReason,
    };
  }
}
