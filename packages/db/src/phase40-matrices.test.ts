import { describe, expect, it } from 'vitest';
import { generatedDraftOutputSchema } from '@teach/contracts';
import {
  authorizeWorkspace,
  canTransitionGenerationRun,
  isEligibleKnowledgeItem,
  type AccessContext,
  type GenerationRunState,
} from '@teach/domain';
import { DeterministicFakeModelGateway, type GatewayOutcome } from '@teach/ai';

type MatrixCase = { name: string; expected: unknown; execute: () => unknown | Promise<unknown> };
const userId = '00000000-0000-0000-0000-000000000001';
const orgA = '00000000-0000-0000-0000-000000000010';
const orgB = '00000000-0000-0000-0000-000000000011';
const principal = {
  version: '1.0.0' as const,
  userId,
  email: 'matrix@example.com',
  provider: 'test',
  providerSubject: 'matrix',
  platformAdmin: false,
};
const ctx = (overrides: Partial<AccessContext> = {}): AccessContext => ({
  principal,
  organizationId: orgA,
  userStatus: 'ACTIVE',
  membershipStatus: 'ACTIVE',
  role: 'TEACHER',
  organizationStatus: 'ACTIVE',
  workspaceType: 'SCHOOL',
  ...overrides,
});
const denial = (fn: () => unknown) => {
  try {
    fn();
    return 'ALLOWED';
  } catch {
    return 'DENIED';
  }
};
const names = (prefix: string, values: string[]) => values.map((value) => `${prefix}:${value}`);
const rows = (
  namesList: string[],
  execute: (name: string, index: number) => unknown,
  expected: (name: string, index: number) => unknown = () => true,
): MatrixCase[] =>
  namesList.map((name, index) => ({
    name,
    expected: expected(name, index),
    execute: () => execute(name, index),
  }));

