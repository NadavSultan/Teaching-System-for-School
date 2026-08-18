# Phase 20 Remediation Continuation Prompt — Complete the Domain

Continue the existing Phase 20 implementation in the current repository. This is not a new phase and not a request for another partial scaffold.

## Authority and required outcome

The permanent architecture session reviewed the first remediation attempt in:

- `docs/phases/20-phase-re-review.md`

The verdict remains:

> **REQUIRES FIXES – Do not proceed yet**

The reviewed result was 2 PASS, 6 PARTIAL, and 12 FAIL. The first attempt repaired compilation and migration syntax, but did not implement the actual Curriculum and Assessment domain behavior.

Your assignment is to continue from the current dirty working tree and complete every remaining Phase 20 requirement. Do not begin Phase 30. Do not stop after generic build, migration, or Phase 10 regression tests pass. Those gates already pass and are not evidence that Phase 20 works.

Do not declare Phase 20 approved. Return the completed implementation to the permanent architecture session for re-review.

## Read before editing

Read these files completely and treat them as binding:

1. `docs/phases/20-remediation-master-prompt.md`
2. `docs/phases/20-phase-re-review.md`
3. `docs/phases/20-master-implementation-prompt.md`
4. `docs/phases/20-implementation-report.md`
5. `docs/architecture/system-architecture-v1.md`
6. `docs/architecture/decision-log.md`
7. `docs/architecture/project-state.md`
8. `docs/architecture/technical-debt-register.md`
9. `docs/architecture/risk-register.md`
10. `docs/phases/10-phase-re-review.md`
11. Existing Prisma migrations/schema, database services/tests, contracts/generator/tests, domain code/tests, authorization code/tests, API integration tests, CI workflow, and every applicable `AGENTS.md`.

The detailed requirements in the Phase 20 remediation master prompt remain in force. This continuation prompt identifies the exact unfinished work and the order in which to complete it.

## Preserve the current worktree

The current repository state is:

- Branch: `main`
- HEAD: `4502bbd70ed74b80c7a9c8024ca43ac82cc9a5f8`
- Phase 20 implementation and architecture documents are uncommitted.
- The Phase 20 migration is uncommitted and has not been deployed outside disposable local test databases.

Rules:

1. Record `git status`, branch, HEAD, and the current diff before editing.
2. Do not reset, clean, stash, discard, or overwrite existing changes.
3. Create `codex/phase-20-remediation` while preserving the dirty working tree. If Git metadata permissions fail, request scoped approval. Do not abandon implementation because branch creation initially fails.
4. Never rewrite the two Phase 10 migrations.
5. You may rewrite the uncommitted/unapplied Phase 20 migration into one coherent migration.
6. Do not push, merge, open a pull request, or alter remote state.
7. Do not edit the architectural verdict in `20-phase-review.md` or `20-phase-re-review.md`.

## Current verified baseline

The following now work and must remain working:

- Prisma Client generation.
- Typecheck across 9 packages.
- Build across 9 packages.
- Five Phase 20 JSON Schema artifacts and byte-drift generation.
- Three migrations applied to `teaching_test` and `teaching_clean`.
- Existing Phase 10 integration suite: 3 files, 20 tests, zero skips.
- Existing unit suite: 9 files, 26 tests, of which only two small tests cover Phase 20.

The current implementation report fails Prettier. Fix it before final verification.

## What is still missing

The following are release blockers, not optional follow-ups:

1. Complete aligned contracts, Prisma models, and SQL migration.
2. Curriculum application services and database enforcement.
3. Atomic Assessment services and `BUILDING → FINALIZED` construction.
4. Published/same-version Curriculum reference enforcement.
5. Database immutability for published Curriculum and finalized Assessment graphs.
6. Complete exact scoring, including nested and rubric scoring.
7. Explicit Assessment authorization and bidirectional tenant isolation.
8. Safe Phase 20 audit events.
9. Complete unit/property/PostgreSQL/direct-database/concurrency tests.
10. TD-008 Phase 10 report consolidation.
11. A complete implementation report with one row per criterion.
12. A reviewable local branch and commit hash.

## Execution order

Complete the work in the following order. Do not hand off between work packages.

### Work package 1 — Align contracts, Prisma, and migration

First define one coherent model and make all three layers match.

#### Contracts

Keep Curriculum and Assessment schema versions at `1.0.0`.

Add or complete strict Zod contracts and JSON Schema artifacts for:

- Curriculum hierarchy import.
- Published Curriculum hierarchy response.
- Assessment creation input.
- Assessment summary response.
- Assessment revision creation input.
- Complete finalized Assessment revision response.
- Deterministic score-validation result.

Requirements:

- No Prisma types/enums, JavaScript `Date`, or persistence-only `BUILDING` state in external contracts.
- Derive organization authority from trusted context rather than trusting a body organization ID.
- Bound every string, array, hierarchy depth, nested collection, and metadata payload.
- Use UUID strings and integer score units.
- Add stable answer keys and deterministic answer order.
- Add stable rubric keys and deterministic rubric order.
- Include generated IDs in response contracts.
- Complete runtime accept/reject tests for every new contract, not only drift generation.
- Generate and commit every artifact.

