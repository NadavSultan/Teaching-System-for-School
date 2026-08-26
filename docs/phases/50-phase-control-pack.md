# Phase 50 Control Pack — Validation Engine

Status: **AUTHORIZED FOR IMPLEMENTATION**

## Identity and authority

- Repository: `Teaching-System-for-School`
- Exact branch: `codex/phase-50-validation-engine`
- Approved product baseline: `8f09173f073f13b8e565a12f3d37abac18b33bf5`
- Executor starting commit: the Phase 50 control/preparation commit containing this file.
- Current approved phase: Phase 40 is independently approved in `docs/phases/40-phase-review.md`.
- Dependent phase: Phase 60 remains blocked until independent Phase 50 approval.
- New forward-only migration: `packages/db/prisma/migrations/20260826005000_phase50_validation_engine/migration.sql`.

## Objective

Implement a provider-neutral validation engine for immutable finalized assessment revisions. It must execute a complete versioned deterministic ruleset, optionally invoke a strict semantic evaluator through a narrow interface, persist immutable validation evidence, fail closed on incomplete/evaluator-failed runs, expose non-disclosing status/result/readiness operations, and provide a database-backed readiness assertion that Phase 60 can consume without implementing approval itself.

The engine does not certify educational correctness. It records deterministic proof and versioned semantic evidence for a human approval workflow implemented only in Phase 60.

## Governing documents and protected interfaces

| Item                                                              | Rule                                                                                       | Verification                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| ADR-001–ADR-007 and architecture v1                               | Preserve all approved boundaries and provider neutrality                                   | Architecture tests and diff review            |
| Phase 10                                                          | Persisted `resolveAccessContext`, outbox, audit/redaction, tenancy                         | Auth, outbox, audit matrices                  |
| Phase 20                                                          | Published Curriculum identities, exact integer scoring, immutable FINALIZED revision graph | Deterministic rules and DB adversarial tests  |
| Phase 30                                                          | Current source review/permission/lifecycle/tenant eligibility                              | Readiness re-check and revoked-source cases   |
| Phase 40                                                          | GenerationRun, immutable revision/provenance, QuestionSourceLink, registries               | Provenance rules and frozen migrations        |
| Migrations `00100`–`04600`                                        | Immutable historical artifacts                                                             | SHA/content comparison from approved baseline |
| `docs/phases/40-phase-review.md`                                  | Master-owned approval record                                                               | Must not be edited by executor                |
| This pack, handoff, red baseline, manifest, master test, verifier | Master-owned and immutable                                                                 | Hash/diff verification                        |

## Explicit scope

### In scope

- Strict v1 validation request/status/result/finding/readiness/acknowledgement/semantic-evaluation contracts and generated JSON Schemas.
- Versioned deterministic rule registry and exact rule-execution evidence.
- Provider-neutral `SemanticEvaluator`, immutable evaluator registry, deterministic fake, strict output parser, timeout/retry/error classification, and disabled live preflight.
- ValidationRun, deterministic rule execution, semantic evaluation, finding, and warning acknowledgement persistence.
- Outbox-backed request/worker flow with safe retries, stale lease recovery, idempotency, row locking, and monotonic per-revision validation sequence.
- Persisted tenant authorization for all public operations.
- Fail-closed readiness for future approval, including current source eligibility re-check.
- Safe audit/redaction, runbook, upgrade test, drift proof, permanent matrix tests, and implementation report.

### Explicitly out of scope

- Phase 60 teacher editor, edit/reorder/add/delete workflows, explicit revision approval, approval UI, revision-history UI, or browser E2E.
- Phase 70 rendering, PDF/DOCX, storage, signed downloads, fonts, templates, or visual QA.
- Real/paid model or evaluator SDK, network call, provider selection, credentials, live evaluation, embeddings/vector/open-web retrieval.
- Automatic educational certification, silent correction of assessment content, question-bank promotion, collaboration, students, grading, deployment, billing, or role administration.
- Mutation of a FINALIZED assessment revision or any Phase 40 generation/provenance evidence.

## Binding data model

The implementation may refine names only when Prisma/SQL conventions require it, while preserving these semantics and contracts.

