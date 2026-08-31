import { describe, expect, it } from 'vitest';
import {
  decideValidationRunTransition,
  validationRules,
  type ValidationExecution,
} from './validation.js';
const executions: readonly ValidationExecution[] = validationRules.map((ruleId) => ({
  ruleId,
  ruleVersion: '1.0.0',
  outcome: 'PASS' as const,
}));
const success = {
  completeRuleCount: 11,
  completeExecutions: executions,
  deterministicPassCount: 11,
  deterministicFailCount: 0,
  semanticSucceeded: true,
  semanticExecutionComplete: true,
};
const expected = (from: string, to: string) => {
  const r = decideValidationRunTransition({
    from: from as never,
    to: to as never,
    stale: true,
    permittedAttempt: true,
    failureShapeSafe: true,
    failureCode: 'TIMEOUT',
    ...success,
  });
  const legal =
    (from === 'PENDING' && to === 'PROCESSING') ||
    (from === 'PROCESSING' && ['PENDING', 'SUCCEEDED', 'FAILED'].includes(to));
  expect(r.allowed).toBe(legal);
};
describe('Package 1B lifecycle matrix', () => {
  it('L01 rejects PENDING to PENDING as an illegal pair', () => expected('PENDING', 'PENDING'));
  it('L02 allows PENDING to PROCESSING as a claim', () => expected('PENDING', 'PROCESSING'));
  it('L03 rejects PENDING to SUCCEEDED as an illegal pair', () => expected('PENDING', 'SUCCEEDED'));
  it('L04 rejects PENDING to FAILED as an illegal pair', () => expected('PENDING', 'FAILED'));
  it('L05 allows PROCESSING to PENDING only for an expired permitted retry', () => {
    expected('PROCESSING', 'PENDING');
    expect(
      decideValidationRunTransition({ from: 'PROCESSING', to: 'PENDING', stale: true }),
    ).toMatchObject({ allowed: false, reason: 'LEASE_NOT_STALE' });
  });
  it('L06 rejects PROCESSING to PROCESSING as an illegal pair', () =>
    expected('PROCESSING', 'PROCESSING'));
  it('L07 allows PROCESSING to SUCCEEDED only with the exact complete evidence shape', () => {
    expected('PROCESSING', 'SUCCEEDED');
  });
  it('D20 rejects absent, reordered, unknown, wrong-version, and duplicate execution sets', () => {
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'SUCCEEDED',
        ...success,
        completeExecutions: executions.slice(0, 10),
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'SUCCEEDED',
        ...success,
        completeExecutions: [...executions].reverse(),
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'SUCCEEDED',
        ...success,
        completeExecutions: [
          ...executions.slice(0, 10),
          { ruleId: 'UNKNOWN' as never, ruleVersion: '1.0.0', outcome: 'PASS' },
        ],
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'SUCCEEDED',
        ...success,
        completeExecutions: executions.map((x, i) =>
          i === 0 ? { ...x, ruleVersion: 'other' as never } : x,
        ),
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
    const duplicate = [...executions.slice(0, 10), executions[9]!];
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'SUCCEEDED',
        ...success,
        completeExecutions: duplicate,
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
  });
  it('L08 allows PROCESSING to FAILED only with an exact safe failure shape', () => {
    expected('PROCESSING', 'FAILED');
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'FAILED',
        failureShapeSafe: true,
        failureCode: 'arbitrary',
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'FAILED',
        failureShapeSafe: true,
        failureCode: '',
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
  });
  it('L09 terminally rejects SUCCEEDED to PENDING', () => expected('SUCCEEDED', 'PENDING'));
  it('L10 terminally rejects SUCCEEDED to PROCESSING', () => expected('SUCCEEDED', 'PROCESSING'));
  it('L11 terminally rejects SUCCEEDED to SUCCEEDED', () => expected('SUCCEEDED', 'SUCCEEDED'));
  it('L12 terminally rejects SUCCEEDED to FAILED', () => expected('SUCCEEDED', 'FAILED'));
  it('L13 terminally rejects FAILED to PENDING and requires a new run', () =>
    expected('FAILED', 'PENDING'));
  it('L14 terminally rejects FAILED to PROCESSING', () => expected('FAILED', 'PROCESSING'));
  it('L15 terminally rejects FAILED to SUCCEEDED', () => expected('FAILED', 'SUCCEEDED'));
  it('L16 terminally rejects FAILED to FAILED', () => expected('FAILED', 'FAILED'));
});
