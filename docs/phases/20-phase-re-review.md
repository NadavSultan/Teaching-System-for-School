# Phase Re-Review — Phase 20: Curriculum and Assessment Domain

- Date: 2026-08-18
- Reviewed baseline: `4502bbd70ed74b80c7a9c8024ca43ac82cc9a5f8` plus the uncommitted working tree
- Prior verdict: **REQUIRES FIXES – Do not proceed yet**
- Remediation prompt: `docs/phases/20-remediation-master-prompt.md`

## 1. Objective completion

Phase 20 remains incomplete. This remediation attempt repaired the immediate TypeScript and Prisma syntax failures, generated five Phase 20 JSON Schema artifacts, added two small domain tests, and proved that the proposed migration applies to two clean PostgreSQL databases without breaking the existing Phase 10 regression suite.

It did not implement the phase-defining behavior. There are still no Curriculum or Assessment application services, no `BUILDING → FINALIZED` revision construction mechanism, no database lifecycle or immutable-content enforcement, no published/same-version reference enforcement, no Assessment authorization operations, no tenant-isolation tests, no audit behavior, and no Phase 20 PostgreSQL integration tests. Contract and Prisma/migration representations remain incomplete and divergent.

The implementation report itself still describes remediation as in progress and explicitly lists the critical work as remaining. There is no remediation branch or commit.

## 2. Acceptance criteria

|   # | Status  | Evidence and remaining requirement                                                                                                                                                                                                                   |
| --: | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | PARTIAL | Zod compiles, five new JSON Schemas exist, Prisma generates, and the SQL migration applies. Required summary/complete-response contracts are missing, persistence omits required fields/behavior, and Prisma does not fully represent the migration. |
|   2 | PASS    | All three migrations applied to both `teaching_test` and isolated `teaching_clean` on PostgreSQL 17.10. Existing integration tests passed: 3 files, 20 tests, zero skips.                                                                            |
|   3 | FAIL    | One basic domain test checks a valid chain and two invalid examples. PostgreSQL does not enforce root type, parent type, same-version ancestry, or cycles, and no database test exists.                                                              |
|   4 | FAIL    | No atomic draft-import service or persistence test exists. Duplicate, size, cycle, invalid-parent, and invalid-difficulty rejection are not comprehensively implemented or proven.                                                                   |
|   5 | FAIL    | No publish/deprecate service, structural publication gate, legal-transition enforcement, or database immutability trigger/test exists.                                                                                                               |
|   6 | PARTIAL | Typed adjacency remains extensible, but deterministic published hierarchy retrieval and testing are absent.                                                                                                                                          |
|   7 | PARTIAL | The SQL migration enforces non-null organization ownership, but no trusted-context service or bidirectional tenant read/write isolation exists.                                                                                                      |
|   8 | FAIL    | No Assessment graph persistence/reload service or deterministic round-trip test exists. The answer contract and persistence model remain divergent.                                                                                                  |
|   9 | FAIL    | The SQL migration has revision-number/idempotency uniqueness, but no construction/finalization state, atomic service, payload fingerprint, concurrency control, retry behavior, or immutable-history test exists.                                    |
|  10 | FAIL    | Foreign keys exist, but published CurriculumVersion and same-version node-link rules are not enforced in the domain or database.                                                                                                                     |
|  11 | PARTIAL | Basic enums and `TEST`-requires-`POINTS` validation exist. Worksheet fixtures, persistence proof, and the 10,000-unit Test default are absent.                                                                                                       |
|  12 | FAIL    | Only one valid tree and two invalid cases are tested. `NONE` ignores nested scores; subquestion range/null handling and rubric sums are incomplete; no database finalization enforcement exists.                                                     |
|  13 | PARTIAL | SQL XOR checks exist for answer/rubric targets and some nested key/order uniqueness exists. Answer key/order is absent from persistence, rubric partial uniqueness and score relationships are missing, and no database test exists.                 |
|  14 | FAIL    | Direct database update/delete/late-insert protection for published Curriculum and finalized Assessment graphs does not exist.                                                                                                                        |
|  15 | FAIL    | No `CREATE_ASSESSMENT`, `READ_ASSESSMENT`, or `CREATE_ASSESSMENT_REVISION` authorization operations or non-disclosing cross-tenant tests were added.                                                                                                 |
|  16 | FAIL    | No Phase 20 audit event implementation or safety test exists.                                                                                                                                                                                        |
|  17 | PARTIAL | Five new generated artifacts pass byte-drift checking, but Assessment summary/finalized-response artifacts and Phase 20 runtime parsing/rejection tests are absent. The only runtime contract test still covers Phase 10 health/authentication.      |
|  18 | FAIL    | The Phase 10 implementation report still opens with superseded environment-limited evidence and still reports skipped PostgreSQL tests. TD-008 is not resolved.                                                                                      |
|  19 | FAIL    | Lint, typecheck, unit, contracts, architecture, integration, dual migration, and build pass. `pnpm format-check` fails on the implementation report, no required Phase 20 property/database/security tests exist, and there is no reviewable commit. |
|  20 | PASS    | No Phase 30+ functionality was added.                                                                                                                                                                                                                |

