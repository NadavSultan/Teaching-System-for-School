# Phase 20 Preparation — Curriculum and Assessment Domain

Status: **PREPARED — implementation prompt not yet issued**  
Dependency: Phase 10 approved with tracked follow-ups

## Objective

Implement the versioned, data-driven Curriculum domain and the structured, revision-based Assessment domain, including deterministic scoring invariants. Establish schema and contract version 1 for both domains without adding knowledge retrieval, AI generation, teacher editing UI, or document rendering.

## Required repository context

The implementation session must read all architecture control documents, the Phase 10 re-review, Phase 10 implementation report, database/authentication runbooks, existing Zod contracts, Prisma schema/migrations, centralized authorization policy, architecture tests, and CI workflow before changing code.

## Dependencies and inherited decisions

- ADR-002: remain inside the modular monolith; Curriculum and Assessment own their writes.
- ADR-004: Assessment revisions are immutable; approval/export will later target a specific revision.
- ADR-006: every tenant-owned Assessment record has a non-null `organization_id` and server-enforced authorization.
- Curriculum content is data, never application branching or hard-coded grade/topic logic.
- Published Curriculum versions are immutable.
- Typed adjacency nodes represent Grade → Domain → Topic → Subtopic → Skill; validation controls allowed parent-child relationships.
- Scoring uses exact integer units or exact database decimals, never floating-point equality.
- Phase 10 API error, principal, organization, membership, workspace, and health contracts must not be broken.
- Outbox delivery is at least once; any Phase 20 handler must be idempotent.

## Required scope

- Curriculum, immutable CurriculumVersion lifecycle, and typed CurriculumNode hierarchy.
- Draft creation/import and explicit publish/deprecate behavior with auditability.
- Assessment identity, tenant ownership, type (`WORKSHEET`/`TEST`), and immutable AssessmentRevision.
- Structured sections, questions, subquestions, answers, rubric criteria, ordering, metadata, and scoring.
- Revision state machine sufficient for future draft, validation, approval, and export boundaries; Phase 20 must not implement those later workflows.
- Exact score validation: assessment total equals section totals; section totals equal question totals; question totals equal subquestion totals where applicable.
- Runtime Zod contracts plus versioned JSON Schema artifacts and drift protection.
- PostgreSQL migrations, constraints, repositories/services, authorization, audit/outbox events where justified, fixtures, and documentation.

## Protected interfaces and invariants

- Published CurriculumVersion records and their nodes cannot be mutated in place.
- An AssessmentRevision is never mutated after it leaves its explicitly defined editable draft state; prefer creating a new revision for material changes.
- Assessment identity and revision identity remain separate.
- Curriculum references use stable IDs plus a specific CurriculumVersion.
- No Assessment may reference an unpublished or cross-tenant-inaccessible curriculum scope according to the chosen visibility policy.
- Tests default to total score 100 but the model supports an explicitly configured exact total.
- Documents and AI prose never become the internal source of truth.
- Phase 20 must not introduce source registry IDs as foreign keys before Phase 30 owns those entities; use a clearly versioned future provenance boundary only if required.

## Acceptance criteria

- Clean migrations apply to a fresh PostgreSQL database and preserve Phase 10 tests.
- Curriculum hierarchy and lifecycle rules are database/domain tested, including invalid parent-child relationships and published-version immutability.
- Curriculum data can add future grades/subjects without schema changes or hard-coded code branches.
- Assessment worksheet and test fixtures parse through versioned runtime contracts and persist/reload without loss.
- Revision identity, ordering, and immutability rules are tested.
- Exact scoring invariants pass for valid fixtures and reject missing, negative, fractional-policy-invalid, and inconsistent totals.
- Tenant-isolation tests cover Curriculum visibility/ownership decisions and Assessment reads/writes in both directions.
- Contract generation/drift, architecture boundaries, format, lint, typecheck, unit, integration, and builds pass with zero required-test skips.
- Documentation records schema versions, state machines, invariants, migration behavior, and explicit deferrals.
- No Phase 30+ source ingestion/retrieval, AI generation, validation engine, teacher editor, or PDF functionality is added.

## Required tests

- Unit/property tests for hierarchy transitions, lifecycle, revision state, ordering, and exact score arithmetic.
- PostgreSQL tests for constraints, immutability, referential integrity, transactions, tenant isolation, and migration application.
- Contract tests for valid/invalid Curriculum and Assessment structures plus JSON Schema drift.
- Regression execution of the complete Phase 10 suite.
- API tests only for the minimum domain boundary required by Phase 20; do not build the teacher workspace early.

## Explicit out of scope

- Full official Israeli Hebrew curriculum mapping or mass content entry.
- Source Registry, licensing review workflow, parsing, chunking, indexing, search, embeddings, or RAG.
- LLM provider, prompts, generated questions, regeneration, token/cost tracking.
- Semantic validation, teacher editor/approval screens, PDF/DOCX, production auth, deployment, collaboration, and student data.

## Inherited risks and follow-ups

- R-004/R-012: every new tenant relation and migration must extend isolation/invariant tests.
- R-009: schema conveniences must not silently redesign approved domain boundaries.
- R-010: avoid building curriculum authoring platforms or full assessment workflows in this phase.
- TD-007 remains deferred and is not a Phase 20 implementation target.
- Hosted CI remains unverified until a remote workflow exists; the local CI-equivalent remains mandatory.

When requested, the permanent architecture session will turn this preparation into the complete Phase 20 Master Implementation Prompt.
