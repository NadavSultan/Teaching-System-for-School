# Phase 30 Master Implementation Prompt — Source Registry and Controlled Knowledge

Use English only in the implementation task.

## Assignment

Implement and verify Phase 30 — Source Registry and Controlled Knowledge — in the Git-connected repository:

`C:\Users\Nadav\Desktop\Nadav\Teaching-System-for-School-phase-20-git`

Required branch:

`codex/phase-30-source-registry`

You are the Phase 30 implementation executor. Implement the approved scope completely, but do not issue the architectural verdict. The permanent master/review session owns phase approval.

## Approved baseline

- Phase 20 implementation: `ec02ddb49029d5de2a474615abc9376f0d7e008c`
- Phase 20 implementation report: `e438ba0b6e45a0a0ea4079a09813b7e5a4e033bd`
- Independent Phase 20 approval incorporated at: `603ac866b6d7d4fff6ef679ce1a671718a32c05d`
- Phase 30 preparation and this prompt are part of the branch baseline supplied by the master session.

Verify the branch and baseline before changing code. Do not use the old ZIP-derived folder.

## Read before implementation

Read completely:

- any applicable `AGENTS.md`;
- `docs/architecture/system-architecture-v1.md`;
- `docs/architecture/project-state.md`;
- `docs/architecture/decision-log.md`;
- `docs/architecture/technical-debt-register.md`;
- `docs/architecture/risk-register.md`;
- `docs/phases/20-phase-re-review-4.md`;
- `docs/phases/20-implementation-report.md`;
- `docs/phases/30-phase-preparation.md`;
- this prompt;
- `docs/runbooks/authentication.md` and `docs/runbooks/database.md`;
- the current contracts, Prisma schema/migrations, domain authorization policy, database services, worker/outbox implementation, architecture tests, schema generator, and CI workflow.

Inspect the implementation before deciding file placement. Continue the approved modular-monolith boundaries; do not create microservices or duplicate trusted context/policy logic.

## Protected contracts and stop conditions

Do not weaken or redesign:

- Phase 20 CurriculumVersion/CurriculumNode identity, exact-version references, publication lifecycle, and immutability;
- Assessment contracts, score units, revision lifecycle, and finalized graph immutability;
- `resolveAccessContext`, explicit authorization operations, non-disclosing errors, and bidirectional tenant isolation;
- Phase 10 identity, workspace, outbox, audit, health, and error contracts;
- generated-schema byte-drift and migration-history drift gates.

If implementation would require changing an approved ADR or breaking a protected contract, stop and return the exact decision to the master session. Missing implementation, tests, helper functions, or additive Phase 30 schema are not blockers; implement them.

## Required implementation

### 1. Source and version model

Add a logical KnowledgeSource and immutable SourceVersion model with UUID identities, lifecycle timestamps, server-computed content hash, source metadata, content/storage reference, version number, and provenance fields.

Requirements:

- a changed content hash creates a new SourceVersion;
- no mutation of hash/content identity after creation;
- no automatic inheritance of review, permission, active eligibility, or ingestion success;
- duplicate registration is idempotent only when the exact source, hash, and request fingerprint agree;
- conflicting reuse of an idempotency key is rejected;
- destructive deletes of reviewed/ingested versions are prohibited;
- exact version history remains queryable.

### 2. Independent review, permission, and lifecycle evidence

Model pedagogical review, usage permission, and operational lifecycle independently.

- Pedagogical review must record exact SourceVersion, decision, reviewer, reason/evidence metadata, and timestamp.
- Usage permission must record exact SourceVersion, AI-generation permission, evidence/reference, scope, and relevant validity metadata.
- Operational lifecycle must support controlled activation, suspension, deprecation, failure, and needs-re-review behavior with recorded reasons.
- New decisions supersede through new evidence rows; do not overwrite history silently.
- A single status or client-provided eligibility boolean must not collapse these dimensions.
- AI-generated origin is retrieval-ineligible until exact-version human pedagogical and permitted-use decisions exist.

### 3. Tenant visibility and authorization

Represent platform-shared and organization-private visibility explicitly with database constraints.

- Organization-private records require a non-null organization owner.
- Platform-shared records cannot be silently created from tenant-owned content.
- Define explicit operations for source create/read/version, pedagogical review, usage permission, ingest, suspend/deprecate, knowledge read, and retrieval.
- Resolve user/membership/organization state through persisted `resolveAccessContext` or a single reviewed extension of that boundary.
- Never trust client-provided role, lifecycle, organization status, workspace type, reviewer identity, or platform-admin entitlement.
- PLATFORM_ADMIN has no implicit membership or tenant access.
- Missing and inaccessible resources must be externally indistinguishable.
- Apply bidirectional A-to-B and B-to-A tests for every tenant-owned source/version/item and every read/write operation.