1. `ValidationRuleDefinition`: immutable seeded registry row keyed by `(rulesetVersion, ruleId, ruleVersion)`, including category, default severity, and deterministic order. UPDATE/DELETE is prohibited.
2. `ValidationRun`: tenant-owned, references exact Assessment and FINALIZED AssessmentRevision, requester, operation mode, immutable ruleset/evaluator versions, monotonic positive `revisionSequence`, caller idempotency key, state, lease/attempt fields, safe failure code, timestamps, and aggregate counts. Unique `(organizationId, assessmentRevisionId, revisionSequence)` and `(organizationId, assessmentRevisionId, idempotencyKey)`.
3. `ValidationRuleExecution`: immutable one-per-required-rule evidence for a run, exact PASS/FAIL outcome, rule identity/version, bounded typed evidence, and optional linked deterministic finding. A run cannot become SUCCEEDED unless its executed set exactly equals the pinned registry set.
4. `SemanticEvaluation`: immutable one-per-run evaluator execution with pinned evaluator/prompt/model/schema configuration, terminal success/failure classification, bounded usage/latency counters, and no raw source/assessment text in audit/log metadata.
5. `ValidationFinding`: immutable run/revision-bound evidence with kind DETERMINISTIC/SEMANTIC, registry code/category, severity BLOCKING/WARNING/INFO, stable path, bounded message key/evidence, optional confidence basis points, and evaluator/rule version identity.
6. `ValidationFindingAcknowledgement`: immutable tenant/user/finding record permitted only for a SEMANTIC WARNING, with bounded reason and idempotency key. It is acknowledgement, never deterministic override or proof that a warning is false.

All tenant, actor, assessment, revision, run, rule, evaluator, finding, and acknowledgement identity columns are immutable. Evidence rows are append-only. Critical invariants require reviewed PostgreSQL enforcement and direct-database tests.

## Operation catalog

| ID  | Operation                        | Trusted context                                                                                                                | Authorization                                                                                              | Transaction/idempotency                                                                                                                                      | Result/failure                                                                        | Audit                                                        |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| P1  | `requestRevisionValidation`      | Persisted actor/org plus assessment/revision IDs and strict idempotency key; rule/evaluator versions come from server registry | Active user, membership and organization; TEACHER/COORDINATOR/SCHOOL_ADMIN; exact owned FINALIZED revision | Lock revision, allocate monotonic sequence, insert run + ID-only outbox atomically; exact retry returns same run, conflicting payload fails                  | Strict run summary; missing/foreign is non-disclosing                                 | IDs, versions, counts only                                   |
| P2  | `getValidationStatus`            | Persisted run ID                                                                                                               | Same active tenant policy and exact owner                                                                  | Read-only deterministic query                                                                                                                                | Strict status or null for missing/foreign                                             | No content                                                   |
| P3  | `getValidationResult`            | Persisted run ID                                                                                                               | Same active tenant policy and exact owner                                                                  | Read-only ordered mapping                                                                                                                                    | Strict executions/findings/evaluation/ack summaries or null                           | No content                                                   |
| P4  | `acknowledgeSemanticWarning`     | Persisted finding ID, bounded reason, idempotency key                                                                          | Same active tenant policy; finding belongs to exact run/revision                                           | Atomic unique acknowledgement; exact retry returns same record; conflicting reuse fails                                                                      | Strict acknowledgement; illegal finding type/severity rejected                        | Actor/finding/run IDs and reason class/hash, not reason text |
| P5  | `getRevisionValidationReadiness` | Persisted assessment/revision IDs plus server-current registry versions                                                        | Same active tenant policy and exact owner                                                                  | Read latest sequence, re-check current source eligibility in one consistent transaction                                                                      | READY or BLOCKED with exact enumerated safe reason codes                              | Readiness decision IDs/versions/counts                       |
| I1  | `assertRevisionApprovable`       | Exact tenant and revision inside a future approval transaction                                                                 | Internal only after persisted authorization                                                                | Database-backed fail-closed assertion; no mutation                                                                                                           | Returns exact ready evidence or raises one reviewed safe database error               | Caller records future Phase 60 audit                         |
| I2  | `processValidationRun`           | Claimed ID-only outbox event                                                                                                   | Worker-owned lease and run lock                                                                            | PROCESSING claim, deterministic rules, semantic adapter, evidence and terminal transition are atomic per attempt; safe retry only from PROCESSING to PENDING | SUCCEEDED only with complete evidence; all evaluator/integrity failures become FAILED | Safe classes/counts/hashes only                              |

