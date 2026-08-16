# Technical Debt Register

Last updated: 2026-08-16

Phase 10 implementation has begun. Items below were recorded in the Phase 10 review.

## Classification

- **Critical**: must be fixed before progressing.
- **Important**: schedule soon with an owner/target phase.
- **Acceptable**: intentionally deferred with rationale and revisit trigger.

| ID     | Severity   | Item                                                                                                    | Introduced | Owner/target                             | Rationale / exit criterion                                                       | Status |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| TD-001 | Critical   | PostgreSQL migrations and six DB-backed integration tests were not executed                             | Phase 10   | Phase 10 remediation                     | Apply on a clean PostgreSQL database and run all integration tests without skips | Open   |
| TD-002 | Critical   | Personal workspace is documented as exactly one active member, but DB enforcement permits zero          | Phase 10   | Phase 10 remediation                     | Align policy, DB/application enforcement, and tests for 0/1/>1                   | Open   |
| TD-003 | Critical   | Workspace mutation reuses broad read policy; a teacher can rename a school workspace                    | Phase 10   | Phase 10 remediation                     | Add operation-specific authorization and PERSONAL/SCHOOL role tests              | Open   |
| TD-004 | Critical   | External workspace/error/organization/membership contracts lack JSON Schema snapshots and drift checks  | Phase 10   | Phase 10 remediation                     | Generate committed schemas and verify drift in CI                                | Open   |
| TD-005 | Important  | CI has not executed and its “new schema” migration step only reruns on the same database                | Phase 10   | Phase 10 remediation                     | Correct the check and provide clean CI-equivalent evidence                       | Open   |
| TD-006 | Important  | Outbox has no demonstrated handler-failure retry or stale PROCESSING recovery policy                    | Phase 10   | Before real jobs in Phase 30/40          | Add injectable failure test and minimal crash-recovery rule                      | Open   |
| TD-007 | Acceptable | Managed OIDC adapter, immutable-SHA secret scanner, and multi-worker leasing are intentionally deferred | Phase 10   | Before production / measured concurrency | Revisit on vendor security decision and worker scaling trigger                   | Open   |
