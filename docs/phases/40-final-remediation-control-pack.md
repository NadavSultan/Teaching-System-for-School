# Phase 40 Final Remediation Control Pack

Status: **PREPARED / MASTER GATE EXPECTED TO FAIL ON BASELINE**

## Identity and authority

- Repository: Git-connected Teaching System repository.
- Branch: `codex/phase-40-final-remediation`.
- Starting commit: `a81a9eab7c99a94f19d64591bf9af30735056bf3`.
- Current approved phase: Phase 30. Phase 40 remains in remediation.
- Phase 50 is blocked until an independent Phase 40 PASS.

## Protected master gate

The following files are master-owned acceptance evidence and may not be edited, deleted, renamed, skipped, weakened, or replaced by the executor:

- `packages/db/src/phase40.master-gate.integration.test.ts`
- `tests/phase40-master-control.test.ts`
- `scripts/verify-phase40-master-gate.mjs`
- `scripts/verify-phase40-control.mjs`
- `docs/phases/40-master-gate-baseline.md`
- this control pack
- `docs/phases/40-final-remediation-executor-handoff.md`

The master will compare their hashes and substantive diff independently. Executor-authored tests supplement these files; they do not replace them.

## Objective and bounded scope

Close only the remaining Phase 40 acceptance and database-enforcement gaps while preserving the provider-neutral engine and all already-passing Phase 10/20/30/40 behavior.

### In scope

- exact multi-citation persistence and provenance;
- exact regeneration graph equality outside the target slot;
- exact carried-forward and generated citation sets;
- real equal-timestamp review/permission precedence;
- real foreign finalized base/target non-disclosure;
- direct-database probes that reach the intended first guard;
- distinct crash/recovery evidence;
- staged historical upgrade probes with atomic rollback evidence;
- truthful verification and reporting.

### Explicitly out of scope

- Phase 50 or later work;
- live/paid provider calls or SDKs;
- embeddings, semantic/vector/open-web retrieval;
- UI, editor, PDF/DOCX/rendering, deployment, billing, collaboration, or students;
- rewriting commits or migrations through `04500`;
- weakening Phase 10/20/30 contracts.

## Pre-mortem and required prevention

| Risk               | Failure mode                                                  | Required prevention                                                             | Evidence                         |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| Citation equality  | Validator proves only new-set subset of prior-set             | Bidirectional set equality for every question                                   | MG-02/MG-03 plus direct SQL      |
| Unrelated graph    | Key/order equality permits changed content/descendants        | Canonical full graph equality outside target                                    | MG-04 plus permanent graph tests |
| Empty structure    | Question counts ignore extra/missing empty sections           | Exact ordered section graph                                                     | MG-05                            |
| Tie-breaking       | Later timestamp masquerades as equal timestamp                | Two rows with the exact same timestamp and fail-closed precedence               | MG-06/MG-07                      |
| Tenant evidence    | Missing UUID masquerades as foreign object                    | Real second tenant with valid finalized graph                                   | MG-08                            |
| DB first rejection | FK/unique/append-only masks intended identity guard           | Valid non-conflicting fixture and expected database message/SQLSTATE            | MG-09 and D matrix rewrite       |
| Recovery           | Active lease or terminal replay masquerades as crash recovery | Distinct persisted crash boundaries and replay counts                           | Permanent C tests                |
| Upgrade            | PASS strings without mutation probes                          | Positive/negative commit probes and rollback assertions at each migration stage | MG-10/MG-11                      |

## Binding master acceptance cases