#### Prisma and migration alignment

The current Prisma schema omits fields that exist in the migration. Fix that divergence. Include the required lifecycle/audit/timestamp/description/instruction/difficulty/identity/finalization fields in both representations.

Use readable multi-line Prisma models with explicit database mappings, lengths, indexes, unique constraints, and `onDelete: Restrict` behavior.

Add an internal Assessment revision state:

- `BUILDING`
- `FINALIZED`

Also add a deterministic idempotency request fingerprint. Neither field is exposed as teacher-editable revision content.

Answers and rubrics must persist their contract identities and ordering. Do not keep a contract `key/text` shape mapped to an unrelated anonymous `answerData` row without a documented lossless mapping.

Run Prisma format, validation, generation, typecheck, and build before continuing.

### Work package 2 — Implement PostgreSQL invariant enforcement

Critical invariants require database enforcement. Application validation alone is insufficient.

#### Curriculum constraints and triggers

Implement named, tested database enforcement for:

- `GRADE` root with no parent.
- `DOMAIN → GRADE`.
- `TOPIC → DOMAIN`.
- `SUBTOPIC → TOPIC`.
- `SKILL → SUBTOPIC`.
- Parent and child in the same CurriculumVersion.
- Root and non-root sibling code uniqueness.
- Root and non-root sibling order uniqueness, accounting correctly for PostgreSQL nullable-column uniqueness.
- Skill-only difficulty links and one row per skill/band.
- Valid lifecycle transitions only: `DRAFT → PUBLISHED → DEPRECATED`.
- Publication rejection for an empty or structurally invalid hierarchy.
- Published/deprecated node and difficulty content cannot be inserted, updated, moved, or deleted.
- Deprecation changes lifecycle metadata only.

Strict typed parent transitions make cycles impossible, but include an explicit rejection test.

#### Assessment construction and immutability

Implement the approved mechanism exactly:

1. Create an AssessmentRevision as `BUILDING` inside one transaction.
2. Insert the complete graph in that transaction.
3. Validate all references, identities, targets, ordering, and scores.
4. Transition to `FINALIZED` before commit.
5. Use deferred database enforcement so `BUILDING` cannot be committed.
6. Repository reads return only `FINALIZED` revisions.
7. After finalization, reject update/delete of the revision and insert/update/delete anywhere in its graph.

Add named database enforcement for:

- Revision-number uniqueness and monotonic service creation.
- Idempotency-key uniqueness per Assessment.
- Published CurriculumVersion at finalization.
- Every linked node belongs to that exact CurriculumVersion.
- Answer/rubric exactly-one-target XOR.
- Stable key/order uniqueness for every nested collection, including partial unique indexes under question or subquestion targets.
- Non-negative integer scores at or below `MAX_SCORE_UNITS`.
- Exact score-tree validation at finalization.

Direct SQL attempts must not be able to bypass these rules.

### Work package 3 — Complete pure domain validation

Keep pure rules framework-light in `packages/domain`.

Implement and test:

- Full hierarchy transition matrix.
- Duplicate sibling code/order detection at every level.
- Code format, hierarchy depth, total-size, invalid difficulty, and cycle rejection.
- Curriculum lifecycle transition matrix.
- `SCORE_UNIT_SCALE = 100`.
- `MAX_SCORE_UNITS = 1_000_000`.
- `TEST` requires `POINTS` and defaults to 10,000 units when omitted.
- `WORKSHEET` accepts `NONE` or `POINTS`.
- `NONE` requires null revision, section, question, subquestion, and rubric scores.
- `POINTS` requires exact revision/section/question/subquestion sums.
- A question with subquestions equals their sum.
- A question without subquestions owns its score directly.
- If rubric scores are present, every rubric for the target is scored and sums to the target; otherwise all are null.
- Reject negative, overflow, non-integer, missing, mixed-null, and inconsistent values.

The current two Phase 20 unit tests are insufficient. Replace or expand them into a meaningful matrix plus deterministic generated/property cases.

### Work package 4 — Implement transaction services

Keep pure validation in `packages/domain` and Prisma transaction/repository code in `packages/db`.

Implement Curriculum services equivalent to:

- `createCurriculumWithDraft`
- `importCurriculumDraft`
- `publishCurriculumVersion`
- `deprecateCurriculumVersion`
- `getPublishedCurriculum`

Required behavior:

- Draft import is one atomic transaction.
- Version allocation is concurrency-safe.
- Publication and deprecation write safe audit events.
- Published reads are deterministic by explicit order.
- Ordinary teacher paths cannot mutate Curriculum.

Implement Assessment services equivalent to:

- `createAssessment`
- `createAssessmentRevision`
- `getAssessmentRevision`

Required behavior:

- Receive trusted `AccessContext`; never derive authority from request-body ownership fields.
- Scope every public Assessment repository/service operation by trusted organization.
- Lock the stable Assessment row or use an equivalently proven mechanism when allocating the next revision number.
- Canonicalize semantic revision input and store a SHA-256 request fingerprint.
- Same Assessment + same idempotency key + same fingerprint returns the existing finalized revision.
- Same key + different fingerprint returns a safe conflict.
- Graph creation and finalization use one transaction.
- Reload is lossless and deterministically ordered.
- Previous revisions never change.
- Inaccessible and missing Assessment results are non-disclosing.

