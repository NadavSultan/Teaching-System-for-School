# Phase 30 Preparation — Source Registry and Controlled Knowledge

Status: **MASTER IMPLEMENTATION PROMPT ISSUED**
Dependency: Phase 20 approved by independent Re-Review 4
Approved Phase 20 review commit: `603ac866b6d7d4fff6ef679ce1a671718a32c05d`
Preparation date: 2026-08-24

## Objective

Implement the auditable Source Registry and controlled Knowledge domain that future generation may query. Phase 30 establishes immutable source versions, independent pedagogical and usage-permission decisions, deterministic ingestion, provenance-preserving knowledge items, tenant visibility, and eligibility-first PostgreSQL lexical retrieval.

Phase 30 does not generate educational material. It supplies only the reviewed, traceable, deny-by-default knowledge substrate that Phase 40 may later consume.

## Approved dependencies

- ADR-001: only explicitly eligible educational source versions may enter production generation context.
- ADR-002: remain inside the modular TypeScript monolith with asynchronous workers and PostgreSQL-backed durable jobs.
- ADR-003: apply relational eligibility filters before PostgreSQL lexical ranking; semantic/vector retrieval requires later benchmark evidence.
- ADR-006: every tenant-owned record has explicit ownership and server-enforced authorization.
- Phase 10 outbox retry, lease, stale recovery, audit, and persisted access-context boundaries remain authoritative.
- Phase 20 CurriculumVersion and CurriculumNode identities, lifecycle, generated contracts, and tenant resolver are approved protected interfaces.

## Protected Phase 20 interfaces

Phase 30 must not weaken or rewrite:

- published CurriculumVersion and CurriculumNode immutability;
- exact version/node identity and same-version rules;
- Assessment contracts, scoring, revision lifecycle, or historical immutability;
- `resolveAccessContext` and the non-disclosing tenant authorization pattern;
- generated-schema byte-drift and migration-history drift gates;
- Phase 10 API error, identity, membership, organization, outbox, and audit contracts.

Source-to-curriculum associations must reference an exact published CurriculumVersion and compatible nodes. Free-text curriculum identifiers must not bypass those references.

## Required domain boundaries

### Source registry

- `KnowledgeSource` is the logical source identity.
- `SourceVersion` is an immutable revision identified by a server-verified content hash and version metadata.
- A changed hash creates a new SourceVersion. It does not inherit eligibility, approval, or permission by default.
- Source version lifecycle, pedagogical review, and usage permission are separate dimensions and separate evidence records.
- Rejected, suspended, deprecated, failed, and needs-re-review states retain reasons and history.

### Review and permission

- Pedagogical approval answers whether the exact source version is educationally acceptable.
- Usage permission answers whether the exact source version may be used for AI generation and under which recorded evidence.
- Neither decision implies the other.
- Review/permission changes are append-only decisions or superseding revisions; prior evidence is never overwritten silently.
- AI-generated material is ineligible until a human review and permitted-use decision explicitly promote that exact version.

### Tenant visibility

- Platform-shared and organization-private visibility must be represented explicitly.
- Organization-private records require a non-null organization owner.
- Platform-shared records must not be silently converted from organization content.
- All create, read, review, permission, ingest, suspend, and retrieval operations use explicit domain operations and persisted access context.
- Missing and inaccessible resources remain non-disclosing.
- PLATFORM_ADMIN has no implicit tenant membership.

### Ingestion and knowledge items

- Ingestion is idempotent by SourceVersion content hash plus pipeline version.
- A durable ingestion run records state, attempts, safe failure class, timestamps, and pipeline/parser version.
- The pipeline performs bounded input validation, parsing through a narrow adapter, deterministic normalization, locator extraction, metadata assignment, item hashing, quality validation, and atomic publication.
- Failed or interrupted runs never leave active partial KnowledgeItems.
- Immutable KnowledgeItems retain SourceVersion, locator, normalized text hash, metadata, lifecycle, and exact Curriculum associations.
- Binary/file storage is represented through a provider-neutral reference. Phase 30 does not select or activate a paid storage provider.

### Eligibility and retrieval

The eligibility predicate is deny-by-default and requires all applicable conditions:

`pedagogical review approved AND AI usage allowed AND source version active AND knowledge item active AND tenant visibility permits access AND exact published curriculum filters match`