### 4. Exact Curriculum association

Add explicit SourceVersion and/or KnowledgeItem associations to an exact published CurriculumVersion and compatible CurriculumNode IDs.

- Reject draft/deprecated-invalid references according to the approved read policy.
- Reject cross-version node associations.
- Reject free-text curriculum identifiers as trusted links.
- Preserve Phase 20 tables and invariants.
- Retrieval filters must use persisted exact IDs.

### 5. Ingestion run and worker boundary

Implement deterministic ingestion through a durable IngestionRun and the existing outbox/worker architecture.

The pipeline must include:

1. bounded input and storage-reference validation;
2. a narrow parser/content-reader adapter;
3. deterministic normalization;
4. stable page/section/location extraction;
5. metadata and exact Curriculum association validation;
6. immutable KnowledgeItem creation with item/text hashes;
7. quality checks;
8. atomic publication/activation.

Requirements:

- idempotency is keyed by SourceVersion content hash plus pipeline version;
- duplicate outbox delivery produces no duplicate active items;
- retry, lease, stale PROCESSING recovery, and terminal failure behavior use the Phase 10 mechanism;
- raw source text must not enter outbox payloads, error fields, audit metadata, or logs;
- failed/interrupted ingestion leaves no active partial item set;
- an already-published item set cannot be silently replaced in place;
- no arbitrary network URL fetch or paid provider is activated;
- provide deterministic local/test parser fixtures and a provider-neutral storage/content-reader seam.

### 6. Immutable knowledge items and provenance

KnowledgeItem must retain:

- SourceVersion ID;
- stable locator;
- normalized text and server-computed text hash;
- bounded metadata;
- lifecycle/status;
- pipeline/parser version;
- exact CurriculumVersion/Node lineage;
- tenant/platform visibility lineage.

Items are immutable after activation. Suspension/deprecation changes eligibility through controlled lifecycle evidence rather than rewriting provenance or text.

### 7. Deny-by-default eligibility

Implement one framework-light eligibility predicate and matching persisted query semantics:

`pedagogical review approved AND AI usage allowed AND source version active AND knowledge item active AND tenant visibility permits access AND exact published curriculum filters match`

- A missing, stale, expired, denied, suspended, deprecated, or needs-re-review condition is ineligible.
- Eligibility must be derived from authoritative records at query time or through a transactionally safe reviewed projection; never trust a client boolean.
- Permission removal or suspension must remove results immediately.
- Add a truth-table/property matrix covering every individual failing dimension and important combinations.

### 8. PostgreSQL lexical retrieval

Implement PostgreSQL lexical retrieval only.

- Apply tenant, visibility, lifecycle, review, permission, and exact curriculum relational filters before ranking.
- Use parameterized SQL and an indexed PostgreSQL text-search representation suitable for the repository's Hebrew baseline.
- Return stable KnowledgeItem and SourceVersion IDs, locators, rank metadata, and Curriculum lineage.
- Enforce bounded query and result limits with deterministic tie ordering.
- Empty/invalid queries return controlled results and never relax eligibility.
- Do not add embeddings, pgvector, semantic ranking, hybrid retrieval, or an external search/vector service.

### 9. Contracts and generated artifacts

Create strict versioned Zod contracts and generated JSON Schemas for at least:

- source creation/summary;
- source-version registration/summary;
- pedagogical review decision;
- usage-permission decision;
- ingestion request/status;
- eligible knowledge item/provenance;
- lexical retrieval request/result.

Requirements:

- reject unknown fields;
- use bounded strings/collections and explicit enums;
- exclude trusted tenant, status, reviewer, eligibility, audit, and hash fields from client-controlled inputs;
- map persisted responses losslessly and validate before return;
- commit generated artifacts and preserve byte-for-byte drift checking.

### 10. Audit and safe observability

Audit source/version creation, review, permission, ingestion lifecycle, activation, suspension, and deprecation using identifiers and bounded safe metadata.

- Never record raw source text, extracted item text, secrets, student PII, full documents, or unsafe parser errors.
- Preserve append-only enforcement.
- Add redaction tests for audit, outbox, logger, and thrown-error paths.

### 11. Seed and benchmark evidence

Add a small deterministic test seed set and Hebrew lexical retrieval benchmark.

- Fixtures must have documented test-only rights/origin and contain no student PII.
- Include eligible and ineligible versions/items, tenant-private and platform-shared visibility, multiple Curriculum nodes, suspension, denied permission, and changed-hash cases.
- Measure a reproducible lexical baseline with expected eligible result IDs/order.
- Acceptance requires zero ineligible and zero cross-tenant leakage. Do not claim semantic quality.

### 12. Migration and database enforcement

Add one additive Phase 30 migration and matching Prisma models.

