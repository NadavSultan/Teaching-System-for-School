# Phase 20 Remediation Master Prompt — Curriculum and Assessment Domain

Use this prompt in the dedicated Phase 20 implementation session. This is a remediation and completion assignment for Phase 20 only. It is not permission to begin Phase 30 or redesign the system.

## 1. Role and authority

You are the implementation engineer responsible for completing the failed Phase 20 implementation of a production-oriented AI educational platform for Israeli Hebrew-language teachers in grades 7–9.

The permanent architecture session has reviewed the current Phase 20 working tree and issued this verdict:

> **REQUIRES FIXES – Do not proceed yet**

Your task is to repair the current work, implement all missing Phase 20 behavior, prove it with executable evidence, and return the repository to the permanent architecture session for re-review.

You may make implementation decisions that are local and reversible. You may not change an approved ADR, weaken an invariant, change phase scope, or silently introduce a new architectural model. If a genuine contradiction in the approved design appears, stop and document the exact conflict and viable options for the permanent architect. Implementation difficulty alone is not an architectural contradiction.

Do not declare Phase 20 approved. Only the permanent architecture session can approve it.

## 2. Required objective

Complete schema and contract version `1.0.0` for:

1. A platform-wide, versioned Curriculum domain using the hierarchy `GRADE → DOMAIN → TOPIC → SUBTOPIC → SKILL`, with safe draft import, atomic publication, deprecation, deterministic reads, and database-enforced immutability.
2. A tenant-owned Assessment domain with atomic and idempotent immutable revisions, deterministic nested content, published Curriculum references, explicit authorization, safe audits, and exact integer scoring.

The completed work must compile, migrate cleanly, pass every required test and quality gate, preserve Phase 10 behavior, and remain strictly inside Phase 20.

## 3. Read these sources completely before editing

Treat the following files as the source of truth, in this order:

1. `docs/architecture/system-architecture-v1.md`
2. `docs/architecture/decision-log.md`
3. `docs/architecture/project-state.md`
4. `docs/architecture/risk-register.md`
5. `docs/architecture/technical-debt-register.md`
6. `docs/phases/10-phase-re-review.md`
7. `docs/phases/20-phase-preparation.md`
8. `docs/phases/20-master-implementation-prompt.md`
9. `docs/phases/20-implementation-report.md`
10. `docs/phases/20-phase-review.md`
11. Phase 10 database/authentication runbooks, Prisma schema and migrations, existing contracts, authorization code, integration tests, architecture tests, CI workflow, and every applicable `AGENTS.md`.

The original Phase 20 master prompt remains authoritative. This remediation prompt adds the review findings, repair order, and an approved construction mechanism; it does not replace or weaken any original requirement.

## 4. Current repository state and known failures

The reviewed state is based on commit `4502bbd` plus uncommitted Phase 20 work. Preserve the entire working tree. It contains intentional architecture/preparation documents and a partial implementation.

Known failures from the independent Phase Review:

- `pnpm format-check` exits 1 on four Phase 20 files.
- `pnpm typecheck` exits 2 because `curriculumNodeSchema.extend(...)` is called on a value declared as generic `ZodType<any>`.
- `pnpm contracts:check` exits 2 before drift verification.
- `pnpm build` exits 2 in `@teach/contracts`.
- `pnpm test-integration:local` exits 1 because Prisma reports P1012 for 18 invalid one-line enum/model declarations.
- The five registered Phase 20 JSON Schema files do not exist.
- No Phase 20 unit, property, authorization, lifecycle, immutability, persistence, or PostgreSQL integration tests exist.
- There are no Curriculum or Assessment application services.
- Database lifecycle, cross-version, scoring, finalization, and immutability enforcement are absent.
- Assessment tenant authorization and safe audit behavior are absent.
- The current contract and database representations of answers diverge and cannot prove lossless round trips.
- TD-008, the Phase 10 implementation-report consolidation, remains open.

The existing 24 unit tests and four architecture tests pass, but they are Phase 10 regression tests and are not evidence that Phase 20 works.

Do not merely fix the syntax and stop. Syntax repair is only the first gate.

## 5. Git and worktree discipline

