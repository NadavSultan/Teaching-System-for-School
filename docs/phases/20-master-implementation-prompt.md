# Phase 20 Master Implementation Prompt — Curriculum and Assessment Domain

Use this prompt in a separate focused implementation session.

## Role and authority

You are the implementation engineer for **Phase 20 only** of a production-oriented AI educational platform for Israeli Hebrew-language teachers in grades 7–9.

The permanent architectural source of truth is:

- `docs/architecture/system-architecture-v1.md`
- `docs/architecture/decision-log.md`
- `docs/architecture/project-state.md`
- `docs/architecture/risk-register.md`
- `docs/architecture/technical-debt-register.md`
- `docs/phases/10-phase-re-review.md`
- `docs/phases/20-phase-preparation.md`

Read those files completely before making changes. Also read the Phase 10 implementation report, database/authentication runbooks, Prisma schema and migrations, existing contracts, authorization policy, architecture tests, CI workflow, and every applicable `AGENTS.md`.

Do not redesign the approved architecture. If implementation exposes a material contradiction or requires changing an approved ADR, stop and return the decision to the permanent architecture session.

## Objective

Implement schema and contract version 1 for two framework-light domains:

1. A versioned, data-driven Curriculum domain supporting Grade → Domain → Topic → Subtopic → Skill hierarchy and controlled publication.
2. A structured, tenant-owned Assessment domain with immutable revisions, sections, questions, subquestions, answers, rubrics, ordering, curriculum references, and exact deterministic scoring.

This phase establishes domain truth and invariants. It does not populate the full Israeli curriculum, retrieve knowledge, call AI, validate educational quality, build the teacher editor, or render documents.

## Required baseline and branch discipline

- Begin from reviewed Phase 10 commit `4502bbd` or a descendant containing only intentional architecture documentation changes.
- Confirm `main` is synchronized with `origin/main` before branching; do not discard a dirty worktree.
- Create local branch `agent/phase-20-curriculum-assessment` when starting from `main`.
- Do not push, open a pull request, merge, or modify remote state unless the user explicitly requests it.
- Preserve all Phase 10 behavior and regression tests.
- Use the pinned Node.js, pnpm, TypeScript, Turborepo, NestJS, Next.js, Prisma, PostgreSQL, Zod, and Vitest toolchain unless a compatibility fix is necessary and documented.

## Approved Phase 20 design decisions

These are implementation constraints, not open design choices:

### Curriculum ownership and visibility

- Curriculum v1 is platform-wide reference data, not organization-owned content.
- Teachers may consume only `PUBLISHED` Curriculum versions.
- Curriculum draft/import/publish operations are internal application services in Phase 20; no admin UI and no teacher mutation endpoints are required.
- Organization-specific curriculum overlays, school customizations, and private curricula are out of scope. The model must not prevent adding them later as separate overlay/customization concepts.

### Curriculum hierarchy

- `Curriculum` is the stable logical identity for an education-system/subject combination.
- `CurriculumVersion` is a numbered immutable content release with lifecycle `DRAFT → PUBLISHED → DEPRECATED`.
- `CurriculumNode` uses typed adjacency, not one table per level.
- Supported node types are `GRADE`, `DOMAIN`, `TOPIC`, `SUBTOPIC`, and `SKILL`.
- The required parent rules are:
  - `GRADE`: root; no parent.
  - `DOMAIN`: parent must be `GRADE`.
  - `TOPIC`: parent must be `DOMAIN`.
  - `SUBTOPIC`: parent must be `TOPIC`.
  - `SKILL`: parent must be `SUBTOPIC`.
- Every parent and child belongs to the same CurriculumVersion.
- Node codes are stable machine codes; Hebrew labels and descriptions are data.
- Node ordering is deterministic and unique within a sibling collection.
- Difficulty bands are `LOW`, `MEDIUM`, and `HIGH`; skill/difficulty applicability is modeled as data, not hard-coded branching.

### Assessment ownership and revisions

- `Assessment` is the stable tenant-owned identity and has a non-null `organization_id`.
- Assessment types are `WORKSHEET` and `TEST`.
- `AssessmentRevision` is an immutable content snapshot with a monotonic revision number unique within the Assessment.
- Creating or materially changing content creates a new revision; previous revisions remain unchanged.
- Do not implement teacher approval in Phase 20. Future approval will reference an immutable revision rather than mutate its content.
- Assessment child records are revision snapshots. Later question-bank edits must never alter historical Assessment revisions.
- Revision creation is one atomic transaction and must be idempotent when supplied an idempotency key.

### Exact scoring

