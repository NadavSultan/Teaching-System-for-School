# Phase 60 Control Pack — Teacher Workspace and Approval

Status: **AUTHORIZED FOR IMPLEMENTATION PREPARATION**

## Identity and authority

- Repository: `NadavSultan/Teaching-System-for-School`
- Exact implementation branch: `codex/phase-60-teacher-workspace`
- Starting commit: `eb94f524435c0ecd58277649ef33d07ff9c51624`
- Approved predecessor: Phase 50 at `6aa268836b3d4ac7e13b7d4db6bd35c890e3992e`, closed by the independent-review commit above.
- Current phase: Phase 60 only.
- Phase 70 and every later phase remain blocked until independent Phase 60 approval.
- Pilot: Hebrew language, Grade 8, worksheet-first manual QA.
- Final Phase 60 product scope: data-driven Hebrew-language workflows for Grades 7, 8, and 9, using the approved curriculum and eligible learning materials for each grade.

## Binding product rule for Grades 7–9

Grade 8 is only the first manual-QA fixture. Production code must not contain Grade-8-specific branches, labels, topic lists, source substitutions, prompt substitutions, or validation exceptions. Grade, domain, topic, subtopic, and skill choices come from the persisted published curriculum hierarchy. Generation and regeneration may use only eligible source material linked to the selected persisted curriculum nodes.

If a selected Grade 7, 8, or 9 scope has no sufficient eligible material, the operation returns the existing safe insufficient-context outcome. It must never borrow another grade's material, silently widen scope, use model memory as an approved source, or embed invented learning content in the UI.

## Governing documents and protected interfaces

Read these files completely before editing:

1. `docs/architecture/system-architecture-v1.md`
2. `docs/architecture/project-state.md`
3. `docs/architecture/decision-log.md`
4. `docs/architecture/risk-register.md`
5. `docs/phases/50-phase-review.md`
6. `docs/phases/50-phase-control-pack.md`
7. `docs/phases/50-implementation-report.md`
8. `docs/runbooks/phase-50-validation.md`
9. all Phase 10–50 migrations and upgrade scripts
10. Phase 20 assessment contracts, persistence, immutability tests, and scoring tests
11. Phase 30 source eligibility, retrieval, and tenant tests
12. Phase 40 generation/regeneration contracts, persistence, and concurrency tests
13. Phase 50 validation/readiness/acknowledgement contracts, persistence, and tests
14. `docs/phases/60-master-gate-baseline.md`
15. `docs/phases/60-manual-qa-plan.md`
16. `tests/phase60-acceptance-manifest.json`
17. `tests/phase60-master-control.test.ts`
18. `scripts/verify-phase60-control.mjs`

The following are protected and must not be weakened, replaced, reformatted, or edited during implementation:

- all 15 existing migrations through `20260826005000_phase50_validation_engine`;
- Phase 20 finalized-revision and descendant immutability;
- Phase 30 source approval, permission, lifecycle, provenance, and tenant eligibility;
- Phase 40 generation lineage, stable unaffected snapshots, idempotency, and provider-neutral boundaries;
- Phase 50 deterministic rules, semantic evidence, warning acknowledgements, terminal evidence boundaries, readiness, and `assert_revision_approvable`;
- `docs/phases/50-phase-review.md` and every Phase 60 preparation/control artifact listed above;
- the dependency boundary that prevents `apps/web` from importing database/domain/AI implementations.

## Objective

Deliver a complete, accessible Hebrew RTL teacher workspace that lets an authorized teacher create, review, edit, reorder, add, delete, and regenerate assessment content through immutable revisions; inspect validation findings; acknowledge eligible semantic warnings; review revision history; and explicitly approve exactly one persisted revision through the Phase 50 database-backed readiness boundary.

At the end of Phase 60, the user must be able to run a local Grade 8 Hebrew-language worksheet journey manually in a browser. The same application services and UI must support Grades 7–9 from persisted curriculum/source data.

## In scope