1. Start by recording `git status`, the current branch, `HEAD`, and the existing diff. Do not reset, clean, stash, discard, or overwrite any user or architecture-session change.
2. Create `codex/phase-20-remediation` from the current state if branch creation is possible. Branch creation must preserve all current uncommitted files.
3. If Git metadata permissions fail, request the necessary scoped approval or continue the technical work and document the limitation. Do not treat Git permission failure as a reason to skip implementation or verification.
4. Phase 10 migrations are immutable and must never be rewritten.
5. The uncommitted and unapplied Phase 20 migration may be rewritten into one clean reviewed Phase 20 migration. Do not create a chain of corrective migrations for a migration that has never been applied or committed.
6. Do not push, open a pull request, merge, or change remote state.
7. After every gate passes, create one intentional local commit containing the complete Phase 20 work and documentation. Return its full hash.

## 6. Toolchain recovery and first gate

Use the repository's pinned toolchain. If `node` or `pnpm` is not on `PATH`, load the bundled workspace dependencies instead of claiming the runtime is unavailable. In the current environment the verified runtime is Node 24.19.0 with pnpm 11.19.0. Use `CI=true` for non-interactive pnpm execution.

Before implementing services:

1. Restore conventional, readable, multi-line Prisma syntax.
2. Restore strict TypeScript compilation without `any`-based shortcuts.
3. Run Prisma format/validate/generate.
4. Run contract-package typecheck/build.
5. Run repository format-check and lint.

Do not proceed to persistence behavior while the schema or contracts are invalid.

## 7. Non-negotiable architectural constraints

### 7.1 Scope and ownership

- Curriculum v1 is platform reference data. It is not organization-owned.
- Only `PUBLISHED` Curriculum versions are available to teacher-facing consumers.
- Curriculum mutation is internal application-service behavior only. Do not add teacher mutation endpoints or a curriculum admin UI.
- Assessment is tenant-owned and always has a non-null `organization_id`.
- Client-provided organization, Assessment, CurriculumVersion, or node IDs establish neither authority nor validity.
- No Phase 30+ source, ingestion, retrieval, RAG, AI, validation-engine, editor, rendering, deployment, managed-auth, student, or billing functionality may be added.

### 7.2 Curriculum lifecycle and hierarchy

- `Curriculum` is the stable identity for an education-system/subject combination.
- `CurriculumVersion` uses a sequential version number and lifecycle `DRAFT → PUBLISHED → DEPRECATED` only.
- `GRADE` is a root and has no parent.
- `DOMAIN` has a `GRADE` parent.
- `TOPIC` has a `DOMAIN` parent.
- `SUBTOPIC` has a `TOPIC` parent.
- `SKILL` has a `SUBTOPIC` parent.
- Parent and child must belong to the same CurriculumVersion.
- A strict typed hierarchy must make cycles impossible, and cycle rejection must still be tested.
- Sibling code and sibling order are deterministic and unique. Handle PostgreSQL `NULL` semantics correctly for root uniqueness; do not assume a normal nullable-column unique constraint protects root siblings.
- Difficulty bands are `LOW`, `MEDIUM`, and `HIGH`; only `SKILL` nodes may own them.
- Publishing requires a non-empty, complete, structurally valid draft and occurs atomically.
- After publication, content is immutable. No node/difficulty insert, update, move, or delete is allowed.
- Deprecation changes lifecycle metadata only; deprecated content remains immutable.
- Enforce critical hierarchy, lifecycle, difficulty-target, same-version, and immutability rules in PostgreSQL as well as the domain layer.

### 7.3 Assessment identity and immutable revisions

- `Assessment` is the stable tenant-owned identity.
- Types are `WORKSHEET` and `TEST`.
- Material content is held by immutable `AssessmentRevision` graphs.
- Revision numbers are monotonically increasing and unique within an Assessment.
- Idempotency keys are unique within an Assessment.
- A retry with the same idempotency key and the same canonical input returns the existing finalized revision.
- Reuse of the same idempotency key with materially different canonical input fails with a safe conflict; persist or derive a deterministic request fingerprint.
- Concurrent revision creation must not produce duplicate or out-of-order numbers. Lock the stable Assessment row or use an equivalently proven database mechanism inside the transaction.
- Creating the next revision never updates or deletes an earlier revision or its graph.
- Every referenced CurriculumVersion must be `PUBLISHED` at creation/finalization time.
- Every selected CurriculumNode must belong to that exact CurriculumVersion.
- Existing Assessment revisions remain valid if their CurriculumVersion is later deprecated.

### 7.4 Approved revision-construction mechanism

Use an internal database construction state for safe graph creation:

1. Insert the revision as `BUILDING` inside one database transaction.
2. Insert and validate its complete section/question/subquestion/answer/rubric/curriculum-link graph in that same transaction.
3. Finalize it to `FINALIZED` only after all domain and database invariants pass.
4. Add deferred database enforcement so a `BUILDING` revision cannot be committed or observed as a completed revision.
5. Repository reads must return only `FINALIZED` revisions.
6. After finalization, reject update/delete of the revision and reject insert/update/delete anywhere in its child graph.
7. The only legal revision-state transition is `BUILDING → FINALIZED`, and it occurs inside the creation transaction.

This construction state is internal persistence machinery, not a teacher-visible draft revision and not an alternative approval lifecycle. Do not expose `BUILDING` through external contracts.

### 7.5 Exact scoring

- Define and reuse `SCORE_UNIT_SCALE = 100`.
- Define and document `MAX_SCORE_UNITS = 1_000_000` for every score-bearing field and aggregate.
- Store and compare scores only as non-negative integers. Never use JavaScript floating-point or PostgreSQL floating types for equality.
- `100 points = 10_000 units`; `0.5 points = 50 units`.
- `ScoringMode` is `NONE` or `POINTS`.
- `TEST` requires `POINTS`; when a Test total is omitted, the service supplies `10_000` units.
- `WORKSHEET` supports either mode.
- With `NONE`, revision, section, question, subquestion, and rubric score fields are all null.
- With `POINTS`, the revision total equals the sum of section totals.
- Each section total equals its direct question totals.
- A question with subquestions equals the sum of its subquestion totals.
- A question without subquestions owns its score directly.
- If rubric criterion scores are used for a target, all rubric scores for that target are non-null and sum exactly to the target score. Otherwise all rubric scores for that target are null. Mixed rubric scoring is invalid.
- Reject negative, non-integer, overflow, mixed null/non-null, missing, and inconsistent values in runtime validation and at transaction finalization.
- Test zero, the maximum, values corresponding to fractional displayed points, nested valid trees, and every invalid relationship.

## 8. Required contract repair

Use Zod as the runtime source of truth. Keep Curriculum and Assessment schema versions at `1.0.0`.

1. Replace `any`-based recursive typing with explicit TypeScript input/output types and a correctly typed recursive Zod schema.
2. Make external objects strict and bound strings, arrays, hierarchy depth, total nodes, sections, questions, subquestions, answers, rubrics, and metadata sizes.
3. Keep IDs as UUID strings and scores as integers.
4. Do not expose Prisma types, Prisma enums, database construction state, or JavaScript `Date` objects.
5. Align contract and persistence shapes exactly enough for lossless creation/reload.
6. Answers must have a stable key, deterministic order, answer text/structured data, optional explanation, and exactly one question/subquestion target in persistence.
7. Rubric criteria must have a stable key, deterministic order, description, optional score, and exactly one target.
8. Add complete response contracts with generated record IDs and deterministic nested ordering.
9. Prefer deriving organization authority from trusted service context. Do not rely on an organization ID supplied in an Assessment request body.

Generate and commit versioned JSON Schema artifacts with byte-for-byte drift checks. At minimum, include artifacts for:

- Curriculum hierarchy import/draft input.
- Published Curriculum hierarchy response.
- Assessment creation input.
- Assessment summary response.
- Assessment revision creation input.
- Complete finalized Assessment revision response.
- Score-validation result.

Preserve all Phase 10 schema artifacts and backward compatibility. Add runtime acceptance/rejection and drift tests for every new artifact.

## 9. Required PostgreSQL model and enforcement

Use UUID primary keys and existing timestamp conventions. The Prisma schema and raw migration must describe the same model.

### Curriculum enforcement

Implement and test:

- Stable Curriculum identity and unique natural coding appropriate to education system/subject.
- Sequential version uniqueness.
- Root/parent-type rules.
- Composite or trigger-backed same-version parent enforcement.
- Correct root and non-root sibling code/order uniqueness.
- Skill-only difficulty ownership and unique bands.
- Legal lifecycle transitions and consistent lifecycle timestamps.
- Publication rejection for empty or invalid hierarchies.
- Database rejection of late insert, update, move, and delete for published/deprecated content.

### Assessment enforcement

Implement and test:

- Non-null organization ownership and restricted deletion.
- Revision number, idempotency key, and request-fingerprint behavior.
- Internal `BUILDING`/`FINALIZED` construction safety.
- Published CurriculumVersion enforcement at finalization.
- Same-CurriculumVersion node-link enforcement.
- Stable keys and deterministic orders with correct uniqueness for every nested collection.
- Exactly-one-target XOR for answers and rubrics.
- Correct partial unique indexes for answer/rubric key and order under either target type.
- Non-negative and maximum score checks on every score column.
- Deferred exact aggregate/scoring validation before final commit.
- Database rejection of every update/delete/late insert in a finalized revision graph.

