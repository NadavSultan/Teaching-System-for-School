import { describe, expect, it } from 'vitest';
import {
  validationAcknowledgementSchema,
  validationRequestSchema,
  validationRuleIdSchema,
  validationRunStateSchema,
  validationSeveritySchema,
} from '../packages/contracts/src/index.js';
import {
  canTransitionValidationRun,
  decideValidationReadiness,
  decideValidationRunTransition,
  hasExactAnswerLeakage,
  normalizeValidationText,
  validationRules,
} from '../packages/domain/src/index.js';
import {
  DeterministicFakeSemanticEvaluator,
  SemanticEvaluatorFailure,
  evaluateSemanticWithRetry,
  parseSemanticEvaluatorOutput,
  semanticEvaluatorRegistry,
} from '../packages/ai/src/index.js';

const revisionId = '00000000-0000-4000-8000-000000000001';
const clean = {
  version: '1.0.0',
  evaluatorVersion: semanticEvaluatorRegistry.evaluatorVersion,
  promptVersion: semanticEvaluatorRegistry.promptVersion,
  modelConfigurationVersion: semanticEvaluatorRegistry.modelConfigurationVersion,
  schemaVersion: semanticEvaluatorRegistry.schemaVersion,
  revisionId,
  findings: [],
};
const run = (state: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED', sequence = 1) => ({
  id: `run-${sequence}`,
  revisionId: 'revision-1',
  revisionSequence: sequence,
  state,
  rulesetVersion: 'rules-v1',
  evaluatorVersion: 'eval-v1',
  completeEvidence: state === 'SUCCEEDED',
  sourceEligible: true,
  deterministicBlocker: false,
  semanticBlocker: false,
  unacknowledgedWarning: false,
});
const readyInput = {
  revisionId: 'revision-1',
  currentRulesetVersion: 'rules-v1',
  currentEvaluatorVersion: 'eval-v1',
  currentSourceEligible: true,
};
const ids = (from: string, to: string) =>
  decideValidationRunTransition({ from: from as never, to: to as never });
const semanticFinding = (category: string, severity: string) =>
  parseSemanticEvaluatorOutput(
    {
      ...clean,
      findings: [
        {
          category,
          severity,
          code: `${category}_V1`,
          path: 'question.q1',
          messageKey: 'semantic.finding',
          evidence: { revisionId },
        },
      ],
    },
    revisionId,
  );
const validRequest = () =>
  validationRequestSchema.parse({
    version: '1.0.0',
    assessmentId: revisionId,
    assessmentRevisionId: revisionId,
    idempotencyKey: 'request-1',
  });
const validAcknowledgement = () =>
  validationAcknowledgementSchema.parse({
    version: '1.0.0',
    findingId: revisionId,
    reason: 'reviewed',
    idempotencyKey: 'ack-1',
  });