- Strict Phase 60 contracts and generated JSON Schema snapshots.
- A forward-only Phase 60 migration and Prisma schema additions.
- Stable logical question identity across assessment revisions.
- Persisted edit lineage from a new revision to its base revision.
- Append-only approval records for an exact immutable revision.
- Database-enforced approval authorization, readiness, identity, idempotency, sequence, and immutability.
- Assessment list, detail, revision-history, editor-save, regenerate, validation, acknowledgement, readiness, and approval application services.
- Versioned HTTP API endpoints using persisted trusted access context.
- A responsive Next.js Hebrew RTL teacher workspace.
- Configuration, editor, student-safe preview, findings panel, revision history, and approval UX.
- Deterministic local fixtures for Grades 7–9; Grade 8 is the manual pilot.
- Component/source, API, database, concurrency, authorization, rendered-browser, accessibility, and E2E tests.
- A local manual-QA command/runbook with deterministic seeded data.
- Full regression, staged `05000 -> 06000` upgrade, clean install, isolated drift, and report.

## Explicitly out of scope

- Phase 70 rendering, PDF/DOCX, object storage, signed downloads, print templates, fonts, or visual PDF QA.
- Collaboration, simultaneous multi-user editing, comments, sharing, question banks, admin/role management, students, submissions, grading, analytics, billing, deployment, or production operations.
- Real provider SDKs, paid/network model calls, provider selection, embeddings, vector search, open-web retrieval, or enabling live evaluation.
- Authoritative curriculum or source content invented by implementation code.
- Never mutate a finalized assessment revision or approved evidence. Editing always creates a new immutable revision.
- CSS-hidden teacher answers in student preview. Student preview must be constructed from a student-safe view model that never contains answers, explanations, rubrics, or internal notes.
- Self-approval, push, merge, deployment, or Phase 70 work by the executor.

## Required data model and migration

Create exactly one new forward-only migration:

`packages/db/prisma/migrations/20260903006000_phase60_teacher_workspace_approval/migration.sql`

Final migration count: exactly 16.

Required additions:

1. A stable logical question identity stored on every `AssessmentQuestion`. Existing questions are backfilled deterministically from their current UUID. New questions receive a new identity; carried-forward and regenerated forms of the same logical question retain it.
2. A nullable base-revision relation for every new teacher-authored revision. Existing rows remain valid. A Phase 60 teacher edit must reference a base revision in the same assessment and tenant.
3. An append-only approval entity containing at least: organization, assessment, assessment revision, validation run, approving user, approval sequence, idempotency key, request fingerprint, contract/version stamps, and creation time.
4. Unique constraints for one approval per exact revision, monotonic approval sequence per assessment, and actor-scoped idempotency.
5. Required indexes for tenant assessment lists, deterministic revision history, latest approval, and stable question identity.
6. Database guards/triggers that reject forged ownership, cross-assessment links, cross-revision validation runs, inactive authority, platform context, stale/nonlatest revision approval, nonready validation, update/delete of approvals, duplicate/conflicting idempotency, and invalid sequence.
7. The approval insert must call or enforce the Phase 50 `assert_revision_approvable` boundary inside the same transaction. Application-only readiness checks are insufficient.
8. A new teacher revision and an approval must serialize on the owning assessment. A concurrent newer revision must make a stale approval fail safely rather than approving an obsolete revision accidentally.
9. Existing finalized-revision content immutability remains unchanged. Editing means constructing and atomically finalizing a new snapshot.

No historical migration may be edited. No schema change may weaken inherited constraints or triggers.

## Contracts

Add `packages/contracts/src/phase60.ts`, export it from the package index, extend schema generation, and create exact generated schemas for:

- assessment list item/list response;
- teacher workspace/revision history;
- editor save request/result;
- question regeneration request/status/result;
- student-safe preview;
- approval request/result/status.

All boundary objects are strict. IDs are UUIDs, versions are literals, text is normalized and bounded, order is integer and deterministic, scoring uses integer score units, and idempotency keys are bounded. Client-supplied organization, actor, approval sequence, validation verdict, readiness verdict, source eligibility, or audit fields are prohibited.

## Operation catalog

