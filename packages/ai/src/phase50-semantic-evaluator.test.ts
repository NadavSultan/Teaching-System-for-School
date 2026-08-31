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
  it('S01 accepts strict clean registered output from the deterministic local fake', async () => {
    expect(parseSemanticEvaluatorOutput(clean, revisionId)).toEqual(clean);
    await expect(
      new DeterministicFakeSemanticEvaluator(clean).evaluate({
        revisionId,
        operationId: 'o',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(clean);
  });
  const oneFinding = (category: string, severity: string) =>
    parseSemanticEvaluatorOutput(
      {
        ...clean,
        findings: [
          {
            category,
            severity,
            code: `${category}_V1`,
            path: 'question.q1',
            messageKey: `semantic.${category.toLowerCase()}`,
            evidence: { identity: `${category}_V1`, revisionId },
          },
        ],
      },
      revisionId,
    ).findings[0]!;
  it('S02 retains the registered Hebrew-correctness WARNING exactly', () => {
    expect(oneFinding('HEBREW_CORRECTNESS', 'WARNING')).toMatchObject({
      category: 'HEBREW_CORRECTNESS',
      code: 'HEBREW_CORRECTNESS_V1',
      severity: 'WARNING',
    });
  });
  it('S03 retains the registered ambiguity WARNING exactly', () => {
    expect(oneFinding('AMBIGUITY', 'WARNING')).toMatchObject({
      category: 'AMBIGUITY',
      code: 'AMBIGUITY_V1',
      severity: 'WARNING',
    });
  });
  it('S04 retains the registered answer-validity BLOCKING finding exactly', () => {
    expect(oneFinding('ANSWER_VALIDITY', 'BLOCKING')).toMatchObject({
      category: 'ANSWER_VALIDITY',
      code: 'ANSWER_VALIDITY_V1',
      severity: 'BLOCKING',
    });
  });
  it('S05 retains the registered difficulty-fit WARNING exactly', () => {
    expect(oneFinding('DIFFICULTY_FIT', 'WARNING')).toMatchObject({
      category: 'DIFFICULTY_FIT',
      code: 'DIFFICULTY_FIT_V1',
      severity: 'WARNING',
    });
  });
  it('S06 retains the registered curriculum-fit BLOCKING finding exactly', () => {
    expect(oneFinding('CURRICULUM_FIT', 'BLOCKING')).toMatchObject({
      category: 'CURRICULUM_FIT',
      code: 'CURRICULUM_FIT_V1',
      severity: 'BLOCKING',
    });
  });
  it('S07 retains the registered duplication WARNING exactly', () => {
    expect(oneFinding('DUPLICATION', 'WARNING')).toMatchObject({
      category: 'DUPLICATION',
      code: 'DUPLICATION_V1',
      severity: 'WARNING',
    });
  });
  it('S08 retains the registered answer-leakage BLOCKING finding exactly', () => {
    expect(oneFinding('ANSWER_LEAKAGE', 'BLOCKING')).toMatchObject({
      category: 'ANSWER_LEAKAGE',
      code: 'ANSWER_LEAKAGE_V1',
      severity: 'BLOCKING',
    });
  });
  it('S09 rejects malformed or partial output with exact OUTPUT_INVALID failure', () => {
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, findings: [{ bad: true }] }, revisionId),
    ).toThrowError(expect.objectContaining({ code: 'OUTPUT_INVALID' }));
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
              evidence: { identity: 'AMBIGUITY_V1', revisionId },
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
  it('S10 exhausts typed timeout and transient retries with exact safe codes', async () => {
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
  });
  it('S11 maps a permanent evaluator error without retrying or producing a pass', async () => {
    const permanent = new DeterministicFakeSemanticEvaluator(undefined, async () => {
      throw new SemanticEvaluatorFailure('PERMANENT_EVALUATOR_ERROR');
    });
    await expect(
      evaluateSemanticWithRetry(permanent, { revisionId, operationId: 'permanent' }, 3, 5),
    ).rejects.toMatchObject({ code: 'PERMANENT_EVALUATOR_ERROR' });
    expect(permanent.attempts).toEqual([1]);
  });
  it('S12 rejects unknown category, wrong code, and wrong revision identity', () => {
    const finding = {
      category: 'AMBIGUITY',
      severity: 'WARNING',
      code: 'AMBIGUITY_V1',
      path: 'q',
      messageKey: 'm',
      evidence: { identity: 'AMBIGUITY_V1', revisionId },
    } as const;
    for (const candidate of [
      { ...clean, revisionId: crypto.randomUUID() },
      { ...clean, findings: [{ ...finding, category: 'UNKNOWN' }] },
      { ...clean, findings: [{ ...finding, code: 'OTHER' }] },
      {
        ...clean,
        findings: [
          { ...finding, evidence: { ...finding.evidence, revisionId: crypto.randomUUID() } },
        ],
      },
    ])
      expect(() => parseSemanticEvaluatorOutput(candidate, revisionId)).toThrowError(
        expect.objectContaining({ code: 'OUTPUT_INVALID' }),
      );
  });
  it('rejects duplicate finding identity, wrong registered code, bounds and preserves replay', async () => {
    const finding = {
      category: 'AMBIGUITY',
      severity: 'WARNING',
      code: 'AMBIGUITY_V1',
      path: 'q',
      messageKey: 'm',
      evidence: { identity: 'AMBIGUITY_V1', revisionId },
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
        {
          ...clean,
          findings: [
            {
              ...finding,
              evidence: { identity: 'AMBIGUITY_V1', revisionId: 'other' },
            },
          ],
        },
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
  it('rejects every malformed evaluator identity boundary independently', () => {
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, evaluatorVersion: 'wrong' }, revisionId),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, promptVersion: 'wrong' }, revisionId),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, modelConfigurationVersion: 'wrong' }, revisionId),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() =>
      parseSemanticEvaluatorOutput({ ...clean, schemaVersion: 'wrong' }, revisionId),
    ).toThrow(SemanticEvaluatorFailure);
    expect(() => parseSemanticEvaluatorOutput({ ...clean, extra: true }, revisionId)).toThrow(
      SemanticEvaluatorFailure,
    );
  });
});