- Eligibility is computed from persisted evidence, not copied into an untrusted boolean.
- Relational eligibility and tenant filters execute before lexical ranking.
- PostgreSQL lexical retrieval is the only production retrieval mode in this phase.
- Suspension or permission removal excludes affected items immediately.
- Retrieval returns stable KnowledgeItem and SourceVersion IDs, locators, score/rank metadata, and curriculum lineage.
- The benchmark must prove zero ineligible or cross-tenant leakage and establish a reproducible Hebrew lexical baseline.

## Contracts and services

Create strict versioned Zod contracts and generated JSON Schemas for the externally exchanged Phase 30 shapes. At minimum cover:

- source creation and source summary;
- immutable source-version registration;
- pedagogical review decision;
- usage-permission decision;
- ingestion request/status;
- eligible knowledge item/provenance;
- retrieval request/result.

Requests must not accept trusted lifecycle, eligibility, tenant, reviewer, or audit fields from clients. Service responses must be mapped losslessly from persisted records and validated before return.

## Security and audit requirements

- Hash content server-side and enforce bounded content/metadata/locator sizes.
- Do not fetch arbitrary URLs or introduce an SSRF path.
- Do not log or place raw source text in AuditEvent, OutboxEvent failure fields, telemetry, or thrown errors.
- Audit lifecycle, review, permission, ingestion, suspension, and retrieval-administration operations with identifiers and safe metadata only.
- Preserve append-only audit behavior.
- Use parameterized SQL for lexical retrieval.
- Source files containing student PII remain out of scope.

## Required tests

- Domain/property matrices for lifecycle, review, permission, and eligibility.
- Direct PostgreSQL constraint/trigger tests, including adversarial state changes and immutable-version attempts.
- Clean migration from zero and migration-history drift comparison.
- Bidirectional tenant and role/state authorization matrices for every tenant-owned Phase 30 entity and operation.
- New-hash non-inheritance and suspension/removal tests.
- Ingestion idempotency, duplicate delivery, retry, stale lease, failure rollback, and atomic activation tests.
- Parser/normalization fixtures with deterministic locators and hashes.
- Provenance round-trip and generated-contract drift tests.
- PostgreSQL lexical retrieval benchmark with eligible expected results and zero ineligible/cross-tenant leakage.
- Audit redaction and append-only tests.
- Phase 10 and Phase 20 regression gates.

## Required deliverables

- Prisma models and one reviewed additive Phase 30 migration.
- Database constraints/triggers/indexes needed for invariants and lexical retrieval.
- Framework-light domain rules and explicit authorization operations.
- Database/application services and a narrow worker ingestion handler.
- Versioned contracts and generated schemas with drift protection.
- Deterministic fixtures and a small approved test seed set.
- Unit, contract, architecture, worker, PostgreSQL integration, retrieval, and authorization tests.
- Updated database/ingestion runbooks.
- `docs/phases/30-implementation-report.md` with exact evidence.

## Out of scope

- AI/model calls, prompts, generation, question regeneration, or provider selection.
- Embeddings, pgvector, external vector databases, or semantic/hybrid retrieval.
- Open-web crawling, arbitrary URL fetching, or unrestricted external ingestion.
- Production file-upload UI, managed object-storage vendor selection, or malware vendor activation.
- Teacher editor/approval UI, validation engine, PDF/DOCX, deployment, billing, collaboration, or student accounts/data.
- Changes to approved Phase 20 Curriculum/Assessment semantics.

## Inherited risks and review triggers

- R-001/R-002: pedagogical correctness and usage rights remain independent release gates.
- R-004/R-012: repeat bidirectional tenant enforcement for each new entity and migration.
- R-006: retrieval leakage or relevance failure blocks Phase 40.
- R-008: source content must not leak to logs, audits, or providers.
- R-009/R-010: do not redesign into microservices or add speculative semantic infrastructure.
- R-013/R-014: preserve Phase 20 database and contract-drift gates while extending cross-domain references.

## Completion and gate behavior

The implementation session must complete Phase 30, run every required gate, create an implementation commit followed by a report-only documentation commit, and stop. It must not approve its own work, push, merge, start Phase 40, or edit the independent Phase 20 verdict.

Phase 40 remains blocked until an independent Phase 30 review issues an approving verdict.