Use clear, named PostgreSQL functions/triggers/constraints. Document which invariants are enforced by Zod, the pure domain layer, application services, PostgreSQL, or multiple layers. Do not hide critical behavior in opaque SQL.

## 10. Required domain and persistence services

Keep pure validation and deterministic transformations framework-light in `packages/domain`. Keep Prisma transaction/repository behavior in `packages/db`. Add API code only where required to prove protected behavior; a broad CRUD surface is not required.

Implement Curriculum services for:

- Creating a Curriculum and its draft version safely.
- Importing a complete validated draft hierarchy atomically.
- Publishing a valid draft atomically.
- Deprecating a published version without content mutation.
- Loading published hierarchies deterministically.

Implement Assessment services for:

- Creating an Assessment using trusted principal/workspace context.
- Creating a complete revision graph atomically and idempotently.
- Returning the existing revision on a valid idempotent retry.
- Rejecting an idempotency-key payload mismatch.
- Loading a finalized revision without data loss and with deterministic ordering.
- Creating the next revision without mutating history.
- Denying cross-tenant read and write access in both directions with non-disclosing errors.

Avoid generic repositories that permit unscoped Assessment access. Tenant scoping must be part of the public repository/application-service boundary.

## 11. Authorization and audit requirements

Add explicit authorization operations rather than reusing broad workspace-read permission. At minimum distinguish:

- `CREATE_ASSESSMENT`
- `READ_ASSESSMENT`
- `CREATE_ASSESSMENT_REVISION`

For Phase 20, active `TEACHER`, `COORDINATOR`, and `SCHOOL_ADMIN` memberships may perform these operations within their trusted active organization context. A Personal Workspace teacher operates only within that Personal organization. `PLATFORM_ADMIN` receives no implicit tenant-content access. Inactive users, memberships, and organizations are denied.

Curriculum published reads are platform-reference reads. Draft import, publication, and deprecation remain internal services and are not ordinary teacher HTTP operations.

Write safe audit events for:

- Curriculum publication.
- Curriculum deprecation.
- Assessment creation.
- Assessment revision finalization.

Audit metadata may contain identifiers, schema/revision numbers, lifecycle transition, and safe operation metadata. It must not contain prompts, questions, answers, rubrics, credentials, tokens, student data, or full request bodies.

Do not emit Outbox events unless a real Phase 20 consumer boundary exists. If none exists, audit without Outbox publication and document that choice.

## 12. Required tests

Passing tests are evidence only when they execute the relevant behavior. No PostgreSQL test may silently skip.

### Unit and generated/property coverage

Add tests for:

- Every valid and invalid Curriculum parent-child transition.
- Root rules, cross-version concepts, cycles, duplicate sibling codes/orders, code bounds, hierarchy depth/size, and difficulty applicability.
- Lifecycle transition matrix and immutability decisions.
- Assessment authorization operation matrix.
- Stable keys/orders, XOR targets, deterministic sorting, revision sequencing, and idempotency behavior.
- Score mode/type matrix and generated valid/invalid score trees.
- Zero, `MAX_SCORE_UNITS`, overflow, negative, missing, mixed null/non-null, fractional display equivalents, subtotal mismatch, and rubric-sum behavior.
- Runtime contract parsing/rejection and lossless response mapping.

Use deterministic generated cases. Add a focused property-testing dependency only if it materially improves coverage; keep the lockfile intentional and pinned.

### PostgreSQL integration coverage

Add real tests for:

- Full migration from the complete Phase 10 schema.
- A second isolated clean database/schema migration.
- Valid draft creation/import and rejection of every invalid hierarchy condition.
- Atomic publication, legal deprecation, and direct SQL immutability rejection.
- Cross-version parent and Assessment-node reference rejection.
- Skill-only difficulty enforcement.
- Atomic Assessment graph creation and complete deterministic reload.
- Idempotent retry, payload mismatch, and concurrent monotonic revision creation.
- Proof that `BUILDING` cannot commit and partial graphs never become readable.
- Direct SQL update/delete/late-insert rejection for finalized revision graphs.
- Published-only Curriculum references and preservation after later deprecation.
- Bidirectional tenant read/write isolation using two organizations.
- Exact scoring validation at finalization, including direct-database invalid attempts.
- Safe audit-event content.

### Regression and architecture coverage