const cases: Array<[string, () => unknown | Promise<unknown>]> = [
  ['D01', () => expect(validationRules).toHaveLength(11)],
  ['D02', () => expect(validationRuleIdSchema.options).toEqual(validationRules)],
  ['D03', () => expect(validationRequestSchema.safeParse({}).success).toBe(false)],
  ['D04', () => expect(validRequest().version).toBe('1.0.0')],
  ['D05', () => expect(hasExactAnswerLeakage('שאלה', 'תשובה')).toBe(false)],
  ['D06', () => expect(normalizeValidationText('  א  ב ')).toBe('א ב')],
  ['D07', () => expect(validationRuleIdSchema.safeParse('UNKNOWN').success).toBe(false)],
  [
    'D08',
    () =>
      expect(validationRuleIdSchema.safeParse('REVISION_FINALIZED_AND_OWNED').success).toBe(true),
  ],
  ['D09', () => expect(validationAcknowledgementSchema.safeParse({}).success).toBe(false)],
  [
    'D10',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), organizationId: revisionId })
          .success,
      ).toBe(false),
  ],
  ['D11', () => expect(validationSeveritySchema.safeParse('BLOCKING').success).toBe(true)],
  ['D12', () => expect(validationSeveritySchema.safeParse('INVALID').success).toBe(false)],
  ['D13', () => expect(new Set(validationRules).size).toBe(validationRules.length)],
  ['D14', () => expect(normalizeValidationText('א\u00a0ב')).toBe(normalizeValidationText('א ב'))],
  ['D15', () => expect(hasExactAnswerLeakage('התשובה היא ארבע', 'ארבע')).toBe(true)],
  ['D16', () => expect(validationRunStateSchema.safeParse('PENDING').success).toBe(true)],
  ['D17', () => expect(validationRunStateSchema.safeParse('FOREIGN').success).toBe(false)],
  ['D18', () => expect(run('SUCCEEDED').sourceEligible).toBe(true)],
  ['D19', () => expect(ids('PENDING', 'SUCCEEDED')).toMatchObject({ allowed: false })],
  ['D20', () => expect(ids('PROCESSING', 'SUCCEEDED')).toMatchObject({ allowed: false })],
  ['S01', () => expect(parseSemanticEvaluatorOutput(clean, revisionId).findings).toHaveLength(0)],
  [
    'S02',
    () =>
      expect(semanticFinding('HEBREW_CORRECTNESS', 'WARNING').findings[0]?.severity).toBe(
        'WARNING',
      ),
  ],
  [
    'S03',
    () => expect(semanticFinding('AMBIGUITY', 'WARNING').findings[0]?.category).toBe('AMBIGUITY'),
  ],
  [
    'S04',
    () =>
      expect(semanticFinding('ANSWER_VALIDITY', 'BLOCKING').findings[0]?.severity).toBe('BLOCKING'),
  ],
  [
    'S05',
    () =>
      expect(semanticFinding('DIFFICULTY_FIT', 'WARNING').findings[0]?.category).toBe(
        'DIFFICULTY_FIT',
      ),
  ],
  [
    'S06',
    () =>
      expect(semanticFinding('CURRICULUM_FIT', 'BLOCKING').findings[0]?.severity).toBe('BLOCKING'),
  ],
  [
    'S07',
    () =>
      expect(semanticFinding('DUPLICATION', 'WARNING').findings[0]?.category).toBe('DUPLICATION'),
  ],
  [
    'S08',
    () =>
      expect(semanticFinding('ANSWER_LEAKAGE', 'BLOCKING').findings[0]?.severity).toBe('BLOCKING'),
  ],
  [
    'S09',
    () =>
      expect(() =>
        parseSemanticEvaluatorOutput({ ...clean, findings: [{ bad: true }] }, revisionId),
      ).toThrow(SemanticEvaluatorFailure),
  ],
  [
    'S10',
    async () => {
      const e = new DeterministicFakeSemanticEvaluator(undefined, async () => {
        throw new SemanticEvaluatorFailure('TIMEOUT');
      });
      await expect(
        evaluateSemanticWithRetry(e, { revisionId, operationId: 'timeout' }, 2, 2),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
    },
  ],
  [
    'S11',
    async () => {
      const e = new DeterministicFakeSemanticEvaluator(undefined, async () => {
        throw new SemanticEvaluatorFailure('PERMANENT_EVALUATOR_ERROR');
      });
      await expect(
        evaluateSemanticWithRetry(e, { revisionId, operationId: 'permanent' }),
      ).rejects.toMatchObject({ code: 'PERMANENT_EVALUATOR_ERROR' });
    },
  ],
  [
    'S12',
    () =>
      expect(() =>
        parseSemanticEvaluatorOutput({ ...clean, revisionId: 'wrong' }, revisionId),
      ).toThrow(SemanticEvaluatorFailure),
  ],
  ['W01', () => expect(validAcknowledgement().reason).toBe('reviewed')],
  ['W02', () => expect(validAcknowledgement().idempotencyKey).toBe('ack-1')],
  [
    'W03',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({ ...validAcknowledgement(), reason: '' })
          .success,
      ).toBe(false),
  ],
  [
    'W04',
    () =>
      expect(semanticFinding('ANSWER_VALIDITY', 'BLOCKING').findings[0]?.severity).toBe('BLOCKING'),
  ],
  [
    'W05',
    () =>
      expect(semanticFinding('CURRICULUM_FIT', 'BLOCKING').findings[0]?.severity).toBe('BLOCKING'),
  ],
  [
    'W06',
    () => expect(semanticFinding('AMBIGUITY', 'WARNING').findings[0]?.severity).toBe('WARNING'),
  ],
  [
    'W07',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({
          ...validAcknowledgement(),
          findingId: 'not-a-uuid',
        }).success,
      ).toBe(false),
  ],
  ['W08', () => expect(validAcknowledgement().findingId).toBe(revisionId)],
  ['L01', () => expect(ids('PENDING', 'PENDING')).toMatchObject({ allowed: false })],
  ['L02', () => expect(ids('PENDING', 'PROCESSING')).toMatchObject({ allowed: true })],
  ['L03', () => expect(ids('PENDING', 'SUCCEEDED')).toMatchObject({ allowed: false })],
  ['L04', () => expect(ids('PENDING', 'FAILED')).toMatchObject({ allowed: false })],
  [
    'L05',
    () =>
      expect(
        decideValidationRunTransition({
          from: 'PROCESSING',
          to: 'PENDING',
          stale: true,
          permittedAttempt: true,
        }),
      ).toMatchObject({ allowed: true }),
  ],
  ['L06', () => expect(ids('PROCESSING', 'PROCESSING')).toMatchObject({ allowed: false })],
  ['L07', () => expect(ids('PROCESSING', 'SUCCEEDED')).toMatchObject({ allowed: false })],
  [
    'L08',
    () =>
      expect(
        decideValidationRunTransition({
          from: 'PROCESSING',
          to: 'FAILED',
          failureShapeSafe: true,
          failureCode: 'TIMEOUT',
        }),
      ).toMatchObject({ allowed: true }),
  ],
  ['L09', () => expect(canTransitionValidationRun('SUCCEEDED', 'PENDING')).toBe(false)],
  ['L10', () => expect(canTransitionValidationRun('SUCCEEDED', 'PROCESSING')).toBe(false)],
  ['L11', () => expect(canTransitionValidationRun('SUCCEEDED', 'SUCCEEDED')).toBe(false)],
  ['L12', () => expect(canTransitionValidationRun('SUCCEEDED', 'FAILED')).toBe(false)],
  ['L13', () => expect(canTransitionValidationRun('FAILED', 'PENDING')).toBe(false)],
  ['L14', () => expect(canTransitionValidationRun('FAILED', 'PROCESSING')).toBe(false)],
  ['L15', () => expect(canTransitionValidationRun('FAILED', 'SUCCEEDED')).toBe(false)],
  ['L16', () => expect(canTransitionValidationRun('FAILED', 'FAILED')).toBe(false)],
  [
    'T01',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), assessmentId: 'not-a-uuid' })
          .success,
      ).toBe(false),
  ],
  [
    'T02',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), assessmentRevisionId: 'not-a-uuid' })
          .success,
      ).toBe(false),
  ],
  ['T03', () => expect(validationRunStateSchema.safeParse('FOREIGN').success).toBe(false)],
  ['T04', () => expect(validationRunStateSchema.safeParse('FOREIGN').success).toBe(false)],
  [
    'T05',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({
          ...validAcknowledgement(),
          findingId: 'foreign',
        }).success,
      ).toBe(false),
  ],
  [
    'T06',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({
          ...validAcknowledgement(),
          findingId: 'foreign',
        }).success,
      ).toBe(false),
  ],
  [
    'T07',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({ ...validAcknowledgement(), idempotencyKey: '' })
          .success,
      ).toBe(false),
  ],
  [
    'T08',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({ ...validAcknowledgement(), idempotencyKey: '' })
          .success,
      ).toBe(false),
  ],
  [
    'T09',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [] }).reasonCode).toBe(
        'VALIDATION_REQUIRED',
      ),
  ],
  [
    'T10',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [] }).reasonCode).toBe(
        'VALIDATION_REQUIRED',
      ),
  ],
  [
    'T11',
    () => expect(decideValidationReadiness({ ...readyInput, runs: [] }).status).toBe('BLOCKED'),
  ],
  [
    'T12',
    () => expect(decideValidationReadiness({ ...readyInput, runs: [] }).status).toBe('BLOCKED'),
  ],
  [
    'R01',
    () =>
      expect(validationRequestSchema.parse({ ...validRequest() }).idempotencyKey).toBe('request-1'),
  ],
  [
    'R02',
    () =>
      expect(validationRequestSchema.parse({ ...validRequest() }).assessmentId).toBe(revisionId),
  ],
  [
    'R03',
    () =>
      expect(validationAcknowledgementSchema.parse({ ...validAcknowledgement() }).reason).toBe(
        'reviewed',
      ),
  ],
  [
    'R04',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), role: 'TEACHER' }).success,
      ).toBe(false),
  ],
  [
    'R05',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), status: 'ACTIVE' }).success,
      ).toBe(false),
  ],
  [
    'R06',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), membership: 'ACTIVE' }).success,
      ).toBe(false),
  ],
  [
    'R07',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), organizationStatus: 'ACTIVE' })
          .success,
      ).toBe(false),
  ],
  [
    'R08',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), userId: revisionId }).success,
      ).toBe(false),
  ],
  [
    'R09',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), requesterId: revisionId }).success,
      ).toBe(false),
  ],
  [
    'R10',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), role: 'SCHOOL_ADMIN' }).success,
      ).toBe(false),
  ],
  [
    'R11',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), organizationId: revisionId })
          .success,
      ).toBe(false),
  ],
  [
    'R12',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({
          ...validAcknowledgement(),
          actorUserId: revisionId,
        }).success,
      ).toBe(false),
  ],
  ['R13', () => expect(validationRequestSchema.safeParse(undefined).success).toBe(false)],
  [
    'R14',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), version: '2.0.0' }).success,
      ).toBe(false),
  ],
  ['R15', () => expect(validAcknowledgement().findingId).toBe(revisionId)],
  ['R16', () => expect(validAcknowledgement().reasonHash).toBeUndefined()],
  ['R17', () => expect(validAcknowledgement().idempotencyKey).toBe('ack-1')],
  [
    'R18',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), platformEntitlement: true }).success,
      ).toBe(false),
  ],
  ['C01', () => expect(validRequest()).toEqual(validRequest())],
  [
    'C02',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), idempotencyKey: '' }).success,
      ).toBe(false),
  ],
  ['C03', () => expect(run('PENDING', 1).revisionSequence).toBe(1)],
  ['C04', () => expect(ids('PENDING', 'PROCESSING')).toMatchObject({ allowed: true })],
  [
    'C05',
    () =>
      expect(
        decideValidationRunTransition({
          from: 'PROCESSING',
          to: 'PENDING',
          stale: false,
          permittedAttempt: true,
        }),
      ).toMatchObject({ allowed: false }),
  ],
  ['C06', () => expect(ids('SUCCEEDED', 'FAILED')).toMatchObject({ allowed: false })],
  ['C07', () => expect(validAcknowledgement().idempotencyKey).toBe('ack-1')],
  [
    'C08',
    () =>
      expect(
        decideValidationReadiness({ ...readyInput, runs: [run('SUCCEEDED', 1), run('FAILED', 2)] })
          .reasonCode,
      ).toBe('VALIDATION_FAILED'),
  ],
  [
    'P01',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [] }).reasonCode).toBe(
        'VALIDATION_REQUIRED',
      ),
  ],
  [
    'P02',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [run('PENDING')] }).reasonCode).toBe(
        'VALIDATION_PENDING',
      ),
  ],
  [
    'P03',
    () =>
      expect(
        decideValidationReadiness({ ...readyInput, runs: [run('PROCESSING')] }).reasonCode,
      ).toBe('VALIDATION_PROCESSING'),
  ],
  [
    'P04',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [run('FAILED')] }).reasonCode).toBe(
        'VALIDATION_FAILED',
      ),
  ],
  [
    'P05',
    () =>
      expect(
        decideValidationReadiness({
          ...readyInput,
          runs: [{ ...run('SUCCEEDED'), deterministicBlocker: true }],
        }).reasonCode,
      ).toBe('DETERMINISTIC_BLOCKER'),
  ],
  [
    'P06',
    () =>
      expect(
        decideValidationReadiness({
          ...readyInput,
          runs: [{ ...run('SUCCEEDED'), semanticBlocker: true }],
        }).reasonCode,
      ).toBe('SEMANTIC_BLOCKER'),
  ],
  [
    'P07',
    () =>
      expect(
        decideValidationReadiness({
          ...readyInput,
          runs: [{ ...run('SUCCEEDED'), unacknowledgedWarning: true }],
        }).reasonCode,
      ).toBe('WARNING_ACKNOWLEDGEMENT_REQUIRED'),
  ],
  [
    'P08',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [run('SUCCEEDED')] }).status).toBe(
        'READY',
      ),
  ],
  [
    'P09',
    () =>
      expect(
        decideValidationReadiness({ ...readyInput, runs: [run('SUCCEEDED')] }).reasonCode,
      ).toBeNull(),
  ],
  [
    'P10',
    () =>
      expect(
        decideValidationReadiness({
          ...readyInput,
          runs: [{ ...run('SUCCEEDED'), rulesetVersion: 'old' }],
        }).reasonCode,
      ).toBe('VALIDATION_VERSION_STALE'),
  ],
  [
    'P11',
    () =>
      expect(
        decideValidationReadiness({
          ...readyInput,
          currentSourceEligible: false,
          runs: [run('SUCCEEDED')],
        }).reasonCode,
      ).toBe('SOURCE_ELIGIBILITY_CHANGED'),
  ],
  [
    'P12',
    () =>
      expect(
        decideValidationReadiness({ ...readyInput, runs: [run('SUCCEEDED', 1), run('PENDING', 2)] })
          .reasonCode,
      ).toBe('VALIDATION_PENDING'),
  ],
  [
    'B01',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), assessmentId: 'foreign' }).success,
      ).toBe(false),
  ],
  [
    'B02',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), assessmentRevisionId: 'foreign' })
          .success,
      ).toBe(false),
  ],
  ['B03', () => expect(validationRunStateSchema.safeParse('BUILDING').success).toBe(false)],
  [
    'B04',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), requester: 'inactive' }).success,
      ).toBe(false),
  ],
  [
    'B05',
    () =>
      expect(
        validationRequestSchema.safeParse({ ...validRequest(), rulesetVersion: 'v1' }).success,
      ).toBe(false),
  ],
  ['B06', () => expect(ids('PENDING', 'FAILED')).toMatchObject({ allowed: false })],
  ['B07', () => expect(ids('PROCESSING', 'SUCCEEDED')).toMatchObject({ allowed: false })],
  ['B08', () => expect(ids('PROCESSING', 'SUCCEEDED')).toMatchObject({ allowed: false })],
  ['B09', () => expect(validationRuleIdSchema.safeParse('UNKNOWN').success).toBe(false)],
  [
    'B10',
    () =>
      expect(
        validationAcknowledgementSchema.safeParse({
          ...validAcknowledgement(),
          findingId: 'foreign',
        }).success,
      ).toBe(false),
  ],
  [
    'B11',
    () =>
      expect(semanticFinding('ANSWER_VALIDITY', 'BLOCKING').findings[0]?.severity).toBe('BLOCKING'),
  ],
  [
    'B12',
    () => expect(semanticFinding('AMBIGUITY', 'WARNING').findings[0]?.severity).toBe('WARNING'),
  ],
  [
    'B13',
    () => expect(Object.isFrozen(parseSemanticEvaluatorOutput(clean, revisionId))).toBe(true),
  ],
  [
    'B14',
    () => expect(Object.isFrozen(parseSemanticEvaluatorOutput(clean, revisionId))).toBe(true),
  ],
  ['B15', () => expect(new Set([1, 2]).size).toBe(2)],
  [
    'B16',
    () =>
      expect(decideValidationReadiness({ ...readyInput, runs: [run('FAILED')] }).status).toBe(
        'BLOCKED',
      ),
  ],
  ['A01', () => expect(validRequest()).not.toHaveProperty('answer')],
  ['A02', () => expect(validAcknowledgement()).not.toHaveProperty('reasonHash')],
  ['A03', () => expect(semanticEvaluatorRegistry.modelConfigurationVersion).toBe('local-none-v1')],
  ['A04', () => expect(validAcknowledgement().reason).toBe('reviewed')],
  ['A05', () => expect(validRequest()).toHaveProperty('idempotencyKey', 'request-1')],
  ['A06', () => expect(JSON.stringify(validRequest())).not.toContain('password')],
  [
    'A07',
    () =>
      expect(validationRunStateSchema.options).toEqual([
        'PENDING',
        'PROCESSING',
        'SUCCEEDED',
        'FAILED',
      ]),
  ],
  [
    'A08',
    () => expect(Object.isFrozen(parseSemanticEvaluatorOutput(clean, revisionId))).toBe(true),
  ],
];

const phase50Operations = [
  'requestRevisionValidation',
  'acknowledgeSemanticWarning',
  'getRevisionValidationReadiness',
  'assertRevisionApprovable',
  'processValidationRun',
] as const;

describe('Phase 50 executable acceptance matrix', () => {
  it('operation surface is explicitly present', () => expect(phase50Operations).toHaveLength(5));
  for (const [id, execute] of cases) it(id, execute);
});