| ID  | Operation                   | Trusted context and authorization                                                           | Transaction/idempotency                                                                      | Response and failure                                                 | Audit                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| O1  | List assessments            | Reload persisted user/membership/organization; `READ_ASSESSMENT`                            | Read-only deterministic cursor/order                                                         | Tenant-only summaries; no foreign existence disclosure               | none                                                            |
| O2  | Get teacher workspace       | Same; tenant owns assessment/revision                                                       | Consistent snapshot                                                                          | Exact selected/latest revision, history, validation, approval status | none                                                            |
| O3  | Create assessment           | Persisted active teacher/coordinator/admin; existing Phase 20 policy                        | Existing create idempotency extended if required                                             | Strict assessment result or safe conflict                            | `assessment.created`                                            |
| O4  | Save edited revision        | Persisted active teacher/coordinator/admin; owned base revision                             | Serializable; assessment lock; exact base/latest precondition; actor idempotency/fingerprint | New finalized immutable revision; `409` for stale/conflict           | `assessment.revision.edited` with IDs and operation counts only |
| O5  | Regenerate one question     | Same; owned latest revision and stable question identity                                    | Existing Phase 40 request semantics; no partial revision                                     | Existing run/status/result contracts; safe insufficient context      | inherited generation audit                                      |
| O6  | Request/get validation      | Same; owned finalized revision                                                              | Existing Phase 50 semantics                                                                  | Existing strict status/result                                        | inherited validation audit                                      |
| O7  | Acknowledge warning         | Same; owned warning and run                                                                 | Existing Phase 50 semantics                                                                  | Existing acknowledgement contract                                    | inherited acknowledgement audit                                 |
| O8  | Get readiness               | Same; owned revision                                                                        | Read-only, non-disclosing                                                                    | Existing Phase 50 readiness contract                                 | none                                                            |
| O9  | Approve revision            | New `APPROVE_ASSESSMENT_REVISION` policy; persisted active authority; latest owned revision | Serializable; lock assessment; exact idempotency/fingerprint; database readiness assertion   | Immutable approval or same approval; safe `404/409/422` mapping      | `assessment.revision.approved` with safe IDs/versions           |
| O10 | Get approval history/status | Persisted tenant read authority                                                             | Deterministic approval sequence                                                              | Tenant-only immutable history/current approval                       | none                                                            |

HTTP controllers must only parse transport data and map reviewed safe errors. They must not contain domain, grade, source, scoring, validation, or approval decisions.

## Revision/edit rules

- Every edit request names `assessmentId`, exact `baseRevisionId`, exact `baseRevisionNumber`, idempotency key, and a complete strict target snapshot or an explicitly versioned operation list.
- The server reloads the authoritative base snapshot and never trusts client ownership, revision state, source links, validation state, or approval state.
- The base must be the latest finalized revision when saving. A stale base returns a deterministic conflict containing no foreign data.
- Add/edit/delete/reorder operations are applied to stable logical identities, not array indexes alone.
- Unchanged questions preserve stable identity and their exact content, answer, rubric, score, and source-link set.
- Regeneration changes only the selected logical question and its reviewed lineage; unrelated content is byte/canonical-value identical.
- Delete removes content only from the new snapshot. Historical revisions remain intact.
- New or edited revisions start unvalidated and unapproved. Validation and approval evidence never carries forward silently.
- Saving an identical request with the same key returns the same revision. Same key plus different canonical content fails safely.
- Score validation and hierarchy validation execute before commit; no partial `BUILDING` graph can commit.

## Approval lifecycle

| State                                        | Approval allowed | Required behavior                                              |
| -------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| Missing/foreign revision                     | NO               | Non-disclosing not-found/unavailable; zero approval/audit rows |
| Nonlatest finalized revision                 | NO               | Safe stale-revision conflict; zero approval/audit rows         |
| Latest revision without validation           | NO               | `VALIDATION_REQUIRED`; zero approval/audit rows                |
| Validation pending/processing                | NO               | Exact readiness reason; zero approval/audit rows               |
| Validation failed or structurally incomplete | NO               | Exact blocking reason; zero approval/audit rows                |
| Blocking deterministic/semantic finding      | NO               | Exact blocking reason; zero approval/audit rows                |
| Unacknowledged semantic warning              | NO               | `WARNING_ACKNOWLEDGEMENT_REQUIRED`                             |
| Eligible source changed after validation     | NO               | `SOURCE_ELIGIBILITY_CHANGED`                                   |
| Complete current READY validation            | YES              | One immutable approval and one audit event                     |
| Already approved, same key/fingerprint       | IDEMPOTENT       | Return the exact existing approval; no duplicate audit         |
| Already approved, conflicting key/content    | NO               | Safe conflict; existing approval unchanged                     |
| Concurrent edit versus approval              | SERIALIZED       | At most the latest revision is approved; no stale success      |
| Concurrent same-revision approval            | SERIALIZED       | One approval row and one audit event                           |

