import { describe, expect, it } from 'vitest';
import {
  DeterministicFakeSemanticEvaluator,
  SemanticEvaluatorFailure,
  TransientSemanticEvaluatorError,
  evaluateSemanticWithRetry,
  liveSemanticEvaluatorPreflight,
  parseSemanticEvaluatorOutput,
  resolveLiveSemanticEvaluator,
} from './semantic-evaluator.js';
const revisionId = '00000000-0000-4000-8000-000000000001';
const clean = {
  version: '1.0.0',
  evaluatorVersion: 'local-disabled-v1',
  promptVersion: 'validation-prompt-v1',
  modelConfigurationVersion: 'local-none-v1',
  schemaVersion: '1.0.0',
  revisionId,
  findings: [],
};
describe('Phase 50 semantic evaluator', () => {
  it('accepts a strict clean result and deterministic fake output', async () => {
    expect(parseSemanticEvaluatorOutput(clean, revisionId)).toEqual(clean);
    await expect(
      new DeterministicFakeSemanticEvaluator(clean).evaluate({
        revisionId,
        operationId: 'o',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(clean);
  });
  it('accepts all allowed category and severity combinations', () => {
    const rows = [
      ['HEBREW_CORRECTNESS', 'WARNING'],
      ['AMBIGUITY', 'WARNING'],
      ['ANSWER_VALIDITY', 'BLOCKING'],
      ['DIFFICULTY_FIT', 'WARNING'],
      ['CURRICULUM_FIT', 'BLOCKING'],
      ['DUPLICATION', 'WARNING'],
      ['ANSWER_LEAKAGE', 'BLOCKING'],
    ] as const;
    for (const [category, severity] of rows)
      expect(
        parseSemanticEvaluatorOutput(
          {
            ...clean,
            findings: [
              {
                category,
                severity,
                code: `${category}_V1`,
                path: 'q',
                messageKey: 'k',
                evidence: { revisionId },
              },
            ],
          },
          revisionId,
        ).findings,
      ).toHaveLength(1);
  });
  it('exhausts transient failures and surfaces permanent failure', async () => {
    const transient = {
      evaluate: async () => {
        throw new SemanticEvaluatorFailure('TIMEOUT');
      },
    };
    await expect(
      evaluateSemanticWithRetry(transient, { revisionId, operationId: 'o' }, 2),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    const permanent = {
      evaluate: async () => {
        throw new SemanticEvaluatorFailure('PERMANENT_EVALUATOR_ERROR');
      },
    };
    await expect(
      evaluateSemanticWithRetry(permanent, { revisionId, operationId: 'o' }),
    ).rejects.toMatchObject({ code: 'PERMANENT_EVALUATOR_ERROR' });
  });
  it('retains only bounded known-category evidence and rejects invalid identities', () => {
    expect(
      parseSemanticEvaluatorOutput(
        {
          ...clean,
          findings: [
            {
              category: 'AMBIGUITY',
              severity: 'WARNING',
              code: 'AMBIGUITY_V1',
              path: 'q',
              messageKey: 'ambiguity',
              evidence: { revisionId },
            },
          ],
        },
        revisionId,
      ).findings,
    ).toHaveLength(1);
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, revisionId: 'wrong', findings: [] }, revisionId),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput(
        {
          ...clean,
          findings: [
            { category: 'UNKNOWN', severity: 'WARNING', code: 'A', path: 'q', messageKey: 'x' },
          ],
        },
        revisionId,
      ),
    ).toThrow(SemanticEvaluatorFailure);
  });
  it('keeps live evaluation disabled', async () => {
    expect(liveSemanticEvaluatorPreflight()).toEqual({
      enabled: false,
      reason: 'LIVE_EVALUATOR_REQUIRES_OWNER_APPROVAL',
    });
    expect(resolveLiveSemanticEvaluator()).toBeNull();
    let signal: AbortSignal | undefined;
    const evaluator = new DeterministicFakeSemanticEvaluator(undefined, async (input) => {
      signal = input.signal;
      await new Promise(() => undefined);
    });
    await expect(
      evaluateSemanticWithRetry(evaluator, { revisionId, operationId: 'abort' }, 1, 5),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(signal?.aborted).toBe(true);
  });
  it('retries only typed timeout/transient failures and maps exhaustion deterministically', async () => {
    const timeout = new DeterministicFakeSemanticEvaluator(undefined, async () => {
      await new Promise(() => undefined);
    });
    await expect(
      evaluateSemanticWithRetry(timeout, { revisionId, operationId: 'timeout' }, 2, 5),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(timeout.attempts).toEqual([1, 2]);
    const transient = new DeterministicFakeSemanticEvaluator(undefined, async (_input, attempt) => {
      if (attempt === 1) throw new TransientSemanticEvaluatorError();
      return clean;
    });
    await expect(
      evaluateSemanticWithRetry(transient, { revisionId, operationId: 'transient' }, 2, 5),
    ).resolves.toEqual(clean);
    expect(transient.attempts).toEqual([1, 2]);
    const exhausted = new DeterministicFakeSemanticEvaluator(undefined, async () => {
      throw new TransientSemanticEvaluatorError();
    });
    await expect(
      evaluateSemanticWithRetry(exhausted, { revisionId, operationId: 'exhausted' }, 2, 5),
    ).rejects.toMatchObject({ code: 'TRANSIENT_EXHAUSTED' });
    expect(exhausted.attempts).toEqual([1, 2]);
    const unknown = new DeterministicFakeSemanticEvaluator(undefined, async () => {
      throw { hidden: 'content' };
    });
    await expect(
      evaluateSemanticWithRetry(unknown, { revisionId, operationId: 'unknown' }, 2, 5),
    ).rejects.toMatchObject({ code: 'PERMANENT_EVALUATOR_ERROR' });
    expect(unknown.attempts).toEqual([1]);
  });
  it('rejects duplicate finding identity, wrong registered code, bounds and preserves replay', async () => {
    const finding = {
      category: 'AMBIGUITY',
      severity: 'WARNING',
      code: 'AMBIGUITY_V1',
      path: 'q',
      messageKey: 'm',
      evidence: { revisionId },
    } as const;
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, findings: [finding, finding] }, revisionId),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput(
        { ...clean, findings: [{ ...finding, code: 'OTHER' }] },
        revisionId,
      ),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput(
        { ...clean, findings: [{ ...finding, messageKey: 'x'.repeat(161) }] },
        revisionId,
      ),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput(
        { ...clean, findings: [{ ...finding, evidence: { revisionId: 'other' } }] },
        revisionId,
      ),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput(
        { ...clean, findings: [{ ...finding, evidence: { payload: 'x'.repeat(1_000_001) } }] },
        revisionId,
      ),
    ).toThrow(SemanticEvaluatorFailure);
    const first = parseSemanticEvaluatorOutput(clean, revisionId);
    const second = parseSemanticEvaluatorOutput(clean, revisionId);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });
  it.each([
    ['wrong evaluator', { ...clean, evaluatorVersion: 'wrong' }],
    ['wrong prompt', { ...clean, promptVersion: 'wrong' }],
    ['wrong model', { ...clean, modelConfigurationVersion: 'wrong' }],
    ['wrong schema', { ...clean, schemaVersion: 'wrong' }],
    ['unknown key', { ...clean, extra: true }],
  ])('rejects %s identity boundary', (_name, candidate) => {
    expect(() => parseSemanticEvaluatorOutput(candidate, revisionId)).toThrow(
      SemanticEvaluatorFailure,
    );
  });
});