No public operation accepts organization, role, requester, run state, sequence, registry version, severity, blocking status, confidence, evaluator identity, audit identity, or readiness as trusted client input.

## Lifecycle, concurrency, and completion

States are exactly `PENDING`, `PROCESSING`, `SUCCEEDED`, and `FAILED`. The 16 ordered pairs in matrix L are binding. Only PENDING→PROCESSING, PROCESSING→PENDING, PROCESSING→SUCCEEDED, and PROCESSING→FAILED are allowed. Terminal runs never reopen; replay is a service no-op without a state UPDATE.

- `revisionSequence` is allocated under an exact revision lock; timestamps never choose the latest run.
- Readiness uses the greatest committed sequence. An older success cannot mask a newer pending, processing, or failed run.
- SUCCEEDED requires the exact deterministic registry set, a terminal successful semantic evaluation when semantic evaluation is required, consistent finding identities/counts, and no partial evidence.
- Evaluator timeout, malformed output, unknown category/code, wrong-revision evidence, exhausted retry, or permanent failure cannot become success or an empty-pass result.
- Processing lease recovery may return only a genuinely stale PROCESSING run to PENDING within the attempt bound.

## Deterministic rule registry

The v1 ruleset contains exactly these required rules in deterministic order:

1. `REVISION_FINALIZED_AND_OWNED`
2. `STRICT_REVISION_CONTRACT`
3. `PLAN_COUNT_KEY_ORDER`
4. `CURRICULUM_SCOPE_PUBLISHED`
5. `ANSWER_COMPLETENESS_AND_TARGETS`
6. `EXACT_SCORE_TREE`
7. `STABLE_ID_AND_EXACT_DUPLICATE`
8. `DETERMINISTIC_ANSWER_LEAKAGE`
9. `SOURCE_LINK_COMPLETENESS_AND_IDENTITY`
10. `CURRENT_SOURCE_ELIGIBILITY`
11. `GENERATION_REVISION_PROVENANCE`

Every SUCCEEDED run records exactly 11 executions. PASS evidence is required; absence of a finding is not execution proof. Deterministic FAIL findings are BLOCKING and cannot be acknowledged or overridden.

The semantic evaluator categories are exactly `HEBREW_CORRECTNESS`, `AMBIGUITY`, `ANSWER_VALIDITY`, `DIFFICULTY_FIT`, `CURRICULUM_FIT`, `DUPLICATION`, and `ANSWER_LEAKAGE`. BLOCKING findings cannot be acknowledged. WARNING findings must be acknowledged before readiness. INFO findings are retained and do not require acknowledgement.

## Acceptance matrices

Every case ID below must exist in the protected manifest and in a permanent executable test. Fixtures must independently arrange the named precondition; combined branches and assertions accepting multiple outcomes are prohibited.

### D — deterministic rules, 20 cases

| ID  | Arrangement                                                             | Expected                                |
| --- | ----------------------------------------------------------------------- | --------------------------------------- |
| D01 | Valid worksheet revision and exact lineage                              | All 11 executions PASS                  |
| D02 | Valid 10,000-unit test revision and exact lineage                       | All 11 executions PASS                  |
| D03 | Persisted graph cannot map to strict revision contract                  | Named rule FAIL/BLOCKING                |
| D04 | Required answer/revision field absent                                   | Named rule FAIL/BLOCKING                |
| D05 | Frozen plan question count differs                                      | Named rule FAIL/BLOCKING                |
| D06 | Frozen plan keys or order differ                                        | Named rule FAIL/BLOCKING                |
| D07 | Unknown/cross-version curriculum node                                   | Named rule FAIL/BLOCKING                |
| D08 | Curriculum version is not currently PUBLISHED                           | Named rule FAIL/BLOCKING                |
| D09 | Answer missing for a required question/subquestion                      | Named rule FAIL/BLOCKING                |
| D10 | Answer or rubric targets wrong owner type/ID                            | Named rule FAIL/BLOCKING                |
| D11 | Assessment/section/question/subquestion score total mismatch            | Named rule FAIL/BLOCKING                |
| D12 | Rubric allocation incomplete or inconsistent                            | Named rule FAIL/BLOCKING                |
| D13 | Duplicate stable question/subquestion IDs                               | Named rule FAIL/BLOCKING                |
| D14 | Exact normalized duplicate question text                                | Named rule FAIL/BLOCKING                |
| D15 | Exact normalized answer appears in student-visible prompt/question text | Named rule FAIL/BLOCKING                |
| D16 | Generated question has no source link                                   | Named rule FAIL/BLOCKING                |
| D17 | Source link is foreign, unknown, or wrong locator/hash                  | Named rule FAIL/BLOCKING                |
| D18 | Linked source becomes rejected/denied/expired/inactive                  | Named rule FAIL/BLOCKING                |
| D19 | Generation run/output revision/lineage identities disagree              | Named rule FAIL/BLOCKING                |
| D20 | One required execution absent, duplicated, or wrong-version             | Completion rejected; run cannot SUCCEED |