An approved revision remains immutable. A later edit creates a newer unapproved revision; the historical approval remains traceable. Phase 70 must later receive an exact approval/revision identity and must not infer approval from a UI flag.

## Acceptance matrix

Every case ID below must appear exactly once in a permanent Phase 60 test name. Each case requires its own arrangement and direct assertions; callback/proxy tables that merely iterate IDs are prohibited. Total required cases: **125**.

### K — Contracts and boundary schemas (8)

| ID  | Required behavior                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| K01 | Every Phase 60 request/response accepts one exact valid fixture.                                                           |
| K02 | Unknown keys are rejected at every Phase 60 boundary.                                                                      |
| K03 | UUID, version, text-length, order, score-unit, and idempotency limits reject exact invalid fixtures.                       |
| K04 | Editor input cannot supply organization, actor, revision number, state, provenance, validation, approval, or audit fields. |
| K05 | Approval input cannot supply readiness/verdict, approver, sequence, tenant, timestamps, or version evidence.               |
| K06 | Student preview schema has no answer, explanation, rubric, internal-note, or teacher-only property at any depth.           |
| K07 | Generated JSON Schemas exactly match committed Phase 60 artifacts and strictness.                                          |
| K08 | Contract mapping preserves stable question identities, ordering, nullability, and integer score units losslessly.          |

### E — Immutable editor and revision behavior (18)

| ID  | Required behavior                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------ |
| E01 | Saving a valid title/instruction edit creates revision N+1 and leaves N byte/canonically unchanged.    |
| E02 | Editing question prompt creates a new snapshot and preserves its stable logical identity.              |
| E03 | Editing answer/explanation affects only the target in the new revision.                                |
| E04 | Editing rubric text/score affects only the target in the new revision.                                 |
| E05 | Adding a section creates a new stable section graph with deterministic order.                          |
| E06 | Deleting a section removes it only from the new revision.                                              |
| E07 | Reordering sections is deterministic and preserves their content.                                      |
| E08 | Adding a question assigns a new stable identity and deterministic position.                            |
| E09 | Deleting a question removes it only from the new revision.                                             |
| E10 | Reordering questions preserves stable identity, content, answers, rubrics, scores, and source links.   |
| E11 | Adding/editing/deleting/reordering a subquestion creates a valid immutable new graph.                  |
| E12 | Valid worksheet edit with `NONE` scoring succeeds.                                                     |
| E13 | Valid 100-point test edit succeeds using exact integer units.                                          |
| E14 | Invalid score total/child/rubric sum fails before commit with zero partial rows.                       |
| E15 | Duplicate keys/orders/stable identities fail before commit with zero partial rows.                     |
| E16 | Missing/unpublished/wrong-version curriculum links fail safely with zero partial rows.                 |
| E17 | Identical save retry returns the same revision and one edit audit.                                     |
| E18 | Same idempotency key with changed canonical content fails and preserves both history and audit counts. |

### G — Grades 7–9 and source-data isolation (9)

| ID  | Required behavior                                                                                 |
| --- | ------------------------------------------------------------------------------------------------- |
| G01 | Grade 7 hierarchy is read from a published persisted curriculum and renders without code changes. |
| G02 | Grade 8 hierarchy is read from the same generic operation and supports the pilot journey.         |
| G03 | Grade 9 hierarchy is read from the same generic operation and renders without code changes.       |
| G04 | Grade 7 generation context contains only eligible Grade 7 linked items.                           |
| G05 | Grade 8 generation context contains only eligible Grade 8 linked items.                           |
| G06 | Grade 9 generation context contains only eligible Grade 9 linked items.                           |
| G07 | Missing Grade 7 material returns insufficient context and never uses Grade 8/9 material.          |
| G08 | Missing Grade 8 material returns insufficient context and never uses Grade 7/9 material.          |
| G09 | Missing Grade 9 material returns insufficient context and never uses Grade 7/8 material.          |

### V — Validation and findings workflow (12)