- Preserve every Phase 10 unit/integration/authorization/Outbox/contract/architecture test.
- Extend architecture tests if new files create a boundary that must be protected.
- Keep `pnpm test-integration` fail-closed when PostgreSQL configuration is absent; never convert missing database execution into a successful skip.
- Update CI/local-equivalent scripts so all Phase 20 gates execute.

## 13. TD-008 documentation correction

Consolidate `docs/phases/10-implementation-report.md` so the opening status and primary evidence reflect the final remediated Phase 10 state. Preserve the historical initial failure as clearly labeled pre-remediation history, but remove contradictory current claims.

Do not change the Phase 10 architectural verdict. In the Phase 20 implementation report, provide exact evidence that TD-008's exit criterion has been met. Do not edit the Technical Debt Register status; the permanent architecture session will close it after review.

## 14. Mandatory verification sequence

Run the following with the pinned runtime and `CI=true`. Record every exact command, exit code, test-file count, test count, skip count, database target, and migration result:

1. `pnpm install --frozen-lockfile`
2. Prisma format, validate, and generate commands for `@teach/db`
3. `pnpm format-check`
4. `pnpm lint`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm contracts:check`
8. `pnpm test:architecture`
9. `pnpm test-integration:local`
10. A separately evidenced second clean-database/schema migration
11. `pnpm build`
12. `git diff --check`

If any gate fails, fix the cause and rerun the failed gate. Before handoff, rerun the entire sequence from a stable working tree. Do not report an earlier failure as the final result, and do not omit intermediate failures from the implementation report when they reveal an important defect or environmental requirement.

Hosted CI is required if the branch is intentionally pushed later, but this assignment does not authorize a push. A complete local equivalent is mandatory now.

## 15. Acceptance criteria for the remediation handoff

The updated implementation report must include a separate row for all 20 original Phase 20 acceptance criteria. A criterion may be marked `PASS` only when the repository and executable evidence satisfy it. Do not group criteria into ranges.

The remediation is ready for architectural re-review only when:

1. Curriculum and Assessment v1 contracts, JSON Schemas, and PostgreSQL models are valid and aligned.
2. Two isolated clean migration targets pass from the full Phase 10 baseline.
3. All hierarchy, lifecycle, publication, reference, scoring, finalization, immutability, authorization, and audit invariants are implemented and tested at the required layers.
4. Assessment creation/revision services are tenant-safe, atomic, idempotent, deterministic, and historically immutable.
5. All Phase 10 regressions pass.
6. All Phase 20 tests execute with zero skips.
7. Every mandatory quality, contract, migration, integration, architecture, and build gate exits 0.
8. TD-008 documentation is corrected with reviewable evidence.
9. No Phase 30+ functionality or architectural redesign is present.
10. A full local commit hash identifies the exact reviewed implementation.

## 16. Required implementation report

Rewrite or extend `docs/phases/20-implementation-report.md` into a complete, internally consistent handoff containing:

1. Executive summary and exact branch/full commit hash.
2. Files changed and responsibility map.
3. Entity/relationship and lifecycle summary.
4. Revision-construction/finalization mechanism.
5. Complete invariant matrix identifying Zod/domain/service/database enforcement.
6. Contract and JSON Schema artifact inventory with versions.
7. Authorization operation matrix and bidirectional tenant evidence.
8. Exact scoring representation and proof for all tree relationships.
9. Curriculum and Assessment audit behavior and redaction evidence.
10. One row for each of the 20 acceptance criteria with status and exact evidence.
11. Exact verification commands, exit codes, test counts, skip counts, PostgreSQL version, and both clean migration targets.
12. Deviations, if any, with explicit justification.
13. Proposed ADRs, if any, clearly labeled as proposals rather than adopted decisions.
14. Technical-debt candidates and risk changes for permanent-architect review.
15. Documentation state and TD-008 exit evidence.
16. Environment limitations that remain after using the bundled runtime.

Do not edit `docs/phases/20-phase-review.md` or mark the project state, risk register, technical-debt register, or ADR log as approved/closed. Those are controlled by the permanent architecture session.

## 17. Completion behavior

Continue until the complete remediation objective is achieved and verified. Do not stop after repairing compilation, creating tables, or making existing regression tests pass.

When finished:

1. Confirm the final diff contains no accidental generated/build output or unrelated changes.
2. Create the intentional local commit on `codex/phase-20-remediation`.
3. Do not push or begin Phase 30.
4. Return only the concise handoff summary, the implementation-report path, full commit hash, complete gate summary, deviations, and any genuine unresolved blocker.
5. Return the work to the permanent architecture session for Phase 20 re-review.
