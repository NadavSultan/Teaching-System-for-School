# Phase Review — Phase 20: Curriculum and Assessment Domain

- Date: 2026-08-18
- Reviewed baseline: `4502bbd` plus the uncommitted Phase 20 working tree
- Implementation report: `docs/phases/20-implementation-report.md`

## 1. Objective completion

Phase 20 did not achieve its objective. The working tree contains an initial set of Zod definitions, domain helper functions, Prisma model text, and an additive SQL migration, but it does not contain an operational Curriculum or Assessment domain.

The current changes do not compile, the Prisma schema is invalid, migrations cannot start through the supported repository command, Phase 20 JSON Schema artifacts are absent, and no Phase 20 service, authorization, audit, property, or PostgreSQL integration tests exist. The implementation report correctly states that the phase is partial, but its claim that the bundled Node runtime was unavailable is superseded by this independent review: Node 24.19.0 and pnpm 11.19.0 were available and exposed concrete failures.

## 2. Acceptance criteria

|   # | Status  | Evidence and required correction                                                                                                                                                                                                                                                      |
| --: | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | FAIL    | Candidate Zod and Prisma definitions exist, but the contracts do not typecheck, Prisma rejects all new one-line enum/model declarations, and the five Phase 20 JSON Schema artifacts are absent. Make all three representations valid, generated, versioned, and mutually consistent. |
|   2 | FAIL    | `pnpm test-integration:local` failed before migration execution with Prisma P1012 validation errors. No migration was applied to either required isolated database. Restore valid Prisma syntax and prove clean deployment twice while retaining every Phase 10 migration.            |
|   3 | FAIL    | A small in-memory transition check exists, but there are no tests and the database does not enforce root type, parent type, or same-version ancestry. Add domain and database enforcement plus full transition/cross-version tests.                                                   |
|   4 | FAIL    | There is no transactional draft-import service or persistence test. The helper checks only some sibling/type rules and does not establish transactional cycle, parent, or size rejection.                                                                                             |
|   5 | FAIL    | Lifecycle enums exist only as invalid Prisma declarations. There is no publish/deprecate service, structural publication gate, legal-transition enforcement, or database immutability trigger/test.                                                                                   |
|   6 | PARTIAL | Typed adjacency is schema-extensible and contains no hard-coded curriculum content, but deterministic published hierarchy retrieval and its tests are absent.                                                                                                                         |
|   7 | PARTIAL | `assessments.organization_id` is non-null in the proposed SQL, but no trusted-context Assessment service or bidirectional tenant-isolation test exists.                                                                                                                               |
|   8 | FAIL    | No Assessment graph persistence/reload service or test exists. Contract and database answer representations also diverge, so lossless round-trip behavior is not currently defined.                                                                                                   |
|   9 | FAIL    | Uniqueness declarations propose revision-number and idempotency constraints, but no atomic/idempotent creation service, safe sequencing mechanism, historical immutability enforcement, or tests exist.                                                                               |
|  10 | FAIL    | Foreign keys exist, but nothing enforces that the CurriculumVersion is published or that linked nodes belong to that same version. There are no domain/database tests.                                                                                                                |
|  11 | PARTIAL | Enums and a basic rule requiring `TEST` + `POINTS` exist. There are no fixtures, persistence path, worksheet mode proof, or 10,000-unit Test default.                                                                                                                                 |
|  12 | FAIL    | The score helper is untested and incomplete: `NONE` does not inspect question/subquestion/rubric scores, negative/maximum validation is incomplete, and rubric relationships are ignored. No persistence/finalization enforcement exists.                                             |
|  13 | PARTIAL | SQL proposes XOR checks for answer/rubric targets and uniqueness for some parent orders. Answer keys/orders are absent from persistence, rubric key/order uniqueness is not protected, scoring relationships are not enforced, and no tests exist.                                    |
|  14 | FAIL    | No database trigger or equivalent rejects direct update/delete of published Curriculum or finalized Assessment content.                                                                                                                                                               |
|  15 | FAIL    | No Phase 20 authorization operations, Assessment repository policy, or non-disclosing cross-tenant tests were added.                                                                                                                                                                  |
|  16 | FAIL    | No curriculum or Assessment audit service/event implementation or safety test exists.                                                                                                                                                                                                 |
|  17 | FAIL    | The contract package fails compilation at `curriculumNodeSchema.extend(...)`; the five registered Phase 20 snapshots are uncommitted because they do not exist, and no Phase 20 runtime/drift tests were added.                                                                       |
|  18 | FAIL    | The contradictory pre-remediation sections in the Phase 10 report remain unchanged; TD-008 has no exit evidence.                                                                                                                                                                      |
|  19 | FAIL    | Format-check, strict typecheck, contract check, build, Prisma validation, migration deployment, and local integration fail. Only lint, 24 existing unit tests, and four existing architecture tests pass; no Phase 20 tests were found.                                               |
|  20 | PASS    | No Phase 30+ knowledge, AI, validation-engine, editor, rendering, deployment, managed-auth, or student functionality was added.                                                                                                                                                       |