| ID  | Required behavior                                                                            |
| --- | -------------------------------------------------------------------------------------------- |
| V01 | Newly edited revision is unvalidated and displays `VALIDATION_REQUIRED`.                     |
| V02 | Validation request from the UI/API persists one run/outbox/audit with ID-only payload.       |
| V03 | Pending validation displays a non-success pending state and disables approval.               |
| V04 | Processing validation displays a non-success processing state and disables approval.         |
| V05 | Failed evaluation displays the reviewed safe failure state and disables approval.            |
| V06 | Deterministic blocking findings are path-mapped to the exact editor element.                 |
| V07 | Semantic blocking findings are path-mapped and cannot be acknowledged as warnings.           |
| V08 | Semantic warnings display severity/category/message without exposing unsafe evidence.        |
| V09 | One eligible warning acknowledgement updates readiness and writes one inherited audit event. |
| V10 | Acknowledgement retry is idempotent; conflicting reason/key fails safely.                    |
| V11 | A new revision never inherits the prior revision's validation run or acknowledgements.       |
| V12 | Source eligibility change after a passing run immediately blocks approval in the UI/API.     |

### A — Explicit approval behavior (16)

| ID  | Required behavior                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------- |
| A01 | READY latest revision approval creates one immutable approval with exact revision/run/actor/version identity.        |
| A02 | Approval creates exactly one safe audit event after the approval insert succeeds.                                    |
| A03 | Same request/key/fingerprint returns the exact same approval and no second audit.                                    |
| A04 | Same key with changed content returns conflict and leaves approval/audit unchanged.                                  |
| A05 | Missing validation is rejected with zero approval/audit rows.                                                        |
| A06 | Pending/processing validation is rejected with zero approval/audit rows.                                             |
| A07 | Failed/incomplete validation is rejected with zero approval/audit rows.                                              |
| A08 | Deterministic blocker is rejected with zero approval/audit rows.                                                     |
| A09 | Semantic blocker is rejected with zero approval/audit rows.                                                          |
| A10 | Unacknowledged warning is rejected; acknowledged warning can proceed.                                                |
| A11 | Source eligibility change is rejected with zero approval/audit rows.                                                 |
| A12 | Nonlatest revision approval is rejected even when its old validation was READY.                                      |
| A13 | Approval of a revision belonging to another assessment is rejected without disclosure.                               |
| A14 | Approved revision/history returns exact immutable approval evidence to authorized reads.                             |
| A15 | Later edit creates an unapproved latest revision while preserving the historical approval.                           |
| A16 | Student-safe preview and future export eligibility use the exact approved revision, not the latest draft implicitly. |

### T — Persisted authorization and tenant isolation (14)

| ID  | Required behavior                                                                                 |
| --- | ------------------------------------------------------------------------------------------------- |
| T01 | Tenant A cannot list Tenant B assessments.                                                        |
| T02 | Tenant B cannot list Tenant A assessments.                                                        |
| T03 | Tenant A cannot read Tenant B workspace/revision/history.                                         |
| T04 | Tenant B cannot read Tenant A workspace/revision/history.                                         |
| T05 | Tenant A cannot edit/regenerate/validate/acknowledge/approve Tenant B data.                       |
| T06 | Tenant B cannot edit/regenerate/validate/acknowledge/approve Tenant A data.                       |
| T07 | Missing and foreign assessment/revision return the same non-disclosing transport shape.           |
| T08 | Active TEACHER may execute the Phase 60 teacher workflow in its tenant.                           |
| T09 | Active COORDINATOR may execute the workflow under the inherited policy.                           |
| T10 | Active SCHOOL_ADMIN may execute the workflow under the inherited policy.                          |
| T11 | PLATFORM_ADMIN workspace context cannot execute tenant teacher operations.                        |
| T12 | Inactive user is rejected after persisted reload, despite a forged active client context.         |
| T13 | Inactive membership is rejected after persisted reload, despite a forged active client context.   |
| T14 | Inactive organization is rejected after persisted reload, despite a forged active client context. |

### C — Concurrency and idempotency (10)

| ID  | Required behavior                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- |
| C01 | Two simultaneous edits from the same latest base produce at most one accepted next revision.            |
| C02 | Losing stale edit returns a deterministic conflict and creates no partial graph/audit.                  |
| C03 | Two identical concurrent retries converge to one revision and one audit.                                |
| C04 | Two different payloads with the same key converge to one success plus one conflict.                     |
| C05 | Concurrent edit and approval serialize; no obsolete revision is approved accidentally.                  |
| C06 | Two identical concurrent approvals converge to one approval and one audit.                              |
| C07 | Concurrent approval of different revision identities cannot violate latest-revision policy.             |
| C08 | Concurrent reorder/add operations cannot allocate duplicate revision numbers, keys, or orders.          |
| C09 | Regeneration and manual save from the same base cannot silently overwrite each other.                   |
| C10 | Every concurrency case uses real overlapping promises/barriers and asserts final persisted cardinality. |

