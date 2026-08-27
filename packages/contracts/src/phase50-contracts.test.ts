import { describe, expect, it } from 'vitest';
import {
  semanticCategorySchema,
  validationAcknowledgementSchema,
  validationFindingSchema,
  validationReadinessSchema,
  validationRequestSchema,
  validationResultSchema,
  validationStatusSchema,
  validationRuleIdSchema,
} from './phase50.js';
const id = '00000000-0000-4000-8000-000000000001';
const execs = () =>
  validationRuleIdSchema.options.map((ruleId, i) => ({
    ruleId,
    ruleVersion: 'v1',
    outcome: 'PASS' as const,
    evidence: { identity: `e${i}`, revisionId: id },
  }));
const stat = () => ({
  version: '1.0.0' as const,
  id,
  assessmentId: id,
  assessmentRevisionId: id,
  revisionSequence: 1,
  rulesetVersion: 'v1',
  evaluatorVersion: 'v1',
  state: 'SUCCEEDED' as const,
  attempts: 1,
  deterministicPassCount: 11,
  deterministicFailCount: 0,
  semanticFindingCount: 0,
  completedAt: '2026-01-01T00:00:00.000Z',
  failureCode: null,
});
const res = () => ({
  version: '1.0.0' as const,
  status: stat(),
  executions: execs(),
  findings: [],
  semanticEvaluation: {
    state: 'SUCCEEDED' as const,
    evaluatorVersion: 'v1',
    promptVersion: 'v1',
    modelConfigurationVersion: 'v1',
    schemaVersion: 'v1',
    failureCode: null,
    latencyMs: 1,
    findingCount: 0,
  },
});
describe('Phase 50 contracts', () => {
  it('all seven public schemas reject unknown keys', () => {
    expect(
      validationRequestSchema.safeParse({
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: id,
        idempotencyKey: 'k',
        x: 1,
      }).success,
    ).toBe(false);
    expect(validationStatusSchema.safeParse({ ...stat(), x: 1 }).success).toBe(false);
    expect(validationResultSchema.safeParse({ ...res(), x: 1 }).success).toBe(false);
    const deterministic = {
      id,
      kind: 'DETERMINISTIC' as const,
      code: 'C',
      category: 'REVISION' as const,
      severity: 'BLOCKING' as const,
      path: 'p',
      messageKey: 'm',
      evidence: { identity: 'd', revisionId: id },
      confidenceBasisPoints: null,
      ruleVersion: 'v1',
      evaluatorVersion: null,
      schemaVersion: null,
    };
    const semantic = {
      id,
      kind: 'SEMANTIC' as const,
      code: 'S',
      category: 'AMBIGUITY' as const,
      severity: 'WARNING' as const,
      path: 'p',
      messageKey: 'm',
      evidence: { identity: 's', revisionId: id },
      confidenceBasisPoints: null,
      ruleVersion: null,
      evaluatorVersion: 'v1',
      schemaVersion: 'v1',
    };
    expect(validationFindingSchema.safeParse(deterministic).success).toBe(true);
    expect(validationFindingSchema.safeParse({ ...deterministic, x: 1 }).success).toBe(false);
    expect(validationFindingSchema.safeParse(semantic).success).toBe(true);
    expect(validationFindingSchema.safeParse({ ...semantic, x: 1 }).success).toBe(false);
    expect(
      validationReadinessSchema.safeParse({
        version: '1.0.0',
        status: 'READY',
        reasonCode: null,
        validationRunId: id,
        x: 1,
      }).success,
    ).toBe(false);
    expect(
      validationAcknowledgementSchema.safeParse({
        version: '1.0.0',
        findingId: id,
        reason: 'x',
        idempotencyKey: 'k',
        x: 1,
      }).success,
    ).toBe(false);
    expect(semanticCategorySchema.safeParse('x').success).toBe(false);
  });
  it('accepts exactly the nine readiness reasons and rejects legacy or unknown reasons', () => {
    for (const r of [
      'VALIDATION_REQUIRED',
      'VALIDATION_PENDING',
      'VALIDATION_PROCESSING',
      'VALIDATION_FAILED',
      'DETERMINISTIC_BLOCKER',
      'SEMANTIC_BLOCKER',
      'WARNING_ACKNOWLEDGEMENT_REQUIRED',
      'VALIDATION_VERSION_STALE',
      'SOURCE_ELIGIBILITY_CHANGED',
    ])
      expect(
        validationReadinessSchema.safeParse({
          version: '1.0.0',
          status: 'BLOCKED',
          reasonCode: r,
          validationRunId: null,
        }).success,
      ).toBe(true);
    expect(
      validationReadinessSchema.safeParse({
        version: '1.0.0',
        status: 'BLOCKED',
        reasonCode: 'VALIDATION_FINDINGS_UNRESOLVED',
        validationRunId: null,
      }).success,
    ).toBe(false);
  });
  it('enforces READY and BLOCKED state-dependent readiness shapes', () => {
    expect(
      validationReadinessSchema.safeParse({
        version: '1.0.0',
        status: 'READY',
        reasonCode: null,
        validationRunId: id,
      }).success,
    ).toBe(true);
    expect(
      validationReadinessSchema.safeParse({
        version: '1.0.0',
        status: 'READY',
        reasonCode: null,
        validationRunId: null,
      }).success,
    ).toBe(false);
    expect(
      validationReadinessSchema.safeParse({
        version: '1.0.0',
        status: 'BLOCKED',
        reasonCode: null,
        validationRunId: null,
      }).success,
    ).toBe(false);
  });
  it('enforces all four status-state terminal and failure shapes', () => {
    for (const state of ['PENDING', 'PROCESSING'] as const)
      expect(
        validationStatusSchema.safeParse({ ...stat(), state, completedAt: null, failureCode: null })
          .success,
      ).toBe(true);
    expect(validationStatusSchema.safeParse(stat()).success).toBe(true);
    expect(
      validationStatusSchema.safeParse({ ...stat(), state: 'FAILED', failureCode: 'TIMEOUT' })
        .success,
    ).toBe(true);
    expect(validationStatusSchema.safeParse({ ...stat(), failureCode: 'TIMEOUT' }).success).toBe(
      false,
    );
    for (const state of ['PENDING', 'PROCESSING'] as const) {
      expect(
        validationStatusSchema.safeParse({
          ...stat(),
          state,
          completedAt: '2026-01-01T00:00:00.000Z',
          failureCode: null,
        }).success,
      ).toBe(false);
      expect(
        validationStatusSchema.safeParse({
          ...stat(),
          state,
          completedAt: null,
          failureCode: 'TIMEOUT',
        }).success,
      ).toBe(false);
    }
    expect(validationStatusSchema.safeParse({ ...stat(), completedAt: null }).success).toBe(false);
    expect(
      validationStatusSchema.safeParse({
        ...stat(),
        state: 'FAILED',
        completedAt: null,
        failureCode: 'TIMEOUT',
      }).success,
    ).toBe(false);
    expect(
      validationStatusSchema.safeParse({ ...stat(), state: 'FAILED', failureCode: null }).success,
    ).toBe(false);
    expect(
      validationStatusSchema.safeParse({ ...stat(), state: 'FAILED', failureCode: 'UNKNOWN' })
        .success,
    ).toBe(false);
  });
  it('enforces deterministic and semantic finding kind/category/severity/version compatibility', () => {
    const d = {
      id,
      kind: 'DETERMINISTIC' as const,
      code: 'C',
      category: 'REVISION' as const,
      severity: 'BLOCKING' as const,
      path: 'p',
      messageKey: 'm',
      evidence: { identity: 'x', revisionId: id },
      confidenceBasisPoints: null,
      ruleVersion: 'v1',
      evaluatorVersion: null,
      schemaVersion: null,
    };
    expect(validationFindingSchema.safeParse(d).success).toBe(true);
    expect(validationFindingSchema.safeParse({ ...d, severity: 'WARNING' }).success).toBe(false);
    expect(validationFindingSchema.safeParse({ ...d, category: 'AMBIGUITY' }).success).toBe(false);
    const semantic = (severity: 'BLOCKING' | 'WARNING' | 'INFO') => ({
      id,
      kind: 'SEMANTIC' as const,
      code: 'S',
      category: 'AMBIGUITY' as const,
      severity,
      path: 'p',
      messageKey: 'm',
      evidence: { identity: 's', revisionId: id },
      confidenceBasisPoints: 5000,
      ruleVersion: null,
      evaluatorVersion: 'v1',
      schemaVersion: 'v1',
    });
    expect(validationFindingSchema.safeParse(semantic('BLOCKING')).success).toBe(true);
    expect(validationFindingSchema.safeParse(semantic('WARNING')).success).toBe(true);
    expect(validationFindingSchema.safeParse(semantic('INFO')).success).toBe(true);
    expect(
      validationFindingSchema.safeParse({ ...semantic('WARNING'), category: 'REVISION' }).success,
    ).toBe(false);
    expect(
      validationFindingSchema.safeParse({ ...d, evaluatorVersion: 'v1', schemaVersion: 'v1' })
        .success,
    ).toBe(false);
    expect(
      validationFindingSchema.safeParse({ ...semantic('WARNING'), ruleVersion: 'v1' }).success,
    ).toBe(false);
    expect(
      validationFindingSchema.safeParse({ ...semantic('WARNING'), evaluatorVersion: null }).success,
    ).toBe(false);
    expect(
      validationFindingSchema.safeParse({ ...semantic('WARNING'), schemaVersion: null }).success,
    ).toBe(false);
    expect(
      validationFindingSchema.safeParse({ ...semantic('WARNING'), confidenceBasisPoints: -1 })
        .success,
    ).toBe(false);
    expect(
      validationFindingSchema.safeParse({ ...semantic('WARNING'), confidenceBasisPoints: 10001 })
        .success,
    ).toBe(false);
  });
  it('enforces exact eleven-execution completed result identities and aggregate counts', () => {
    expect(validationResultSchema.safeParse(res()).success).toBe(true);
    expect(
      validationResultSchema.safeParse({
        ...res(),
        executions: [...execs().slice(0, 10), { ...execs()[10]!, ruleId: 'UNKNOWN_RULE' }],
      }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({
        ...res(),
        executions: [...execs().slice(0, 10), execs()[0]!],
      }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({ ...res(), executions: [...execs()].reverse() }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({ ...res(), executions: execs().slice(1) }).success,
    ).toBe(false);
    const semanticFinding = {
      id,
      kind: 'SEMANTIC' as const,
      code: 'S',
      category: 'AMBIGUITY' as const,
      severity: 'WARNING' as const,
      path: 'p',
      messageKey: 'm',
      evidence: { identity: 's', revisionId: id },
      confidenceBasisPoints: null,
      ruleVersion: null,
      evaluatorVersion: 'v1',
      schemaVersion: 'v1',
    };
    const semanticResult = {
      ...res(),
      status: { ...stat(), semanticFindingCount: 1 },
      findings: [semanticFinding],
      semanticEvaluation: { ...res().semanticEvaluation, findingCount: 1 },
    };
    expect(validationResultSchema.safeParse(semanticResult).success).toBe(true);
    expect(
      validationResultSchema.safeParse({
        ...semanticResult,
        status: { ...semanticResult.status, semanticFindingCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({
        ...semanticResult,
        semanticEvaluation: { ...semanticResult.semanticEvaluation, findingCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({
        ...res(),
        executions: [...execs().slice(0, 10), execs()[0]!],
      }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({
        ...res(),
        status: { ...stat(), deterministicPassCount: 10 },
      }).success,
    ).toBe(false);
    expect(
      validationResultSchema.safeParse({
        ...res(),
        semanticEvaluation: {
          ...res().semanticEvaluation,
          state: 'FAILED',
          failureCode: 'TIMEOUT',
        },
      }).success,
    ).toBe(false);
  });
  it('rejects forged server-owned fields on request and acknowledgement', () => {
    expect(
      validationRequestSchema.safeParse({
        version: '1.0.0',
        assessmentId: id,
        assessmentRevisionId: id,
        idempotencyKey: 'k',
        organizationId: id,
      }).success,
    ).toBe(false);
    expect(
      validationAcknowledgementSchema.safeParse({
        version: '1.0.0',
        findingId: id,
        reason: 'r',
        idempotencyKey: 'k',
        severity: 'WARNING',
      }).success,
    ).toBe(false);
  });
  it('accepts exactly seven semantic categories and rejects unknown categories', () => {
    for (const c of [
      'HEBREW_CORRECTNESS',
      'AMBIGUITY',
      'ANSWER_VALIDITY',
      'DIFFICULTY_FIT',
      'CURRICULUM_FIT',
      'DUPLICATION',
      'ANSWER_LEAKAGE',
    ])
      expect(semanticCategorySchema.safeParse(c).success).toBe(true);
    expect(semanticCategorySchema.safeParse('OTHER').success).toBe(false);
  });
});