- Store scores as non-negative integer hundredth-point units.
- `SCORE_UNIT_SCALE = 100`; therefore `100 points = 10_000 score units` and `0.5 points = 50 score units`.
- Never use JavaScript floating-point arithmetic or PostgreSQL floating types for score equality.
- `ScoringMode` is `NONE` or `POINTS`.
- A `TEST` must use `POINTS`; its default requested total is `10_000` units.
- A `WORKSHEET` may use `NONE` or `POINTS`.
- With `NONE`, all total/section/question/subquestion score fields are null.
- With `POINTS`, revision total equals section totals; every section total equals its direct question totals; a question with subquestions equals their totals; a question without subquestions owns its score directly.
- Negative scores, inconsistent totals, mixed null/non-null score trees, duplicate ordering, and totals above the documented safe maximum are rejected.

## Required data model

Use UUID primary keys and Phase 10 timestamp conventions. Add reviewed migrations rather than rewriting applied Phase 10 migrations.

### Curriculum entities

- `Curriculum`: stable code, education-system code, subject code, display name, active/deprecated lifecycle metadata.
- `CurriculumVersion`: curriculum ID, sequential version number, optional human label, lifecycle status, timestamps for creation/publication/deprecation, and audit metadata.
- `CurriculumNode`: version ID, parent ID nullable only for Grade, node type, stable code, Hebrew label, optional description, deterministic sort order, and constrained metadata if required.
- `CurriculumSkillDifficulty`: Skill node ID and difficulty band, unique per skill/band.

Database constraints/triggers must enforce parent type, same-version ancestry, root rules, sibling code/order uniqueness, skill-only difficulty links, valid lifecycle transitions, and published/deprecated content immutability.

Publishing must be atomic and must reject an empty or structurally invalid hierarchy. A published version and all its nodes/difficulty records cannot be edited, added to, moved, or deleted. Deprecation may change lifecycle metadata only; content remains immutable.

### Assessment entities

- `Assessment`: organization ID, type, stable title/identity metadata, creator user ID where appropriate, and timestamps.
- `AssessmentRevision`: assessment ID, monotonic revision number, idempotency key scoped to the Assessment, CurriculumVersion ID, generation-independent configuration metadata, scoring mode, total score units, and timestamps.
- `AssessmentRevisionNodeLink`: revision ID and selected CurriculumNode ID, with a role/purpose code if needed; all nodes must belong to the revision's CurriculumVersion.
- `AssessmentSection`: revision ID, stable section key, title/instructions, order, and score units.
- `AssessmentQuestion`: section ID, stable question key, question type code, prompt text, optional instructions, order, difficulty, score units, and constrained structured metadata.
- `AssessmentSubQuestion`: question ID, stable key, prompt text, order, and score units.
- `Answer`: exactly one answer target—question or subquestion—plus structured answer text/data and optional explanation. Enforce XOR target ownership.
- `RubricCriterion`: question or subquestion target, stable key, description, order, and optional score units; enforce valid target ownership and score consistency.

Do not create `KnowledgeSource`, `KnowledgeItem`, `QuestionSourceLink`, Question Bank, GenerationRun, ValidationRun, Export, or AI provider tables in this phase.

## Required domain and application behavior

### Curriculum services

- Create a Curriculum and a draft version.
- Import/create a complete draft hierarchy from a runtime-validated contract in one transaction.
- Reject invalid codes, duplicate sibling codes/orders, missing parents, wrong parent types, cross-version parents, cycles, and invalid difficulty targets.
- Publish a structurally valid draft atomically.
- Deprecate a published version without modifying its content.
- Read published versions/hierarchies deterministically.
- Do not expose unrestricted teacher-side curriculum mutation.

### Assessment services

- Create a tenant-owned Assessment through trusted principal/organization context.
- Create an immutable revision graph atomically from a runtime-validated contract.
- Verify the referenced CurriculumVersion is `PUBLISHED` and every selected node belongs to that version.
- Validate ordering, stable keys, answer/rubric targets, scoring mode, and all score invariants before and during persistence.
- Load an Assessment revision without loss and return deterministic section/question/subquestion ordering.
- Create the next revision without mutating or deleting the prior revision.
- Enforce tenant isolation for every Assessment read/write service in both directions.
- Write safe audit events for curriculum publication/deprecation and Assessment/revision creation.
- Emit Outbox events only when a real Phase 20 consumer boundary justifies them. Any emitted event must have a versioned payload, idempotency key, and future-idempotent semantics.

## Immutability and database enforcement

Application validation is not sufficient by itself. Add database enforcement for critical invariants.

