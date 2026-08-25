# Phase 40 Final Closure Control Pack

Status: **AUTHORIZED / PROTECTED RED GATE**

## Identity and authority

- Repository: Git-connected Teaching System repository.
- Branch: `codex/phase-40-final-remediation`.
- Product baseline before this protected gate: `ee59dd3cd017a64e55f00b21afb6f7016338a368`.
- Executor baseline: the master-owned commit containing this protected gate; the exact hash is supplied in the executor dispatch and must be `HEAD` before any executor change.
- Current approved phase: Phase 30.
- Phase 50 remains blocked until an independent Phase 40 PASS.

## Protected master evidence

The executor may not edit, delete, rename, skip, weaken, replace, regenerate, or work around:

- `packages/db/src/phase40.master-gate.integration.test.ts`;
- `tests/phase40-master-control.test.ts`;
- `scripts/verify-phase40-master-gate.mjs`;
- `scripts/verify-phase40-control.mjs`;
- `docs/phases/40-master-gate-baseline.md`;
- `docs/phases/40-final-remediation-control-pack.md`;
- `docs/phases/40-final-remediation-executor-handoff.md`;
- this control pack;
- `docs/phases/40-final-closure-executor-handoff.md`;
- `docs/phases/40-final-closure-baseline.md` once recorded by the master.

Migrations `00100` through `04500` remain immutable. No `04700` migration is allowed. The still-unapproved `04600` closure migration is the only migration that may be corrected.

## Objective and bounded scope

Close the final four evidence and invariant gaps without redesigning already-passing Phase 10/20/30/40 behavior:

1. expected citations must originate independently from validated provider output and carried base truth, never by copying the actual link table;
2. the expected citation set must reject every insert, update, or delete after a run becomes terminal;
3. all binding Q/C/A/D/L/G/E1 matrix rows must use distinct fixtures and exact outcomes;
4. the upgrade graph must exclude only the exact target structural path and the implementation report must match the final diff.

No Phase 50, provider SDK/network call, UI/editor/rendering, deployment, embeddings, semantic/vector/open-web retrieval, billing, students, or collaboration work is authorized.

## Pre-mortem and required prevention

| Risk                      | False completion mode                                                | Required prevention                                                                                                       | Protected evidence              |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Derived truth             | expected rows are copied from already-written actual links           | construct expected rows from validated output plus selected context and carried base links using an independent data path | MG-13 and MG-16                 |
| Extensible truth          | direct DB inserts another expected row after `SUCCEEDED`             | fail-closed insert guard plus append-only update/delete guard and exact identity checks                                   | MG-14                           |
| Matrix false positive     | FK, fixture, lease, or arbitrary DB error satisfies bare `toThrow()` | exact class/message/SQLSTATE/state/count for every binding row                                                            | MG-15 plus 173-row runtime gate |
| Aggregated cases          | one combined branch hides missing/foreign/outside-base differences   | separate arrangements and assertions per ID                                                                               | MG-15                           |
| Unstable target exclusion | every question named `q1` is excluded from canonical comparison      | exclude the exact section key/order plus question key/order tuple                                                         | MG-16 plus upgrade mutation     |
| False report              | report states that modified migration `04600` was unchanged          | derive changed paths from Git and state the truth                                                                         | MG-16 and report-only diff      |

## Binding protected acceptance cases

The original `MG-01` through `MG-12` remain binding and unchanged in meaning.

| ID    | Arrangement                                                                                                 | Expected result                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| MG-13 | validated two-citation provider output; a master DB trigger suppresses one actual link before persistence   | run fails atomically; no output revision, actual link, or expected row survives                                            |
| MG-14 | a valid run has already reached `SUCCEEDED`; direct SQL attempts to append a second valid expected citation | exact `generation expected citation set is closed` rejection; expected set unchanged                                       |
| MG-15 | scan all binding Q/C/A/D/L/G/E1 executor matrices                                                           | no bare `rejects.toThrow()`, aggregated denial branches, `links.some`, `results.some`, or non-exact retry count assertions |
| MG-16 | inspect independent expected-source construction, upgrade target exclusion, and report wording              | no actual-link-table copy, no `q.key <> 'q1'`, and no false claim that `04600` was unmodified                              |