### S — semantic evaluator, 12 cases

| ID  | Evaluator outcome                                         | Expected                                      |
| --- | --------------------------------------------------------- | --------------------------------------------- |
| S01 | Strict clean output                                       | Success, zero semantic findings               |
| S02 | Hebrew correctness warning                                | Exact WARNING retained                        |
| S03 | Ambiguity warning                                         | Exact WARNING retained                        |
| S04 | Answer validity blocker                                   | Exact BLOCKING retained                       |
| S05 | Difficulty-fit warning                                    | Exact WARNING retained                        |
| S06 | Curriculum-fit blocker                                    | Exact BLOCKING retained                       |
| S07 | Duplication warning                                       | Exact WARNING retained                        |
| S08 | Answer-leakage blocker                                    | Exact BLOCKING retained                       |
| S09 | Malformed/schema-invalid evaluator output                 | Run FAILED, never empty pass                  |
| S10 | Timeout/transient errors through exhausted retry          | Run FAILED with exact safe code               |
| S11 | Permanent evaluator error                                 | Run FAILED without retry masquerading as pass |
| S12 | Unknown category/code or wrong revision/evidence identity | Output rejected and run FAILED                |

### W — warning acknowledgement, 8 cases

| ID  | Arrangement                                   | Expected                      |
| --- | --------------------------------------------- | ----------------------------- |
| W01 | Own semantic WARNING, valid reason/key        | One acknowledgement           |
| W02 | Exact idempotent retry                        | Same acknowledgement ID       |
| W03 | Same key with conflicting finding/reason hash | Idempotency conflict          |
| W04 | Deterministic finding                         | Rejected                      |
| W05 | Semantic BLOCKING finding                     | Rejected                      |
| W06 | Semantic INFO finding                         | Rejected                      |
| W07 | Foreign-tenant warning in both directions     | Non-disclosing null/not-found |
| W08 | Inactive user/membership/organization         | Denied from persisted state   |

### L — run state transitions, 16 cases

| ID  | From → To             | Expected                               |
| --- | --------------------- | -------------------------------------- |
| L01 | PENDING→PENDING       | Reject                                 |
| L02 | PENDING→PROCESSING    | Allow                                  |
| L03 | PENDING→SUCCEEDED     | Reject                                 |
| L04 | PENDING→FAILED        | Reject                                 |
| L05 | PROCESSING→PENDING    | Allow only stale/retry policy          |
| L06 | PROCESSING→PROCESSING | Reject                                 |
| L07 | PROCESSING→SUCCEEDED  | Allow only complete success shape      |
| L08 | PROCESSING→FAILED     | Allow only exact failure shape         |
| L09 | SUCCEEDED→PENDING     | Reject                                 |
| L10 | SUCCEEDED→PROCESSING  | Reject                                 |
| L11 | SUCCEEDED→SUCCEEDED   | Reject                                 |
| L12 | SUCCEEDED→FAILED      | Reject                                 |
| L13 | FAILED→PENDING        | Reject; new validation run is required |
| L14 | FAILED→PROCESSING     | Reject                                 |
| L15 | FAILED→SUCCEEDED      | Reject                                 |
| L16 | FAILED→FAILED         | Reject                                 |

### T — tenant isolation, 12 cases

Each pair executes organization A against B and B against A.

| ID pair | Operation                                          | Expected                                  |
| ------- | -------------------------------------------------- | ----------------------------------------- |
| T01/T02 | request validation for foreign revision            | Non-disclosing rejection                  |
| T03/T04 | get foreign run status                             | null                                      |
| T05/T06 | get foreign run result                             | null                                      |
| T07/T08 | acknowledge foreign finding                        | Non-disclosing rejection                  |
| T09/T10 | get foreign revision readiness                     | null/non-disclosing                       |
| T11/T12 | invoke readiness assertion through foreign context | Non-disclosing rejection before assertion |