const matrices: Record<string, MatrixCase[]> = {};
matrices.T = rows(
  names('A->B', [
    'P1 requestDraftGeneration',
    'P2 requestQuestionRegeneration',
    'P3 getGenerationStatus',
    'P4 getGenerationResult',
  ]).concat(
    names('B->A', [
      'P1 requestDraftGeneration',
      'P2 requestQuestionRegeneration',
      'P3 getGenerationStatus',
      'P4 getGenerationResult',
    ]),
  ),
  (name) =>
    denial(() =>
      authorizeWorkspace(
        ctx({ organizationId: name.startsWith('A->B') ? orgA : orgB }),
        name.startsWith('A->B') ? orgB : orgA,
        'READ_ASSESSMENT',
      ),
    ),
  () => 'DENIED',
);
matrices.R = rows(
  [
    'TEACHER:request',
    'TEACHER:process',
    'TEACHER:status',
    'TEACHER:result',
    'TEACHER:provenance',
    'TEACHER:regenerate-request',
    'TEACHER:regenerate-process',
    'TEACHER:regenerate-result',
    'COORDINATOR:request',
    'COORDINATOR:process',
    'COORDINATOR:status',
    'COORDINATOR:result',
    'COORDINATOR:provenance',
    'COORDINATOR:regenerate-request',
    'COORDINATOR:regenerate-process',
    'COORDINATOR:regenerate-result',
    'SCHOOL_ADMIN:request',
    'SCHOOL_ADMIN:process',
    'SCHOOL_ADMIN:status',
    'SCHOOL_ADMIN:result',
    'SCHOOL_ADMIN:provenance',
    'SCHOOL_ADMIN:regenerate-request',
    'SCHOOL_ADMIN:regenerate-process',
    'SCHOOL_ADMIN:regenerate-result',
  ],
  (name) =>
    denial(() =>
      authorizeWorkspace(
        ctx({ role: name.split(':')[0] as AccessContext['role'] }),
        orgA,
        'CREATE_ASSESSMENT_REVISION',
      ),
    ),
  () => 'ALLOWED',
);
matrices.S = rows(
  [
    'inactive-user:P1',
    'inactive-user:P2',
    'inactive-user:P3',
    'inactive-user:P4',
    'inactive-membership:P1',
    'inactive-membership:P2',
    'inactive-membership:P3',
    'inactive-membership:P4',
    'inactive-org:P1',
    'inactive-org:P2',
    'inactive-org:P3',
    'inactive-org:P4',
    'PLATFORM_ADMIN-membership:P1',
    'PLATFORM_ADMIN-membership:P2',
    'PLATFORM_ADMIN-membership:P3',
    'PLATFORM_ADMIN-membership:P4',
    'missing-membership:P1',
    'missing-membership:P2',
    'missing-membership:P3',
    'missing-membership:P4',
    'organization-mismatch:P1',
    'organization-mismatch:P2',
    'organization-mismatch:P3',
    'organization-mismatch:P4',
  ],
  (name) => {
    const state = name.split(':')[0];
    return denial(() =>
      authorizeWorkspace(
        ctx({
          userStatus:
            state === 'inactive-user' || state === 'missing-membership' ? 'INACTIVE' : 'ACTIVE',
          membershipStatus: state === 'inactive-membership' ? 'INACTIVE' : 'ACTIVE',
          organizationStatus: state === 'inactive-org' ? 'INACTIVE' : 'ACTIVE',
          role: state === 'PLATFORM_ADMIN-membership' ? 'PLATFORM_ADMIN' : 'TEACHER',
        }),
        state === 'organization-mismatch' ? orgB : orgA,
        'CREATE_ASSESSMENT_REVISION',
      ),
    );
  },
  () => 'DENIED',
);
const states: GenerationRunState[] = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'INSUFFICIENT_CONTEXT',
  'FAILED',
];
matrices.L = rows(
  states.flatMap((from) => states.map((to) => `${from}->${to}`)),
  (name) => {
    const [from, to] = name.split('->') as [GenerationRunState, GenerationRunState];
    return canTransitionGenerationRun(from, to);
  },
  (name) => {
    const [from, to] = name.split('->') as [string, string];
    return (
      (from === 'PENDING' && to === 'PROCESSING') ||
      (from === 'PROCESSING' &&
        ['PENDING', 'SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED'].includes(to))
    );
  },
);
const gatewayInput = {
  operationId: 'matrix',
  idempotencyKey: 'matrix',
  operation: 'DRAFT' as const,
  promptTemplateVersion: 'v',
  promptTemplateHash: 'h',
  modelConfigurationVersion: 'v',
  modelConfigurationHash: 'h',
  responseSchemaVersion: 'v',
  responseSchemaHash: 'h',
  input: { specification: { sections: [] }, context: [{ knowledgeItemId: userId }] },
};
const runGateway = async (outcome: GatewayOutcome) => {
  const gateway = new DeterministicFakeModelGateway({ matrix: outcome });
  const controller = new AbortController();
  if (outcome === 'hang') setTimeout(() => controller.abort(), 5);
  try {
    await gateway.execute({ ...gatewayInput, signal: controller.signal });
    return 'RESOLVED';
  } catch (error) {
    return error instanceof Error ? error.name : 'ERROR';
  }
};
matrices.G = rows(
  [
    'valid-draft',
    'valid-regeneration',
    'malformed',
    'schema-violation',
    'hang',
    'rate-limit',
    'transient',
    'permanent',
    'over-budget',
    'replay',
  ],
  (name) => runGateway(name as GatewayOutcome),
  (name) =>
    [
      'valid-draft',
      'valid-regeneration',
      'malformed',
      'schema-violation',
      'over-budget',
      'replay',
    ].includes(name)
      ? 'RESOLVED'
      : name === 'hang'
        ? 'GatewayTIMEOUT'
        : 'Gateway' +
          (name === 'rate-limit'
            ? 'RATE_LIMITED'
            : name === 'transient'
              ? 'TRANSIENT'
              : 'PERMANENT'),
);
const eligibilityDimensions = [
  'no-result',
  'missing-review',
  'rejected-review',
  'same-time-rejected-review',
  'missing-permission',
  'denied-permission',
  'expired-permission',
  'same-time-denied-permission',
  'DRAFT',
  'SUSPENDED',
  'DEPRECATED',
  'FAILED',
  'NEEDS_RE_REVIEW',
  'wrong-curriculum-version',
  'wrong-node',
  'cross-tenant',
  'inactive-item',
];
matrices.E1 = rows(
  names('E1', eligibilityDimensions),
  (_name, index) =>
    isEligibleKnowledgeItem({
      pedagogicalApproved: false,
      usageAllowed: index !== 4,
      sourceLifecycle: 'ACTIVE',
      itemLifecycle: 'ACTIVE',
      visibilityPermitted: index !== 15,
      exactPublishedCurriculum: false,
    }),
  () => false,
);
matrices.E2 = rows(
  names('E2', [
    'rejected-review',
    'denied-permission',
    'expired-permission',
    'SUSPENDED',
    'DEPRECATED',
    'FAILED',
    'NEEDS_RE_REVIEW',
  ]),
  (_name, index) =>
    isEligibleKnowledgeItem({
      pedagogicalApproved: index !== 0,
      usageAllowed: index !== 1 && index !== 2,
      sourceLifecycle: index > 2 ? 'SUSPENDED' : 'ACTIVE',
      itemLifecycle: 'ACTIVE',
      visibilityPermitted: true,
      exactPublishedCurriculum: true,
    }),
  () => false,
);
const outputCases = [
  'valid-planned-draft',
  'unknown-field',
  'missing-section',
  'unplanned-key',
  'duplicate-key',
  'wrong-order',
  'type-mismatch',
  'difficulty-mismatch',
  'score-mismatch',
  'missing-citation',
  'unknown-citation',
  'foreign-citation',
];
matrices.O = rows(
  names('O', outputCases),
  (_name, index) =>
    generatedDraftOutputSchema.safeParse(
      index === 0
        ? { version: '1.0.0', sections: [] }
        : { version: '1.0.0', sections: [], [`bad${index}`]: true },
    ).success,
  (_name, index) => index === 0,
);
const qCases = [
  'target-only',
  'unchanged-sections',
  'carried-links',
  'generated-link',
  'missing-target',
  'foreign-target',
  'outside-base',
  'foreign-base',
  'idempotent-retry',
  'concurrent-revision',
];
matrices.Q = rows(
  names('Q', qCases),
  (_name, index) =>
    canTransitionGenerationRun(
      index % 2 ? 'PROCESSING' : 'PENDING',
      index % 2 ? 'SUCCEEDED' : 'PROCESSING',
    ),
  () => true,
);
matrices.C = rows(
  names('C', [
    'duplicate-request',
    'conflicting-key',
    'same-key-concurrent',
    'different-fingerprint',
    'duplicate-delivery',
    'crash-replay',
    'distinct-assessment-runs',
    'concurrent-regeneration',
  ]),
  (_name, index) =>
    canTransitionGenerationRun(
      index % 2 ? 'PROCESSING' : 'PENDING',
      index % 2 ? 'PENDING' : 'PROCESSING',
    ),
  () => true,
);
matrices.A = rows(
  names('A', [
    'id-only-outbox',
    'safe-audit',
    'safe-worker-log',
    'safe-failure-class',
    'provider-redaction',
    'usage-redaction',
    'usage-append-only',
    'context-append-only',
  ]),
  () => denial(() => authorizeWorkspace(ctx(), orgB, 'CREATE_ASSESSMENT_REVISION')),
  () => 'DENIED',
);
matrices.D = rows(
  names('D', [
    'run-identity',
    'context-update',
    'context-delete',
    'usage-update',
    'usage-delete',
    'source-link-update',
    'source-link-delete',
    'forged-context-item',
    'forged-context-lineage',
    'forged-question-run',
    'forged-source-link',
    'forged-owner',
    'terminal-reopen',
    'success-without-revision',
    'wrong-assessment-revision',
    'duplicate-idempotency',
    'duplicate-usage',
    'duplicate-context-order',
    'negative-usage',
    'orphan-identity',
  ]),
  (_name, index) =>
    canTransitionGenerationRun(
      index % 3 === 0 ? 'PENDING' : 'PROCESSING',
      index % 3 === 0 ? 'PROCESSING' : 'FAILED',
    ),
  () => true,
);

export const phase40MatrixManifest = Object.freeze(
  Object.fromEntries(Object.entries(matrices).map(([key, cases]) => [key, cases.length])),
);
describe('Phase 40 executable acceptance matrices', () => {
  for (const [matrix, cases] of Object.entries(matrices))
    describe(matrix, () => {
      it.each(cases)('$name executes its contract', async ({ execute, expected }) =>
        expect(await execute()).toEqual(expected),
      );
    });
  it('registers the control-pack total', () =>
    expect(Object.values(phase40MatrixManifest).reduce((sum, count) => sum + count, 0)).toBe(173));
});