### U — Web UI, RTL, accessibility, and E2E (20)

| ID  | Required behavior                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| U01 | Root document is Hebrew `lang="he"` and RTL; no page overrides direction incorrectly.                                                |
| U02 | Assessment list loads deterministic tenant-owned summaries and a clear empty state.                                                  |
| U03 | New-document flow selects WORKSHEET/TEST and persisted Grade/Domain/Topic/Subtopic/Skill.                                            |
| U04 | Grade 8 Hebrew worksheet pilot configuration reaches the editor.                                                                     |
| U05 | Editor renders sections, questions, subquestions, answers, rubrics, scores, and instructions in deterministic order.                 |
| U06 | Add/edit/delete/reorder actions are keyboard accessible and visibly labeled.                                                         |
| U07 | Destructive edit action requires an in-product confirmation and affects only the new revision.                                       |
| U08 | Save displays pending/success/conflict/failure states without losing entered content.                                                |
| U09 | Regenerate-one-question displays pending/success/insufficient/failure and preserves unrelated content.                               |
| U10 | Findings panel displays exact severity/category/path and focuses the affected editor control.                                        |
| U11 | Approval remains disabled for every non-READY reason.                                                                                |
| U12 | Eligible warning acknowledgement has a labeled reason input and updates readiness.                                                   |
| U13 | Explicit approval confirmation identifies the exact revision and explains immutability.                                              |
| U14 | Successful approval visibly locks that exact revision and preserves history navigation.                                              |
| U15 | Student preview is produced from the student-safe contract and contains no teacher-only data in DOM/source.                          |
| U16 | Revision history is deterministic, identifies current/approved versions, and can open an older read-only snapshot.                   |
| U17 | Mixed Hebrew/English, punctuation, parentheses, numbers, and nikud render correctly at desktop and mobile widths.                    |
| U18 | Native keyboard order, visible focus, labels, headings, landmarks, announcements, and error summaries pass accessibility assertions. |
| U19 | No browser console error, unhandled rejection, hydration mismatch, failed request, or horizontal clipping in the pilot E2E.          |
| U20 | Full Grade 8 E2E completes create → edit → save → validate → acknowledge → approve and verifies persisted results after reload.      |

### D — Direct-database, audit, and security (10)

| ID  | Required behavior                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Direct forged approval with wrong tenant/assessment/revision identity is rejected with exact reviewed DB code/message.                                                 |
| D02 | Direct approval with a validation run for another revision is rejected.                                                                                                |
| D03 | Direct approval by missing/inactive/unauthorized persisted actor is rejected.                                                                                          |
| D04 | Direct approval of a nonlatest revision is rejected.                                                                                                                   |
| D05 | Direct approval with nonready/corrupt/incomplete Phase 50 evidence is rejected.                                                                                        |
| D06 | Direct update of any approval identity/evidence/timestamp is rejected.                                                                                                 |
| D07 | Direct delete of an approval is rejected.                                                                                                                              |
| D08 | Direct forged base-revision or stable-question identity across assessments/tenants is rejected.                                                                        |
| D09 | Audit metadata contains only safe IDs, counts, operation class, and version stamps; no prompts, answers, source text, tokens, secrets, cookies, or authorization data. |
| D10 | API/worker/client logs for success and failure satisfy the same redaction rule using captured real loggers.                                                            |

### F — Failure recovery and regression (8)

| ID  | Required behavior                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------ |
| F01 | Editor validation failure leaves no `BUILDING` revision or partial descendants.                                          |
| F02 | Database failure during graph creation rolls back revision, descendants, and audit together.                             |
| F03 | Regeneration failure leaves the base revision and current editor state intact.                                           |
| F04 | Validation request/poll failure remains retryable and never enables approval.                                            |
| F05 | Approval database failure rolls back approval and audit atomically.                                                      |
| F06 | Reload/reopen reconstructs the exact persisted latest draft, findings, acknowledgements, and approval history.           |
| F07 | `05000 -> 06000` staged upgrade preserves all Phase 10–50 rows and backfills stable question identity deterministically. |
| F08 | Clean 16-migration database and upgraded database have equivalent reviewed schema/catalog fingerprints and zero drift.   |

