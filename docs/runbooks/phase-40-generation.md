# Phase 40 generation runbook

Phase 40 is a provider-neutral, deterministic generation engine. Local evaluation uses the injected Hebrew fake gateway only; no provider SDK, network model, credentials, or paid service is configured.

The workflow is: create a strict draft or single-question regeneration request, allow the worker to claim the ID-only `generation.requested` outbox event, inspect the bounded context and status, and inspect the finalized revision and QuestionSourceLink provenance after success. Duplicate idempotency delivery is safe and terminal runs are no-ops.

Trusted configuration bounds context items, characters, estimated tokens, output tokens, cost micros, timeout, and attempts. Timeout, rate-limit, and transient provider failures retry within the configured maximum. Invalid output, schema errors, permanent errors, context invalidation, and budget overruns fail safely using enumerated reason codes. Logs, audits, outbox payloads, errors, and telemetry contain IDs, hashes, counts, and safe classes only; source and generated text are never logged or copied into evidence.

Live evaluation is fail-closed. It requires explicit owner approval and a separately supplied adapter; the default preflight must print `LIVE_EVALUATION=DISABLED_BY_DEFAULT`. No production provider is selected.

The deterministic Hebrew fixture covers worksheet and test-shaped plans plus isolated question regeneration. It verifies schema shape, exact planned keys/order, citations to selected eligible KnowledgeItems, zero ineligible context, and no unrelated-question changes. It does not claim pedagogical or live-provider quality.

Public operations are `requestDraftGeneration`, `requestQuestionRegeneration`, `getGenerationStatus`, and `getGenerationResult`; internal operations are `selectGenerationContext` and `processGenerationRun`. Every operation reloads persisted tenant authorization, uses strict schemas, is non-disclosing for inaccessible objects, and records only safe ID/version/hash/count metadata.