Expected protected cases: **16**. Expected matrix manifest: **173**. Zero skips, todos, `only`, xfail, swallowed errors, and self-generated sentinel/database errors.

## Required implementation semantics

### Independent expected citation construction

- Build the expected row set directly from the already-validated provider output citations and the immutable selected context snapshot.
- For carried questions, derive the expected rows from the complete base-question source set and the stable base/output structural mapping.
- Do not query `question_source_links` to manufacture the expected set.
- Persist expected rows and actual links in the same success transaction, but through independent inputs. A suppressed or omitted actual insert must create an expected-versus-actual mismatch and roll the entire success transaction back.
- Bidirectional equality must compare question, knowledge item, source version, locator, text hash, curriculum version/node, lineage, and prior question.

### Expected-set database guard

- `INSERT` is allowed only while the owning run is `PROCESSING` and only for a question in the run's generation-owned output revision/assessment.
- Validate the expected knowledge/source/locator/hash/curriculum fields against the persisted generation context.
- Validate DRAFT versus REGENERATE lineage and prior-question mapping.
- Once the run is `SUCCEEDED`, `FAILED`, or `INSUFFICIENT_CONTEXT`, every expected-row insert must fail with `generation expected citation set is closed` before unrelated constraints can mask it.
- UPDATE and DELETE remain append-only rejections.
- Direct DB probes must force deferred constraints and assert the intended first error.

### Exact binding matrices

- Preserve every registry ID and `MATRIX_MANIFEST=173`.
- Q `missing-target`, `foreign-target`, `target-outside-base`, and `foreign-base` each receive a distinct real arrangement and exact `AccessDeniedError`/non-disclosing message/zero-write assertions.
- C concurrency rows assert the complete ordered result vector, exact lease/replay state, attempts, revisions, usages, outbox, and audit counts.
- A/D/L negative rows assert the exact database message and stable SQLSTATE rather than any thrown error.
- G rows assert the exact state, failure code, attempts, usage count, output revision, and replay identity for each gateway outcome.
- E1 rows assert the exact terminal state/failure code and zero output writes.

### Upgrade and reporting

- Canonical graph comparison identifies the target by the full stable tuple `(section key, section order, question key, question order)`.
- The historical fixture includes another non-target question with the same question key in a different section, so a key-only exclusion fails.
- Mutating that same-key non-target question must reach the Phase 40 validator, reject, and roll back.
- PASS markers print only after positive, negative, and rollback assertions.
- The report is a claim set and lists the actual modified `04600` migration truthfully.

## Mechanical pre-report stop

The report may not be edited until all commands exit 0:

1. `node scripts/verify-phase40-master-gate.mjs` with `PROTECTED_CASES=16` and `MATRIX_MANIFEST=173`.
2. `pnpm test -- tests/phase40-master-control.test.ts` with MG-10 through MG-12 and MG-15/MG-16 green.
3. `pnpm test-integration:local` with MG-01 through MG-09 and MG-13/MG-14 green, all migrations, clean database, and drift PASS.
4. `pnpm test-integration:phase40-upgrade` with all real probes before their markers and no post-PASS error.
5. `git diff --check`.

## Full final gate

Run the Windows-safe frozen install; Prisma generate/validate/format check; both Phase 40 verifiers; format; lint; typecheck; unit; contract; architecture; deterministic fake; full PostgreSQL integration; staged upgrade; separate clean database; isolated drift; disabled live preflight; all nine workspace builds; protected hashes; frozen migrations; no `04700`; and `git diff --check`.

Record exact commands, exit codes, file/test counts, zero-skip status, migration stage order, probe markers, drift output, build package count, and final commit hashes. Old logs are not evidence.

## Commit and handoff

1. Preserve the master gate commits unchanged.
2. Create one new implementation commit containing only production, `04600`, schema if needed, upgrade, fixture, and executor-owned test changes.
3. After the full committed-tree gate passes, create one report-only commit changing only `docs/phases/40-implementation-report.md`.
4. End on the exact branch with a clean worktree.

Final executor status: `READY FOR INDEPENDENT PHASE 40 RE-REVIEW`, never self-approval. `BLOCKED` is allowed only for an incompatible approved Phase 20/30 contract or unavoidable external dependency; ordinary implementation and test work is not a blocker.