Expected matrix rows: **125**

Expected executed case IDs: **125/125**
Expected skipped/todo/only/expected-failure cases: **0**

## Required implementation files and surfaces

Expected production/control additions or updates include:

- `packages/contracts/src/phase60.ts` and Phase 60 generated schemas;
- `packages/domain/src/editor.ts` or an equivalently narrow pure editor module;
- `packages/db/src/teacher-workspace.ts` or an equivalently narrow application service;
- Prisma schema and the exact `06000` migration;
- reviewed Phase 60 API module/controllers/services under `apps/api/src`;
- teacher workspace routes/components/styles under `apps/web`;
- `scripts/phase60-upgrade-test.mjs`;
- `scripts/phase60-manual-qa.mjs` or equivalent deterministic local harness;
- `docs/runbooks/phase-60-teacher-workspace.md`;
- permanent tests implementing all 125 IDs;
- `docs/phases/60-implementation-report.md`, created only after the mechanical pre-report stop passes.

The implementation may add only these narrowly scoped dev/test dependencies after pinning exact versions and reviewing license/lockfile impact: `@playwright/test`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, and `@axe-core/playwright`. Add only packages actually used by permanent tests. Production runtime provider, editor-framework, state-management, CSS-framework, analytics, storage, or PDF dependencies require separate owner approval and are not authorized by this pack.

## Manual-QA requirement

Follow `docs/phases/60-manual-qa-plan.md`. The executor must provide one documented command that starts a disposable PostgreSQL database, applies all 16 migrations, seeds clearly labeled nonauthoritative Grade 7–9 test curriculum/source fixtures, starts API and web processes, and prints the local URL plus test-user identity. Cleanup must not delete user project data.

The first manual journey is Grade 8 Hebrew language and worksheet-first. The QA fixture is test data, not an authoritative Ministry curriculum and not production source content.

## Pre-mortem requirements

| Risk                                 | Prevention                                                           | Required evidence |
| ------------------------------------ | -------------------------------------------------------------------- | ----------------- |
| UI mutates finalized revision        | every edit creates a new full snapshot; inherited DB triggers remain | E01–E18, D08      |
| Lost update                          | base/latest precondition plus assessment lock                        | C01–C04, C08–C09  |
| Approval races with edit             | same assessment lock and latest-revision assertion                   | C05–C07           |
| Application bypasses readiness       | DB approval guard invokes Phase 50 assertion in transaction          | A05–A13, D01–D05  |
| Cross-tenant disclosure              | persisted context reload and bidirectional matrices                  | T01–T14           |
| Student answer leakage               | separate student-safe contract/view model, never CSS hiding          | K06, U15          |
| Grade/source mixing                  | persisted curriculum IDs and inherited eligibility; no fallback      | G01–G09           |
| Approval/evidence mutation           | append-only trigger and immutable historical revisions               | A14–A16, D06–D07  |
| Partial graphs/audits                | one transaction and deferred inherited finalization guards           | E14–E16, F01–F05  |
| Unsafe logs                          | real logger capture and forbidden-content assertions                 | D09–D10           |
| Migration damages history            | exact staged upgrade, backfill assertions, clean comparison          | F07–F08           |
| UI appears green without persistence | reload/reopen E2E with DB assertions                                 | U20, F06          |

## Mechanical pre-report stop

Before creating or editing `docs/phases/60-implementation-report.md`, all of the following must pass and their complete final output must be inspected:

1. `node scripts/verify-phase60-control.mjs` prints `PHASE60_CONTROL=STRUCTURAL_PASS`, `MATRIX_MANIFEST=125`, and `MIGRATION_COUNT=16`.
2. The Phase 60 master-control test passes all protected tests.
3. All 125 explicit permanent cases execute with no duplicated/missing ID and zero skips/todo/only/expected failure.
4. Focused Phase 60 contract/domain/API/database/UI/E2E tests pass.
5. `pnpm test-integration:local` passes the full Phase 10–60 PostgreSQL suite and clean migration/drift markers.
6. `pnpm test-integration:phase60-upgrade` proves real `05000 -> 06000` preservation, backfill, positive/negative approval probes, rollback, clean comparison, and no post-PASS error.
7. Manual-QA harness starts successfully and a scripted pilot smoke completes without console/server errors.
8. `git diff --check`, exact branch/baseline ancestry, clean protected hashes, frozen migrations, prohibited scope scans, and zero dependency-policy violations pass.