Do not add generic unscoped Assessment repository functions that allow callers to forget tenant filtering.

### Work package 5 — Authorization and safe audits

Add explicit operations:

- `CREATE_ASSESSMENT`
- `READ_ASSESSMENT`
- `CREATE_ASSESSMENT_REVISION`

Allow active `TEACHER`, `COORDINATOR`, and `SCHOOL_ADMIN` memberships only inside their trusted active organization. Personal Workspace teachers remain scoped to their Personal organization. `PLATFORM_ADMIN` has no implicit tenant-content access. Deny inactive users, memberships, and organizations.

Add bidirectional tests between two organizations for read and write behavior.

Write safe audit events for:

- Curriculum publication.
- Curriculum deprecation.
- Assessment creation.
- Assessment revision finalization.

Audit metadata may include IDs, lifecycle transition, schema version, and revision number. It must not include assessment content, questions, answers, rubrics, credentials, tokens, student data, or request bodies.

Do not add Outbox events unless an actual Phase 20 consumer exists. Document the decision not to emit them if no consumer exists.

### Work package 6 — Add real Phase 20 PostgreSQL tests

The current integration suite only proves that Phase 10 still works after the new migration. Add Phase 20 integration files that exercise the new tables and services.

Required PostgreSQL evidence:

- Draft Curriculum creation and atomic hierarchy import.
- Every invalid hierarchy form rejected.
- Atomic publication and legal deprecation.
- Direct update/delete/late-insert rejection after publication.
- Cross-version parent and difficulty-target rejection.
- Assessment creation in two tenants.
- Atomic complete graph creation and deterministic reload.
- Same-key idempotent retry.
- Same-key/different-payload conflict.
- Concurrent monotonic revision creation.
- `BUILDING` cannot commit or become readable.
- Finalized revision and every child type reject direct insert/update/delete.
- Unpublished CurriculumVersion reference rejection.
- Cross-version node-link rejection.
- Existing revision remains readable after Curriculum deprecation.
- Exact score validation at finalization using valid and invalid direct-database cases.
- Bidirectional cross-tenant read/write denial.
- Safe audit metadata.

Every test must execute against PostgreSQL. Zero silent skips are permitted.

The existing local harness must continue applying all migrations to both `teaching_test` and `teaching_clean`.

### Work package 7 — Correct documentation and prepare the handoff

#### TD-008

Consolidate `docs/phases/10-implementation-report.md` so its opening/current status reflects the final successful Phase 10 remediation. Preserve the original failed attempt as clearly labeled historical evidence. Do not change the permanent Phase 10 verdict or close TD-008 in the register yourself.

#### Phase 20 report

Rewrite `docs/phases/20-implementation-report.md`; do not append another small “verified gates” section to the incomplete report.

The final report must contain:

1. Executive summary.
2. Branch and full commit hash.
3. Files/responsibility map.
4. Entity/lifecycle/finalization design.
5. Complete invariant-enforcement matrix by Zod/domain/service/database.
6. Contract and JSON Schema inventory.
7. Authorization operation matrix.
8. Tenant-isolation evidence.
9. Exact-scoring evidence.
10. Audit/redaction evidence.
11. One separate row for each of the 20 original acceptance criteria.
12. Exact commands, exit codes, test-file/test/skip counts, PostgreSQL version, and both migration targets.
13. Deviations, proposed ADRs, debt candidates, risk changes, and environment limitations.
14. TD-008 exit evidence.

Do not mark the phase approved.

## Required verification sequence

Use the bundled Node 24 runtime and pnpm 11.19 with `CI=true` if they are not already on `PATH`.

Run all of the following after implementation is complete:

1. `pnpm install --frozen-lockfile`
2. Prisma format, validate, and generate for `@teach/db`
3. `pnpm format-check`
4. `pnpm lint`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm contracts:check`
8. `pnpm test:architecture`
9. `pnpm test-integration:local`
10. Confirm the separately isolated `teaching_clean` migration result
11. `pnpm build`
12. `git diff --check`

Record exact final results. If any gate fails, fix it and rerun the complete sequence. The report must be written and formatted before the final `format-check`; do not quote a passing format result obtained before editing the report.

## Completion gate

Do not return another `PARTIAL — remediation in progress` handoff unless a genuine external blocker remains after exhausting safe in-scope remedies.

The task is complete only when:

- All 20 acceptance criteria can be supported as PASS with executable evidence.
- All required Phase 20 services and database protections exist.
- Phase 20 unit/property/integration/security tests execute with zero skips.
- Contracts, Prisma, and migration are aligned.
- Every mandatory command exits 0 after the final documentation edit.
- The work exists on `codex/phase-20-remediation` in one intentional local commit.
- The full commit hash is recorded in the implementation report.

When complete, stop. Do not push and do not start Phase 30. Return the report path, full commit hash, test/migration summary, deviations, and any genuine unresolved blocker to the permanent architecture session.