| ID    | Contract                                        | Expected result                                         | Permanent evidence                     |
| ----- | ----------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| MG-01 | Valid draft question cites two selected items   | SUCCEEDED; exactly both links persisted                 | protected integration test             |
| MG-02 | One of two carried links is omitted             | validator rejects and transaction rolls back            | protected integration test             |
| MG-03 | One of two generated target links is omitted    | validator rejects and transaction rolls back            | protected integration test             |
| MG-04 | Unrelated finalized question content changes    | validator rejects and transaction rolls back            | protected integration test             |
| MG-05 | Extra empty output section is inserted          | validator rejects and transaction rolls back            | protected integration test             |
| MG-06 | APPROVED and REJECTED have identical timestamps | REJECTED wins; otherwise-valid control selects          | protected integration test             |
| MG-07 | ALLOWED and DENIED have identical timestamps    | DENIED wins; otherwise-valid control selects            | protected integration test             |
| MG-08 | Real foreign finalized base and target          | non-disclosing denial; zero caller writes               | protected integration test             |
| MG-09 | Forged question/run link with valid identities  | intended question/run identity guard is first rejection | protected integration test             |
| MG-10 | Historical 04400 then 04500 deployment          | separate deploy stages in order                         | protected source test                  |
| MG-11 | Upgrade multi-citation/graph/rollback mutations | every probe executes before its PASS marker             | protected source test plus upgrade log |
| MG-12 | Known false-positive source patterns            | absent                                                  | protected source test                  |

All existing 173 matrix IDs remain binding. The executor must correct weak existing fixtures for Q, C, A, D, L, G and E1 rather than changing IDs or counts. Each named row must arrange the named precondition and assert its exact outcome. Aggregate counts are not semantic evidence.

## Migration plan

- Migrations `00100` through `04500` are immutable for this remediation.
- If database enforcement changes are needed, create exactly one forward-only migration: `20260824004600_phase40_master_gate_closure/migration.sql`.
- The migration must validate existing rows, preserve valid multi-citation data, and replace functions/triggers only forward.
- Fresh install: all migrations on `teaching_test` and a separate `teaching_clean`.
- Upgrade: `03300→04000→04100→04200→04300→04400→04500→04600`, with each Phase 40 migration copied and deployed in a distinct stage.
- Drift: isolated `teaching_shadow`, exact `No difference detected.` and `MIGRATION_DRIFT=PASS`.

## Internal work packages

1. Read and reproduce the protected master failures without editing protected files.
2. Implement `04600` exact graph/citation enforcement and permanent direct-DB tests.
3. Correct E1/T/R/S/G/O/Q cases with real fixtures and exact assertions.
4. Correct C/A/D/L cases with distinct workflows and intended first rejection evidence.
5. Rebuild the staged upgrade test with executed positive/negative probes and clean logs.
6. Run the mechanical stop and complete final gate.
7. Create one implementation commit, then one report-only commit.

## Mechanical pre-report stop

The executor may not write the report until all commands pass:

1. `node scripts/verify-phase40-master-gate.mjs`
2. `pnpm test -- tests/phase40-master-control.test.ts`
3. `pnpm test-integration:local` including all protected MG integration cases
4. `pnpm test-integration:phase40-upgrade` with every required probe marker and no post-PASS error
5. `git diff --check`

Zero skips, todos, `only`, swallowed errors, sentinel fallbacks, or expected-failure wrappers are allowed.

## Final gate

Run frozen install; Prisma generate/validate/format; master and Phase 40 verifiers; format; lint; typecheck; unit; contracts; architecture; deterministic fake; full PostgreSQL integration; staged upgrade; fresh clean migrations; isolated drift; disabled live preflight; build; protected-file diff; and `git diff --check`. On this Windows worktree, use `pnpm --config.virtual-store-dir=../v install --frozen-lockfile` so the embedded PostgreSQL native path remains below the legacy path limit.

## Commit and report plan

1. The master gate commit is immutable executor baseline.
2. One executor implementation commit containing production, migration, script, fixture, and executor-test changes only.
3. One report-only commit changing only `docs/phases/40-implementation-report.md`.

No push, merge, deploy, self-approval, or Phase 50 work.

## Definition of done

`READY FOR INDEPENDENT PHASE 40 RE-REVIEW` means all protected and existing gates pass, protected files are unchanged, the two executor commits exist, and the worktree is clean. It is not approval.

`BLOCKED` is permitted only for a genuine incompatible approved contract or unavoidable external dependency. Ordinary implementation, fixture, migration, concurrency, or test failures are work.