Use reviewed PostgreSQL constraints, indexes, triggers, and deferred checks where Prisma cannot express the invariant. Add direct-database adversarial tests so rejection is caused by the intended Phase 30 boundary, not an unrelated constraint.

Preserve clean migration from zero and compare migration history against an independently migrated clean database using the existing isolated shadow method. Do not replace that with a live-schema-to-Prisma comparison.

## Mandatory acceptance criteria

Report one PASS/PARTIAL/FAIL/NOT VERIFIED result for each item:

1. Strict runtime contracts, generated schemas, Prisma models, and reviewed migration cover all Phase 30 entities and externally exchanged shapes.
2. SourceVersion identity/hash/content metadata are immutable and changed hashes create independently reviewed versions.
3. Pedagogical review, usage permission, and operational lifecycle are independently persisted and historically auditable.
4. Eligibility is deny-by-default and every missing/negative dimension is permanently tested.
5. Platform-shared versus organization-private visibility is database-consistent and server-authorized.
6. Every tenant-owned operation has persisted role/state authorization plus A-to-B and B-to-A non-disclosure tests.
7. Curriculum associations use exact published Phase 20 version/node IDs and reject cross-version/free-text bypasses.
8. Ingestion is idempotent by source hash plus pipeline version and duplicate delivery cannot duplicate active items.
9. Failed/interrupted ingestion rolls back or leaves no active partial item set.
10. Outbox retry, lease, stale recovery, and terminal failure paths are proven for ingestion events.
11. Active KnowledgeItems are immutable and retain complete source, locator, hash, pipeline, visibility, and Curriculum provenance.
12. Suspension, deprecation, permission removal, or needs-re-review removes affected items from retrieval immediately.
13. PostgreSQL lexical retrieval performs relational eligibility and tenant filtering before ranking.
14. Retrieval has deterministic ordering/limits and returns complete stable provenance.
15. The Hebrew benchmark has zero ineligible and zero cross-tenant leakage and records expected result order.
16. Audit/outbox/log/error evidence contains no raw source or KnowledgeItem text and audit rows remain append-only.
17. Generated artifacts and persisted mappings are byte-drift/lossless validated.
18. Two clean migrations, migration-history drift, unit, contract, architecture, worker, authorization, retrieval, integration, and build gates pass with zero skips.
19. The implementation is committed intentionally and the report records exact commands, exit codes, counts, hashes, deviations, risks, and debt.
20. No Phase 40+ AI generation, embeddings, semantic retrieval, editor, validation, document, deployment, billing, or student functionality was added.

## Required verification

Run from the final implementation tree and record exact results:

- `pnpm install --frozen-lockfile`;
- Prisma generate, format validation, and migration validation;
- clean migrations on `teaching_test` and independently on `teaching_clean`;
- migration-history drift through isolated `teaching_shadow`;
- `pnpm format-check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm contracts:check`;
- `pnpm test:architecture`;
- the complete PostgreSQL integration/worker/retrieval suite with zero skips;
- `pnpm build`;
- `git diff --check`;
- final substantive Git scope inspection.

Do not accept a generic thrown error as proof when another constraint could have caused it. Add focused permanent adversarial tests and assert the intended error/boundary.

## Git and documentation discipline

- Preserve existing commits and unrelated user work.
- Do not mass-format or stage CRLF-only/status-cache noise.
- Inspect `git diff --name-only`, `git diff --stat`, `git diff --check`, staged paths, and commit scope.
- Do not edit Phase 20 review verdicts.
- Do not push, merge, or start Phase 40.

Use a two-commit handoff:

1. Implementation commit containing Phase 30 production code, migration, tests, contracts/artifacts, fixtures, and necessary runbooks.
2. Report-only documentation commit for `docs/phases/30-implementation-report.md`, referencing the implementation commit hash and exact final evidence.

The implementation report is a claim set submitted for independent review. It must not declare Phase 30 approved.

## Completion behavior

Continue until the entire Phase 30 implementation, permanent evidence, full gate, implementation commit, report, and report-only commit are complete. Do not stop after a partial matrix or progress update. Ordinary test failures, missing helpers, and required additive Phase 30 schema are implementation work, not external blockers.

Stop only when:

- the implementation is `READY FOR INDEPENDENT PHASE 30 REVIEW`; or
- a genuine external decision conflicts with an approved ADR or protected Phase 20 contract and requires the product owner/master session.

Final response must include:

1. `READY FOR INDEPENDENT PHASE 30 REVIEW` or `BLOCKED`;
2. exact files changed;
3. exact acceptance-criteria results;
4. exact commands, exit codes, counts, and zero-skip evidence;
5. clean migration and drift evidence;
6. implementation commit hash;
7. report-only commit hash;
8. deviations, remaining risks, and genuine blockers;
9. exact statement: `Phase 40 was not started.`