- Phase 10 tables and migrations remain untouched.
- Published/deprecated Curriculum content must reject update/delete/late child insertion at the database level.
- AssessmentRevision and its section/question/subquestion/answer/rubric/link graph must reject update/delete after creation.
- Because graph creation requires multiple inserts, use a safe transactional construction mechanism. Do not temporarily expose partial revisions as complete.
- Consider a construction state owned by the transaction or a finalization mechanism, but do not introduce mutable revision content after finalization.
- Revision number and idempotency uniqueness must be database enforced.
- Cross-tenant Assessment access must be impossible through repository/application-service APIs.
- Document which invariants are database-enforced, domain-enforced, or both.

If PostgreSQL trigger complexity creates a materially different state model, stop and return the options to the architecture session instead of silently weakening immutability.

## Contracts and schema versions

Establish:

- Curriculum Schema Version: `1.0.0`
- Assessment Schema Version: `1.0.0`

Use Zod as the runtime source of truth and generate versioned JSON Schema artifacts with byte-for-byte drift checks.

At minimum provide contracts for:

- Curriculum hierarchy import/draft representation.
- Published Curriculum hierarchy response.
- Curriculum node and skill-difficulty representation.
- Assessment creation input/summary.
- Assessment revision creation input.
- Complete Assessment revision response.
- Section, question, subquestion, answer, and rubric structures.
- Deterministic score-validation result/error details.

Use string/UUID identities and integer score units. Do not leak Prisma types, JavaScript `Date` objects, or database enums directly across contracts. Preserve all Phase 10 contract artifacts and tests.

## Authorization and security

- Curriculum published-read operations are platform reference reads; draft/publish/deprecate services remain internal and unavailable to ordinary teacher HTTP requests in Phase 20.
- Assessment operations require trusted authentication, active user/membership/organization, matching non-null organization ID, and an allowed teacher/coordinator/admin role according to explicit operations.
- Add explicit authorization operations rather than generic role defaults.
- Client-provided organization, Assessment, CurriculumVersion, or node IDs never establish authority or validity.
- Cross-tenant missing/inaccessible Assessment responses remain non-disclosing.
- Do not store student names, submissions, accounts, or other student PII.
- Validate bounded string lengths, array sizes, hierarchy depth, question counts, and metadata payload size before persistence.
- Audit metadata must exclude assessment content, answers, credentials, and student data.

## Required API scope

Prefer application-service and repository boundaries for this phase. Add only minimal protected API endpoints if necessary to prove contract and tenant behavior. Do not build teacher-workspace CRUD, curriculum administration UI, dashboards, or polished product flows.

The existing Hebrew/RTL web shell may display a non-interactive Phase 20 status/sample fixture only if useful for smoke testing. UI work is not an acceptance criterion.

## TD-008 documentation cleanup

Consolidate `docs/phases/10-implementation-report.md` so its opening status and original sections no longer contradict the appended remediation evidence. Preserve the historical record, but clearly label the initial failed verification as pre-remediation and make the final Phase 10 state unambiguous. Do not alter the permanent architect's Phase 10 verdict.

Report TD-008 as resolved for architectural review; do not edit its register status yourself.

## Testing requirements

### Unit and property tests

- Curriculum parent-child transition matrix, lifecycle transitions, codes, ordering, hierarchy validation, and difficulty applicability.
- Assessment revision sequencing, stable keys, target XOR rules, deterministic ordering, and immutability behavior.
- Score arithmetic and tree invariants using generated valid/invalid cases, including zero, maximum, fractional display equivalents, missing scores, negative values, and inconsistent sums.
- Contract parsing/rejection and authorization operation matrix.

### PostgreSQL integration tests

- Clean migration from the complete Phase 10 schema.
- Curriculum draft creation, invalid hierarchy rejection, atomic publish, deprecation, and database-level immutability.
- Cross-version node/parent/reference rejection.
- Assessment atomic graph creation, idempotent retry, monotonic revisions, complete reload, database-level immutability, and invalid-target rejection.
- Published-only Curriculum reference enforcement.
- Bidirectional tenant isolation for Assessment reads/writes.
- Exact scoring enforcement at transaction finalization.
- Safe audit behavior and any justified Outbox event idempotency.

### Regression and quality gates

- Run the complete Phase 10 unit, integration, authorization, Outbox, contract, architecture, and build suite.
- `pnpm test-integration` must never silently skip PostgreSQL tests.
- Run migrations against both the integration database and a separate clean database/schema.
- Run format-check, lint, strict typecheck, unit, integration, architecture, contract drift, and all builds.
- Update CI so every Phase 20 gate runs in hosted/local-equivalent workflows.

## Acceptance criteria

The implementation report must classify every criterion as `PASS`, `PARTIAL`, `FAIL`, or `NOT VERIFIED` with exact evidence.

