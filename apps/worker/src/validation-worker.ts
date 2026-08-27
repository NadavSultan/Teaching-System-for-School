/** Phase 50 worker entry point; the shared outbox worker invokes this by ID only. */
import { processValidationRun } from '@teach/db';

export async function processValidationOutboxEvent(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('validationRunId' in payload))
    throw new Error('ValidationOutboxPayloadInvalid');
  return processValidationRun(String(payload.validationRunId));
}
