import { describe, expect, it } from 'vitest';
import {
  acknowledgeSemanticWarning,
  assertRevisionApprovable,
  getRevisionValidationReadiness,
  getValidationResult,
  getValidationStatus,
  processValidationRun,
  requestRevisionValidation,
} from '../packages/db/src/index.js';

describe('Phase 50 public operation surface', () => {
  it('exports every public and internal validation operation required by the control pack', () => {
    expect({
      requestRevisionValidation,
      getValidationStatus,
      getValidationResult,
      acknowledgeSemanticWarning,
      getRevisionValidationReadiness,
      assertRevisionApprovable,
      processValidationRun,
    }).toEqual({
      requestRevisionValidation: expect.any(Function),
      getValidationStatus: expect.any(Function),
      getValidationResult: expect.any(Function),
      acknowledgeSemanticWarning: expect.any(Function),
      getRevisionValidationReadiness: expect.any(Function),
      assertRevisionApprovable: expect.any(Function),
      processValidationRun: expect.any(Function),
    });
  });
});
