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
  it('PENDING to PENDING is rejected', () => expected('PENDING', 'PENDING'));
  it('PENDING to PROCESSING is claimed', () => expected('PENDING', 'PROCESSING'));
  it('PENDING to SUCCEEDED is rejected', () => expected('PENDING', 'SUCCEEDED'));
  it('PENDING to FAILED is rejected', () => expected('PENDING', 'FAILED'));
  it('PROCESSING to PENDING requires explicit stale attempt', () => {
    expected('PROCESSING', 'PENDING');
    expect(
      decideValidationRunTransition({ from: 'PROCESSING', to: 'PENDING', stale: true }),
    ).toMatchObject({ allowed: false, reason: 'LEASE_NOT_STALE' });
  });
  it('PROCESSING to PROCESSING is rejected', () => expected('PROCESSING', 'PROCESSING'));
  it('D20 completion rejects absent duplicate reordered unknown and wrong-version execution sets', () => {
    expected('PROCESSING', 'SUCCEEDED');
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
    expect(
      decideValidationRunTransition({
        from: 'PROCESSING',
        to: 'SUCCEEDED',
        ...success,
        completeRuleIds: validationRules,
      }),
    ).toMatchObject({ allowed: false, reason: 'SUCCESS_SHAPE_INVALID' });
  });
  it('PROCESSING to FAILED requires safe failure shape', () => {
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
  it('SUCCEEDED to PENDING is terminally rejected', () => expected('SUCCEEDED', 'PENDING'));
  it('SUCCEEDED to PROCESSING is terminally rejected', () => expected('SUCCEEDED', 'PROCESSING'));
  it('SUCCEEDED to SUCCEEDED is terminally rejected', () => expected('SUCCEEDED', 'SUCCEEDED'));
  it('SUCCEEDED to FAILED is terminally rejected', () => expected('SUCCEEDED', 'FAILED'));
  it('FAILED to PENDING is terminally rejected', () => expected('FAILED', 'PENDING'));
  it('FAILED to PROCESSING is terminally rejected', () => expected('FAILED', 'PROCESSING'));
  it('FAILED to SUCCEEDED is terminally rejected', () => expected('FAILED', 'SUCCEEDED'));
  it('FAILED to FAILED is terminally rejected', () => expected('FAILED', 'FAILED'));
});