If any stop fails, continue implementation. Do not write a READY report.

## Final gate

Run from a dependency layout outside protected recursive scan roots:

1. frozen/offline install or verified immutable dependency state;
2. Prisma generate, validate, and format check;
3. Phase 40 inherited gate in its matching approved checkout, plus byte preservation in Phase 60;
4. Phase 50 inherited gate in its matching approved checkout, plus byte preservation in Phase 60;
5. `pnpm run verify:phase60`;
6. `pnpm run format-check`;
7. `pnpm run lint`;
8. `pnpm run typecheck` — 9/9 packages;
9. `pnpm run test` — all nonintegration tests;
10. `pnpm run contracts:check`;
11. `pnpm run test:architecture`;
12. all Phase 60 UI rendered/source/accessibility tests;
13. `pnpm run test-integration:local`;
14. `pnpm run test-integration:phase60-upgrade`;
15. `pnpm run test:e2e:phase60`;
16. `pnpm run qa:phase60 -- --smoke`;
17. `pnpm run live-evaluation:preflight` prints disabled-by-default;
18. `pnpm run build` — 9/9 packages;
19. protected digest, frozen 15-migration, allowed path, no Phase 70, no provider SDK/network, no hard-coded-grade, no unsafe-log, and no skip scans;
20. `git diff --check` and clean final worktree.

All commands must record exact exit code, file/test count, skip count, migration count, and required semantic markers. A command exit without its final summary is `NOT VERIFIED`.

## Work packages and autonomous order

The executor must continue through all packages without returning a progress-only final response:

1. **P60-0 — Baseline:** verify branch, starting commit, clean tree, protected hashes, frozen migrations, manifest, and expected-red control gate.
2. **P60-1 — Contracts and migration:** strict Phase 60 schemas, stable identities, edit lineage, approval table/guards/indexes, direct DB tests.
3. **P60-2 — Editor domain and persistence:** immutable snapshot editing, scoring/hierarchy, idempotency, stale base, stable identity, rollback.
4. **P60-3 — Authorization, validation, and approval:** persisted tenant policy, Phase 50 readiness consumption, warning acknowledgement, atomic approval, audit.
5. **P60-4 — API:** all O1–O10 transport surfaces, strict parsing, safe error mapping, no domain logic in controllers.
6. **P60-5 — Web workspace:** Hebrew RTL list/configuration/editor/preview/findings/history/approval, responsive and accessible states.
7. **P60-6 — Grades and journeys:** Grades 7–9 data-driven fixtures/isolation, Grade 8 pilot E2E, failure/reload/browser-console evidence.
8. **P60-7 — Upgrade and final gates:** staged upgrade, clean migration/drift, full regressions, manual-QA harness, build, protected/scope checks.
9. **P60-8 — Commits and report:** implementation commits by coherent package, one evidence/QA commit if useful, then one report-only commit.

After each package, inspect the substantive diff and run its focused tests. Do not stop or ask for “continue” after a passing package.

## Commit and report plan

- Forward commits only; no amend, reset, rebase, force, or history rewrite.
- Keep production/migration changes, permanent evidence, and the final report auditable.
- The last commit must be report-only and change only `docs/phases/60-implementation-report.md`.
- Final worktree must be clean on the exact Phase 60 branch.
- The report is an executor claim set, never self-approval.

## Definition of READY

`READY FOR INDEPENDENT PHASE 60 REVIEW` is allowed only when all 125 cases and every final gate pass with zero skips; Grade 8 manual smoke and Grades 7–9 data isolation are proven; approval is database-enforced and race-safe; student preview is answer-free by construction; migrations/history/protected files are intact; the report matches the final clean tree; and no Phase 70/later or real-provider work exists.

## Genuine blocker definition

`BLOCKED` is permitted only when a required external product decision or inaccessible approved artifact prevents safe progress after all local alternatives are exhausted—for example, an explicit request to enable a real provider without an approved provider/credentials, or missing authoritative production curriculum files when the task explicitly requires production data rather than deterministic QA fixtures.

Ordinary code defects, failing tests, missing helpers, migration corrections within `06000`, fixture construction, dependency-cache recovery, port conflicts, formatting, TypeScript errors, browser-test setup, or harness failures are not blockers. Diagnose and continue.