### R — persisted role and state, 18 cases

| ID  | Arrangement/operation                                       | Expected                                   |
| --- | ----------------------------------------------------------- | ------------------------------------------ |
| R01 | TEACHER complete own-tenant validation flow                 | Allowed                                    |
| R02 | COORDINATOR complete own-tenant validation flow             | Allowed                                    |
| R03 | SCHOOL_ADMIN complete own-tenant validation flow            | Allowed                                    |
| R04 | Inactive user requests validation                           | Denied                                     |
| R05 | Inactive user reads status/result/readiness                 | Denied                                     |
| R06 | Inactive membership requests validation                     | Denied                                     |
| R07 | Inactive membership reads status/result/readiness           | Denied                                     |
| R08 | Inactive organization requests validation                   | Denied                                     |
| R09 | Inactive organization reads status/result/readiness         | Denied                                     |
| R10 | Client-forged elevated role                                 | Persisted role wins; no elevation          |
| R11 | Client-forged organization                                  | Persisted membership/target ownership wins |
| R12 | Client-forged requester/acknowledger ID                     | Authenticated persisted user wins          |
| R13 | Missing authenticated principal                             | Rejected before domain operation           |
| R14 | Unsupported role/value at strict contract boundary          | Rejected                                   |
| R15 | TEACHER acknowledges own semantic warning                   | Allowed                                    |
| R16 | COORDINATOR acknowledges own semantic warning               | Allowed                                    |
| R17 | SCHOOL_ADMIN acknowledges own semantic warning              | Allowed                                    |
| R18 | Platform entitlement without active organization membership | Denied                                     |

### C — concurrency and idempotency, 8 cases

| ID  | Race/replay                                                             | Expected                                         |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| C01 | Concurrent same request/key/payload                                     | One run/outbox, same ID                          |
| C02 | Same key with conflicting mode/revision                                 | Exact conflict, no second run                    |
| C03 | Concurrent distinct keys on one revision                                | Distinct monotonic sequences, no duplicate       |
| C04 | Two workers claim same run                                              | One PROCESSING owner                             |
| C05 | Fresh versus stale PROCESSING recovery                                  | Fresh retained; only stale retry returns PENDING |
| C06 | Competing success/failure terminal writes                               | Exactly one legal terminal result                |
| C07 | Concurrent same warning acknowledgement                                 | One acknowledgement, same ID                     |
| C08 | Older success plus newer failed/pending run, including equal timestamps | Greater sequence wins; readiness fail-closed     |

### P — approval readiness, 12 cases

| ID  | Latest exact-revision state                                 | Expected reason                          |
| --- | ----------------------------------------------------------- | ---------------------------------------- |
| P01 | No validation run                                           | `VALIDATION_REQUIRED`                    |
| P02 | PENDING                                                     | `VALIDATION_PENDING`                     |
| P03 | PROCESSING                                                  | `VALIDATION_PROCESSING`                  |
| P04 | FAILED/evaluator failed                                     | `VALIDATION_FAILED`                      |
| P05 | SUCCEEDED with deterministic blocker                        | `DETERMINISTIC_BLOCKER`                  |
| P06 | SUCCEEDED with semantic blocker                             | `SEMANTIC_BLOCKER`                       |
| P07 | SUCCEEDED with unacknowledged semantic warning              | `WARNING_ACKNOWLEDGEMENT_REQUIRED`       |
| P08 | Same warning validly acknowledged                           | READY                                    |
| P09 | Clean/INFO-only complete run                                | READY                                    |
| P10 | Run pins non-current/unknown ruleset or evaluator version   | `VALIDATION_VERSION_STALE`               |
| P11 | Source eligibility revoked after successful run             | `SOURCE_ELIGIBILITY_CHANGED`             |
| P12 | Older success exists but greater sequence is non-successful | Reason from newest sequence; never READY |

### B — direct-database adversarial enforcement, 16 cases

