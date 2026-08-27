# Phase 50 validation operations

Validation is requested only for a finalized assessment revision by an active tenant member. The request records an ID-only outbox event; a worker claims that event and stores deterministic rule executions and semantic evidence before one terminal result.

Do not activate a live evaluator. The supported evaluator is the deterministic fake and `liveSemanticEvaluatorPreflight` must remain disabled.

Operational checks:

- Run `pnpm verify:phase50` for protected artifacts, frozen migrations, manifest identity, and migration count.
- Run `pnpm test-integration:phase50-upgrade` before a release candidate.
- Treat a failed run, stale registry version, unresolved blocking finding, or unacknowledged semantic warning as not ready.
- Acknowledge only a semantic `WARNING`; an acknowledgement never changes deterministic evidence or overrides a blocking finding.
- Never log assessment content, source content, evaluator raw output, credentials, cookies, or authorization headers.

Recovery is forward-only: stale processing leases may return to pending within the worker attempt limit. Terminal runs are immutable and a newer monotonic revision sequence always controls readiness.