Summary: 2 PASS, 6 PARTIAL, 12 FAIL, 0 NOT VERIFIED.

## 3. Architecture compliance

The attempted model still points toward the approved modular-monolith, typed Curriculum, tenant-owned Assessment, integer-scoring, and immutable-revision architecture. No Phase 30 scope or alternative ADR was introduced.

Architecture compliance is nevertheless not achieved:

- ADR-004 remains aspirational; revision graphs are mutable database rows with no construction or finalization state.
- The migration and Prisma schema are materially out of alignment. The migration contains fields and constraints that Prisma omits, including Curriculum version metadata, descriptions, timestamps, uniqueness constraints, and several Assessment fields.
- The contract answer shape (`key`, `text`, optional explanation) does not map to the Prisma answer shape (`answerData`) and lacks the approved deterministic answer ordering.
- Curriculum parent and Assessment node references can cross versions.
- Published/deprecated Curriculum content and Assessment revisions can be edited directly.
- Tenant ownership is a foreign key rather than an authorization boundary.
- The implementation-session report did not follow the remediation prompt's responsibility/invariant/authorization matrices or completion behavior.

These are implementation omissions and shortcuts, not a reason to redesign the approved architecture. No new ADR is required.

## 4. Integration impact

- **Previous phases:** the Phase 10 unit, architecture, build, and PostgreSQL integration behaviors continue to pass in the current tree.
- **Upcoming phases:** Phase 30 remains blocked because source/knowledge data cannot safely depend on mutable or cross-version Curriculum records.
- **Database/schema:** clean deployment works, but the resulting schema does not enforce the approved Phase 20 invariants and does not match the complete Prisma model required by services.
- **APIs/contracts:** the package compiles, but external Assessment response/summary contracts and lossless persistence mapping are missing.
- **AI pipeline:** unchanged and correctly out of scope.
- **Security:** no Phase 20 tenant authorization or isolation evidence exists.
- **Testing:** existing integration tests migrate the new tables but never exercise them.
- **Deployment:** the build passes, but the complete repository quality gate fails formatting and the domain is not production-safe.

## 5. Test and QA review

Independent verification used Node 24.19.0, pnpm 11.19.0, and PostgreSQL 17.10:

| Command                                | Exit | Evidence                                                                                                                                 |
| -------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`       |    0 | Workspace was already up to date.                                                                                                        |
| `pnpm --filter @teach/db run generate` |    0 | Prisma Client generated successfully.                                                                                                    |
| `pnpm format-check`                    |    1 | `docs/phases/20-implementation-report.md` is not formatted.                                                                              |
| `pnpm lint`                            |    0 | Passed with zero warnings.                                                                                                               |
| `pnpm typecheck`                       |    0 | 9/9 package targets passed.                                                                                                              |
| `pnpm test`                            |    0 | 9 files, 26 tests, zero skips; only two tests are new Phase 20 tests.                                                                    |
| `pnpm contracts:check`                 |    0 | 2 files, 7 tests; artifact drift passed, but no Phase 20 runtime cases exist.                                                            |
| `pnpm test:architecture`               |    0 | 1 file, 4 tests passed.                                                                                                                  |
| `pnpm build`                           |    0 | 9/9 targets passed, including the production web build.                                                                                  |
| `pnpm test-integration:local`          |    0 | Three migrations applied to `teaching_test`; 3 files/20 tests passed with zero skips; three migrations then applied to `teaching_clean`. |
| `git diff --check`                     |    0 | No whitespace errors in tracked diffs.                                                                                                   |

The PostgreSQL result proves migration applicability and Phase 10 regression safety only. The integration suite contains no Curriculum or Assessment behavior tests.

## 6. Technical debt update

- TD-009 is partially remediated: compile, Prisma generation, migration, and build now pass, but the complete format gate and traceable commit requirement do not.
- TD-010 remains Critical and open: database lifecycle, hierarchy, same-version, scoring, finalization, and immutability enforcement are absent.
- TD-011 remains Critical and open: services, idempotency, deterministic reload, authorization, tenant isolation, and audit behavior are absent.
- TD-012 remains Critical and open: artifacts are only partial and the required Phase 20 test matrix/complete gate evidence is absent.
- TD-013 remains Critical and open: contract/persistence/scoring divergence is unresolved.
- TD-008 remains Important and open. TD-007 remains Acceptable and deferred.

No additional debt ID is required; the existing blockers already cover the findings.

## 7. Decision Log update

No ADR is added, changed, or superseded. The approved internal `BUILDING → FINALIZED` construction mechanism from the remediation prompt was not implemented.

## 8. Risk Register update

R-013 and R-014 remain High-likelihood/High-impact and open. The passing migration and regression suite do not mitigate invalid-data, historical-mutation, contract-divergence, or false-confidence risks because none of the new database behavior is exercised.

R-004 and R-012 remain monitored and directly applicable to the untested Assessment tenant relation.

## 9. Documentation state

The implementation report is an incremental note rather than the required remediation handoff. It retains the original grouped acceptance table, appends only eight verified commands, repeats that critical work remains, omits invariant and authorization matrices, has no commit hash, and fails formatting. Its runtime-unavailable claim remains in the active report even though the bundled runtime was used later.

The Phase 10 report remains contradictory, so TD-008 is still open. The working tree is on `main` at `4502bbd`; all Phase 20 implementation and architecture documents remain uncommitted.

## 10. Phase verdict

**REQUIRES FIXES – Do not proceed yet**

This attempt successfully restored the toolchain and proved that the additive SQL can be deployed, but it did not execute the actual remediation assignment. The essential product guarantees—valid publication, immutable revisions, exact persisted scoring, atomic/idempotent services, and tenant isolation—remain absent. Phase 30 must not begin.

### Remaining remediation exit conditions

1. Implement the complete `BUILDING → FINALIZED` Assessment transaction/finalization mechanism and database immutability.
2. Implement Curriculum import, publication, deprecation, deterministic reads, lifecycle enforcement, and published-content immutability.
3. Enforce same-version hierarchy and Assessment node references, root/sibling rules, skill-only difficulties, and exact scoring in PostgreSQL and the domain layer.
4. Align contracts, Prisma, and migration fields; add Assessment summary/finalized-response contracts and stable answer/rubric identities/order.
5. Implement trusted-context Assessment services, explicit authorization operations, bidirectional tenant isolation, and safe audits.
6. Add the complete unit/property/PostgreSQL/direct-database/concurrency test matrix with zero skips.
7. Correct the Phase 10 report and produce TD-008 exit evidence.
8. Rewrite the Phase 20 report in the required one-criterion-per-row format and pass formatting.
9. Rerun the complete mandatory sequence successfully, create the local remediation branch/commit, and return its full hash without pushing.