1. Curriculum Schema v1 and Assessment Schema v1 are implemented as Zod contracts, JSON Schema artifacts, and persisted PostgreSQL models.
2. Clean migrations apply to two isolated databases/schemas and every Phase 10 migration/regression remains valid.
3. Curriculum typed adjacency enforces every approved parent/root/same-version rule in domain and database tests.
4. Draft import is atomic and rejects duplicate codes/orders, invalid parents, invalid difficulty targets, cycles, and oversized inputs.
5. Publishing rejects invalid/empty drafts and makes version content database-immutable; deprecation changes lifecycle metadata only.
6. Published hierarchy retrieval is deterministic and supports future grades/subjects without schema changes or hard-coded content branches.
7. Assessment is tenant-owned with non-null organization ownership and bidirectional read/write isolation.
8. Assessment revision graphs persist and reload without loss, with stable identities and deterministic ordering.
9. Revision creation is atomic, idempotent, monotonically numbered, and never mutates historical revisions.
10. CurriculumVersion/node references are published, internally consistent, and database/domain protected.
11. Worksheet fixtures support `NONE` and valid `POINTS` scoring; Test fixtures require `POINTS` and default to 10,000 units.
12. Exact score invariants pass valid section/question/subquestion trees and reject every inconsistent/null/negative/overflow case without floating-point arithmetic.
13. Answer and rubric targets, ordering, keys, and score relationships are validated and database protected where critical.
14. Published Curriculum and finalized Assessment content reject direct database update/delete attempts.
15. Authorization uses explicit operations and preserves non-disclosing cross-tenant behavior.
16. Audit records are safe and contain no assessment content, answers, credentials, or student data.
17. All new external contracts have committed versioned JSON Schemas and drift/runtime tests; Phase 10 contracts remain backward compatible.
18. Phase 10 implementation report is consolidated and TD-008 exit evidence is documented.
19. Format, lint, strict typecheck, unit/property, zero-skip integration, architecture, contract, migration, and build gates all pass.
20. No Phase 30+ knowledge, AI, validation-engine, editor, rendering, deployment, managed-auth, or student functionality was added.

## Explicit out of scope

- Full or authoritative mapping of Israeli Hebrew curriculum for grades 7–9.
- Curriculum administration UI, school overlays, teacher-custom curriculum, or collaborative curriculum editing.
- Source Registry, source approval/licensing, ingestion, file upload, parsing, chunking, indexing, search, embeddings, vector storage, or RAG.
- AI provider SDKs, credentials, prompts, generation, regeneration, model selection, token/cost tracking, or semantic evaluation.
- Question Bank promotion/reuse, teacher editor/approval workflow, Student/Teacher PDF, DOCX, production auth, cloud deployment, billing, collaboration, and student data.
- Changing Phase 10 identity/tenancy semantics, introducing RLS without an architectural decision, or adding microservices.

## Known inherited risks and follow-ups

- R-004/R-012: every tenant relation and migration must extend real bidirectional isolation and invariant tests.
- R-009: schema convenience must not silently redesign curriculum, revision, or future source boundaries.
- R-010: avoid a full curriculum authoring platform and complete teacher workflow in this phase.
- Exact DB immutability/finalization triggers can become complex; keep them reviewed, tested, and documented.
- Outbox is at-least-once delivery. Future handlers and emitted events require idempotency.
- TD-007 remains intentionally deferred and is not a Phase 20 target.
- Hosted CI should run once the implementation branch is intentionally pushed; a complete local equivalent remains mandatory before handoff.

## Required implementation report

Create `docs/phases/20-implementation-report.md` containing:

1. Executive summary and reviewed branch/commit hash.
2. Curriculum and Assessment responsibility map.
3. Complete entity/relationship and lifecycle summary.
4. Every database/domain invariant and where it is enforced.
5. Contract and JSON Schema artifact inventory with versions.
6. Authorization operation matrix and tenant-isolation evidence.
7. Exact scoring representation and invariant evidence.
8. Every acceptance criterion with `PASS`, `PARTIAL`, `FAIL`, or `NOT VERIFIED`, exact evidence, and follow-up.
9. Exact commands, exit codes, test counts, skips, migration results, and CI/local-equivalent status.
10. Deviations from this prompt or approved architecture.
11. Proposed ADRs, clearly proposals rather than silently adopted decisions.
12. Technical-debt candidates with recommended classification.
13. Newly discovered or changed risks.
14. Documentation state, TD-008 evidence, and environment limitations.

Do not declare Phase 20 approved. Only the permanent architecture session can issue the Phase Review verdict.

## Completion behavior

When Phase 20 is implemented and verified:

1. Update documentation and the implementation report.
2. Create one intentional local commit on the Phase 20 branch if Git identity is configured.
3. Do not push or open a PR unless explicitly authorized by the user.
4. Stop. Do not begin Phase 30.
5. Return the implementation report, commit hash, test/migration evidence, deviations, and remaining items to the permanent architecture session.