Summary: 1 PASS, 4 PARTIAL, 15 FAIL, 0 NOT VERIFIED.

## 3. Architecture compliance

The attempted direction retains several approved decisions: platform-wide curriculum reference data, typed adjacency, immutable-revision intent, integer score units, tenant ownership, the modular monolith, and the Phase 20 scope boundary. No material alternative architecture or new ADR was introduced.

However, the implementation does not yet comply with the approved architecture:

- ADR-004 is only represented by table names and uniqueness declarations; immutable Assessment revision graphs are not enforced.
- Curriculum lifecycle and publication immutability are not implemented at either application or database level.
- Cross-version hierarchy and Assessment-to-curriculum links can violate the approved data boundary in the proposed SQL.
- Tenant ownership exists as a column but has no application authorization boundary.
- The Zod contract and persistence shapes diverge for answers, preventing a reliable domain source of truth.
- Compact one-line source additions, use of `ZodType<any>`, and the absence of tests/documented invariant ownership are shortcuts that obscure correctness and currently break the toolchain.

This is incomplete implementation rather than an approved architectural change. An architecture redesign is not required; the Phase 20 specification remains valid.

## 4. Integration impact

- **Previous phases:** existing unit and architecture regression tests pass, but the invalid Prisma schema prevents the Phase 10 migration/integration path from running in the current tree.
- **Upcoming phases:** Phase 30 is blocked. Knowledge/source records cannot safely reference unpublished, mutable, or cross-version curriculum data.
- **Database/schema:** the supported Prisma migration path is broken. The SQL lacks critical triggers/composite constraints/finalization enforcement even if applied directly.
- **APIs/contracts:** Phase 10 artifacts remain present, but the contract package no longer compiles and the new external artifacts are missing.
- **AI pipeline:** unchanged and correctly out of scope. It must not build on these incomplete Assessment contracts.
- **Security:** tenant isolation for Assessments is not implemented or proven.
- **Testing:** no Phase 20 unit, property, authorization, lifecycle, immutability, or PostgreSQL integration coverage exists.
- **Deployment:** build and migration gates fail, so this state is not deployable.

## 5. Test and QA review

Independent verification used Node 24.19.0, pnpm 11.19.0, and the repository's embedded PostgreSQL 17.10 runner:

| Command                          | Exit | Result                                                                                             |
| -------------------------------- | ---: | -------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` |    0 | Workspace already up to date.                                                                      |
| `pnpm format-check`              |    1 | Four Phase 20 files fail Prettier.                                                                 |
| `pnpm lint`                      |    0 | Passed.                                                                                            |
| `pnpm typecheck`                 |    2 | Contract compile error: `.extend` is unavailable on the declared generic `ZodType`.                |
| `pnpm test`                      |    0 | 8 files, 24 tests passed; these are existing tests and provide no Phase 20 coverage.               |
| `pnpm contracts:check`           |    2 | Failed while building `@teach/contracts`; snapshot drift step was not reached.                     |
| `pnpm test:architecture`         |    0 | 1 file, 4 tests passed.                                                                            |
| `pnpm build`                     |    2 | Failed in `@teach/contracts` with the same TypeScript error.                                       |
| `pnpm test-integration:local`    |    1 | Prisma P1012 reported 18 invalid schema declarations; migration and integration tests did not run. |

The passing regression tests must not be interpreted as Phase 20 evidence. The implementation added no matching test files, and the database gate failed before PostgreSQL migration execution.

## 6. Technical debt update

The following are Critical release blockers and are recorded in the Technical Debt Register:

- TD-009: invalid Phase 20 contracts/Prisma schema and broken build/migration path.
- TD-010: missing database lifecycle, hierarchy, reference, scoring, and immutability enforcement.
- TD-011: missing atomic/idempotent services, tenant authorization, deterministic reload, and safe audits.
- TD-012: missing Phase 20 schemas, tests, clean migration evidence, and CI-equivalent verification.
- TD-013: divergent/incomplete Assessment contracts, persistence structure, and score invariants.

TD-008 remains Important and open. TD-007 remains Acceptable and intentionally deferred.

## 7. Decision Log update

No ADR is added, changed, or superseded. The implementation did not propose a decision requiring approval. Remediation must implement ADR-004 and the approved Phase 20 constraints rather than weakening them.

## 8. Risk Register update

R-013 records the immediate risk of database corruption or historical mutation caused by missing invariant enforcement. R-014 records contract/persistence divergence and false confidence from regression-only test results. R-004 and R-012 remain monitored and have become directly relevant again for the new Assessment tenant relation.

## 9. Documentation state

The master prompt and preparation document provide adequate implementation direction. The implementation report is candid about incompleteness but is not a sufficient handoff: it groups acceptance criteria, lacks exact command/test evidence, incorrectly reports the bundled runtime as unavailable, and does not document responsibility/invariant/authorization matrices.

TD-008 was not addressed. There is no Phase 20 branch or reviewable commit, and the implementation plus preparation documents remain in the working tree. A remediation session must preserve the historical report, replace its provisional evidence with exact results, and produce an intentional commit without pushing unless explicitly authorized.

## 10. Phase verdict

**REQUIRES FIXES – Do not proceed yet**

Phase 20 is an early partial scaffold and is not operational. The build and migration paths are broken, while the phase-defining guarantees—published Curriculum immutability, immutable Assessment revisions, exact scoring, atomic/idempotent persistence, and tenant isolation—are absent and untested. These are foundational correctness and security gates, not follow-up polish. Complete Phase 20 remediation and return with a revised implementation report before preparing or starting Phase 30.

### Required remediation exit conditions

1. Restore valid, formatted, strictly typed Zod and Prisma source; generate and commit all Phase 20 JSON Schema artifacts.
2. Implement complete Curriculum lifecycle/import/read services and domain/database enforcement for hierarchy, publication, deprecation, and immutability.
3. Implement atomic, idempotent, monotonically versioned Assessment graph creation/reload with finalized database immutability.
4. Align Assessment contracts and persistence, including stable answer/rubric identities, deterministic ordering, targets, curriculum references, and exact score invariants.
5. Add explicit trusted-context authorization, bidirectional tenant isolation, and safe audit behavior.
6. Add the required unit/property/PostgreSQL tests, including direct-database rejection tests and two clean migration targets.
7. Consolidate the Phase 10 report and provide TD-008 exit evidence.
8. Pass every format, lint, strict typecheck, unit/property, zero-skip integration, architecture, contract drift, migration, and build gate.
9. Update the Phase 20 report with one row per acceptance criterion, exact commands, exit codes, counts, zero skips, deviations, debt, risks, and a reviewable local commit hash.