| ID  | Direct mutation                                                            | Expected first guard                  |
| --- | -------------------------------------------------------------------------- | ------------------------------------- |
| B01 | Insert run with forged organization/assessment owner                       | Exact tenant identity rejection       |
| B02 | Insert run with mismatched assessment/revision                             | Exact revision identity rejection     |
| B03 | Insert run for BUILDING/non-FINALIZED revision                             | Exact finalized-state rejection       |
| B04 | Insert requester without active membership                                 | Exact persisted authority rejection   |
| B05 | Update immutable run identity/config/sequence/idempotency fields           | Exact immutability rejection          |
| B06 | Illegal run state pair                                                     | Exact lifecycle rejection             |
| B07 | Mark SUCCEEDED with missing/duplicate/wrong-version rule set               | Exact incomplete-rule rejection       |
| B08 | Mark SUCCEEDED without successful semantic evaluation                      | Exact semantic-completion rejection   |
| B09 | Insert execution for unknown rule/version                                  | FK/registry rejection                 |
| B10 | Insert finding for foreign run/revision/evaluator identity                 | Exact finding identity rejection      |
| B11 | Insert acknowledgement for deterministic finding                           | Exact acknowledgement-kind rejection  |
| B12 | Insert acknowledgement for semantic BLOCKING/INFO                          | Exact severity rejection              |
| B13 | UPDATE/DELETE rule definitions, executions, semantic evidence, or findings | Exact append-only rejection           |
| B14 | UPDATE/DELETE acknowledgement or reparent it                               | Exact append-only/identity rejection  |
| B15 | Duplicate revision sequence or conflicting idempotency key                 | Exact unique/idempotency rejection    |
| B16 | Call database readiness after source revocation or forged pass rows        | Exact fail-closed readiness rejection |

### A — audit, outbox, redaction, 8 cases

| ID  | Evidence path                                   | Expected                                                                            |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| A01 | Validation requested                            | Safe audit with IDs/versions only                                                   |
| A02 | Worker success                                  | Safe audit with counts/hashes only                                                  |
| A03 | Worker/evaluator failure                        | Safe failure class; no raw provider/source content                                  |
| A04 | Warning acknowledged                            | Actor/finding IDs and bounded reason hash/class only                                |
| A05 | Outbox request/retry payload                    | ID-only payload                                                                     |
| A06 | Logs/telemetry across request/process/readiness | No prompts, questions, answers, source text, tokens, secrets, cookies, auth headers |
| A07 | Public result mapping                           | Lossless IDs/versions/codes/counts; strict contract; deterministic order            |
| A08 | Audit and evidence UPDATE/DELETE                | Database rejection and original evidence retained                                   |

- Expected matrix rows: **130**
- Expected executed cases: **130**
- Expected case IDs: D20 + S12 + W8 + L16 + T12 + R18 + C8 + P12 + B16 + A8
- Zero skips/todos/only/expected-failure wrappers: **required**
- Every case must assert its exact state/result/error; aggregate counts, substring-only generic database errors, alternative-message regexes, self-equality, non-zero sentinels, and combined case branches are not evidence.

## Pre-mortem closure requirements

| Risk                                       | Required prevention                              | Evidence            |
| ------------------------------------------ | ------------------------------------------------ | ------------------- |
| Older pass masks newer failure             | Monotonic locked sequence, not timestamps        | C03/C08/P12/B15     |
| Partial evaluator failure becomes pass     | Strict parser and success-shape DB guard         | S09–S12/B08         |
| Deterministic blocker is “overridden”      | Only semantic WARNING acknowledgement is legal   | W04–W06/B11–B12     |
| Revoked source remains approvable          | Readiness re-checks current Phase 30 eligibility | D18/P11/B16         |
| Cross-tenant finding leak                  | Persisted auth and null/non-disclosing reads     | T01–T12             |
| Client forges registry/severity/readiness  | Server registries and DB identity checks         | R10–R12/B05/B09/B10 |
| Concurrent runs corrupt latest decision    | Per-revision lock/sequence and terminal CAS      | C01–C08             |
| Evidence mutates after review              | Append-only triggers and immutable identities    | B05/B13/B14/A08     |
| Sensitive educational content reaches logs | Central safe mapper/redaction tests              | A01–A07             |
| Migration passes fresh but breaks history  | staged 04600→05000 upgrade and isolated drift    | final gate          |

## Migration and upgrade plan

- Freeze all 14 migrations `00100` through `04600` byte-for-byte.
- Add exactly one migration: `20260826005000_phase50_validation_engine`.
- Final migration count: 15.
- Use forward-only types/tables/constraints/indexes/triggers/functions. Do not modify or squash history.
- Seed the immutable v1 deterministic rule registry transactionally.
- Validate any existing Phase 40 rows before adding constraints; no fabricated validation passes or automatic acknowledgements.
- Fresh install all 15 migrations into two isolated databases.
- Staged upgrade copies the approved 14-migration baseline, seeds representative Phase 40 success/failure/provenance rows, applies 05000, verifies preservation, executes positive and negative completion/readiness/append-only probes, then compares with a second clean 15-migration database.
- Run isolated shadow drift and require exact `No difference detected.` plus `MIGRATION_DRIFT=PASS`.

## Required deliverables

| ID     | Deliverable                               | Expected locations                                                                                               |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| F50-01 | Strict contracts and schemas              | `packages/contracts/src/phase50.ts`, index export, seven validation/semantic schema snapshots, generator updates |
| F50-02 | Pure deterministic rules/readiness        | `packages/domain/src/validation.ts` and tests                                                                    |
| F50-03 | Semantic evaluator boundary/fake/registry | `packages/ai/src/semantic-evaluator.ts` and tests                                                                |
| F50-04 | Migration and DB service                  | exact 05000 migration, `packages/db/src/validation.ts`                                                           |
| F50-05 | Worker integration                        | `apps/worker/src/validation-worker.ts` and permanent tests                                                       |
| F50-06 | Complete matrices                         | Phase 50 unit/integration/direct-DB tests referencing all 130 protected IDs                                      |
| F50-07 | Mechanical/upgrade gates                  | `scripts/verify-phase50-control.mjs`, `scripts/phase50-upgrade-test.mjs`, package scripts                        |
| F50-08 | Operations runbook                        | `docs/runbooks/phase-50-validation.md`                                                                           |
| F50-09 | Truthful claim report                     | `docs/phases/50-implementation-report.md`                                                                        |

## Mechanical pre-report stop

The executor may not create or edit `docs/phases/50-implementation-report.md` until all of these pass and the complete output has been inspected:

1. `node scripts/verify-phase50-control.mjs`
2. `pnpm test -- tests/phase50-master-control.test.ts`
3. all Phase 50 unit/contract tests, with manifest runtime agreement `130/130`
4. `pnpm test-integration:local`, including all Phase 10–50 suites
5. `pnpm test-integration:phase50-upgrade`, including positive/negative database probes
6. `git diff --check`

## Full final gate

Run and record exact command, exit code, file/test count, and zero-skip status:

1. frozen install using `pnpm --config.virtual-store-dir=../v install --frozen-lockfile`
2. Prisma generate, validate, and `format --check`
3. `node scripts/verify-phase40-master-gate.mjs` to preserve the approved prior phase
4. `node scripts/verify-phase50-control.mjs`
5. format check, lint, 9/9 typecheck
6. complete unit tests
7. contract schema generation/check
8. architecture tests
9. deterministic fake semantic-evaluator evaluation
10. full isolated PostgreSQL integration
11. Phase 50 staged upgrade
12. separate fresh clean 15-migration database
13. isolated shadow drift
14. disabled live evaluator/provider preflight
15. 9/9 build
16. protected-file and frozen-migration verification
17. `git diff --check`, exact branch/baseline/changed paths, and clean worktree

## Commit and report plan

The master control/preparation commit is immutable. The executor creates:

1. one core implementation commit containing contracts, migration, registries, domain/database/AI/worker production code;
2. one evidence commit containing permanent tests, upgrade script, package gate wiring, and runbook;
3. only after every gate passes, one report-only commit changing only `docs/phases/50-implementation-report.md`.

If a correction after a commit is required, create a clearly named forward corrective commit; do not amend or rewrite shared/control history. End clean.

## Definition of done

`READY FOR INDEPENDENT PHASE 50 REVIEW` means all 130 binding cases and all inherited/full gates pass with zero skips; exact run/evidence/readiness semantics are independently inspectable; the three executor commits exist; the report is truthful; the branch and worktree are exact and clean; no Phase 60/later or real-provider scope exists. It is not approval.

`BLOCKED` is allowed only when an approved Phase 10–40 contract is genuinely incompatible, an owner/provider/privacy decision is required to proceed safely, or an unavoidable external dependency has no deterministic local substitute. Missing code, migrations, fixtures, tests, helpers, concurrency logic, formatting, or failing gates are ordinary implementation work and are not blockers.
