# Phase Re-Review 2 — Phase 20: Curriculum and Assessment Domain

- Date: 2026-08-18
- Implementation commit: `234c17ea38fdef30747f96e927768f058d36762d`
- Documentation-stamp commit: `b857e202d798cef127eeeb299ab21bb8bf3f7d7c`
- Branch: `codex/phase-20-remediation`
- Working tree before and after review probes: clean
- Prior verdict: **REQUIRES FIXES – Do not proceed yet**

## 1. Objective completion

Phase 20 is now substantially implemented. The reviewed commits add aligned Curriculum/Assessment persistence models, seven generated contract artifacts, atomic Curriculum import, transactional Assessment graph construction, idempotency and concurrency handling, deterministic graph reload, explicit Assessment operations, safe audits, PostgreSQL triggers, and real Phase 20 integration tests.

The objective is not fully complete because independent direct-database probes found three critical enforcement bypasses:

1. A revision can be inserted directly as `FINALIZED`, bypassing `BUILDING → FINALIZED`, published-Curriculum validation, graph construction, and score finalization.
2. `CurriculumVersion.human_label` can be updated after publication, so the published release is not fully immutable.
3. A `NONE`-scored Assessment can be finalized with a non-null rubric score because the database finalization trigger does not inspect rubrics in `NONE` mode.

The repository's committed lint gate also fails because `_explicitTotal` is assigned but never used in the new integration test.

These are narrow implementation defects, not a need to redesign Phase 20.

## 2. Acceptance criteria

|   # | Status  | Evidence and remaining requirement                                                                                                                                                                                                                                                                                       |
| --: | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | PARTIAL | Zod v1 contracts, seven JSON Schemas, Prisma models, and migration exist. The finalized-revision response is derived from the creation input and does not provide generated identities for nested records; service reads return Prisma shapes rather than a validated external response mapping.                         |
|   2 | PASS    | All three migrations applied to `teaching_test` and isolated `teaching_clean` on PostgreSQL 17.10; Phase 10 regression tests remained valid.                                                                                                                                                                             |
|   3 | PARTIAL | PostgreSQL enforces root/parent/same-version rules and tests one invalid transition. The required complete domain/database transition matrix and cross-version test are absent; domain validation also permits a new `GRADE` under `SKILL` because both top-level and post-Skill states use the same `null` expectation. |
|   4 | PARTIAL | Draft hierarchy creation is now one transaction. Comprehensive duplicate/cycle/depth/aggregate-size/invalid-parent/difficulty PostgreSQL evidence is incomplete.                                                                                                                                                         |
|   5 | FAIL    | Node and difficulty late writes are guarded, but an independent PostgreSQL probe successfully changed `human_label` on a published CurriculumVersion. Published release metadata is not immutable.                                                                                                                       |
|   6 | PARTIAL | Published reads are explicitly ordered, but `getPublishedCurriculum` returns a flat node collection rather than assembling and validating the published hierarchy response contract.                                                                                                                                     |
|   7 | PARTIAL | Assessment ownership is non-null and service queries are organization-scoped. The integration test proves only one cross-tenant direction and does not exercise the complete active/inactive role matrix through trusted context construction.                                                                           |
|   8 | PASS    | The service persists and reloads sections, questions, subquestions, answers, rubrics, and links with explicit nested ordering and generated database identities.                                                                                                                                                         |
|   9 | PARTIAL | Service-path construction, idempotent retry/conflict, row locking, monotonic concurrent revisions, and prior-revision preservation are present. A direct `FINALIZED` insert bypasses the required construction/finalization mechanism.                                                                                   |
|  10 | FAIL    | Service and node-link triggers validate published/exact-version references, but a direct `FINALIZED` revision referencing a DRAFT CurriculumVersion committed successfully because finalization validation runs only on state update.                                                                                    |
|  11 | PARTIAL | Test defaulting to 10,000 units and service-path `TEST`/`POINTS` behavior are implemented. Direct finalized insertion bypasses database enforcement and can avoid the type/mode rule.                                                                                                                                    |
|  12 | FAIL    | Service-path integer trees are checked, but independent PostgreSQL evidence shows `NONE` can finalize with a non-null rubric score. Database checks also do not comprehensively reject every null aggregate path, and the domain rejects all-null rubrics even though unscored rubrics are allowed.                      |
|  13 | PARTIAL | XOR checks, partial key/order indexes, identities, and direct finalized answer/rubric mutation tests exist. Score relationships are not fully protected because of the rubric finalization bypass.                                                                                                                       |
|  14 | FAIL    | Several direct update/delete attempts are rejected, but published CurriculumVersion metadata can be updated and a revision can enter the database already finalized without immutable construction. The criterion requires complete direct-database rejection.                                                           |
|  15 | PARTIAL | Explicit operations and non-disclosing scoped queries exist. Bidirectional two-tenant and full role/inactive integration evidence is incomplete.                                                                                                                                                                         |
|  16 | PASS    | Identifier-only audits exist for publication, deprecation, Assessment creation, and revision finalization; integration evidence excludes title/answer content.                                                                                                                                                           |
|  17 | PARTIAL | Seven generated artifacts pass byte-drift checks and input runtime tests exist. Complete finalized-response runtime/round-trip coverage and nested generated identities are missing.                                                                                                                                     |
|  18 | PASS    | The Phase 10 report now states that its earlier evidence is pre-remediation history and points to the final verified remediation section. TD-008 exit evidence is sufficient.                                                                                                                                            |
|  19 | FAIL    | Format, typecheck, unit, contracts, architecture, migration, integration, and build pass. `pnpm lint` exits 1 on `packages/db/src/phase20.integration.test.ts:293`; three of four independent adversarial database probes also failed by accepting prohibited states.                                                    |
|  20 | PASS    | No Phase 30+ capability was added.                                                                                                                                                                                                                                                                                       |

Summary: 5 PASS, 10 PARTIAL, 5 FAIL, 0 NOT VERIFIED.

## 3. Architecture compliance

The implementation follows the approved modular-monolith, platform Curriculum, tenant Assessment, integer-score, immutable-revision, trusted-context, and no-Phase-30 design. It implements the approved internal `BUILDING → FINALIZED` mechanism on the normal service path and introduces no unapproved ADR.

Architecture drift remains at the database boundary:

- The construction state is optional in practice because direct insertion as `FINALIZED` is accepted.
- Published CurriculumVersion content metadata is still mutable.
- Database score finalization is weaker than the domain/service validator.
- External finalized-response contracts and persistence return shapes are not yet one lossless validated boundary.

No redesign is required. The existing trigger/service architecture can be corrected locally.

## 4. Integration impact

- **Previous phases:** Phase 10 regressions, migrations, build, and architecture checks remain intact.
- **Upcoming phases:** Phase 30 remains blocked until immutable Curriculum releases and exact finalized revisions are trustworthy database references.
- **Database/schema:** migrations apply cleanly, but direct SQL can create invalid final state and mutate published release metadata.
- **APIs/contracts:** input contracts are strong; finalized output mapping remains incomplete.
- **AI pipeline:** unchanged and correctly out of scope.
- **Security:** organization scoping is present, but the required bidirectional/full-state evidence is incomplete.
- **Testing:** the committed suite misses the three confirmed database bypasses.
- **Deployment:** build succeeds, but lint fails and the persisted invariants are not release-safe.

## 5. Test and QA review

Independent verification used Node 24.19.0, pnpm 11.19.0, and PostgreSQL 17.10.

| Command                                | Exit | Result                                                                                                                                 |
| -------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`       |    0 | Workspace already up to date.                                                                                                          |
| `pnpm --filter @teach/db run generate` |    0 | Prisma Client generated.                                                                                                               |
| `pnpm format-check`                    |    0 | Passed.                                                                                                                                |
| `pnpm lint`                            |    1 | Unused `_explicitTotal` at `phase20.integration.test.ts:293`.                                                                          |
| `pnpm typecheck`                       |    0 | 9/9 targets passed.                                                                                                                    |
| `pnpm test`                            |    0 | 10 files, 29 tests, zero skips.                                                                                                        |
| `pnpm contracts:check`                 |    0 | 3 files, 9 tests; generation/drift passed.                                                                                             |
| `pnpm test:architecture`               |    0 | 1 file, 4 tests passed.                                                                                                                |
| `pnpm build`                           |    0 | 9/9 targets passed.                                                                                                                    |
| `pnpm test-integration:local`          |    0 | Committed suite: 4 files, 27 tests, zero skips; both clean migration targets passed.                                                   |
| Temporary architect probes             |    1 | 3 prohibited states were accepted; 1 probe was correctly rejected. Probe file was then removed and the working tree returned to clean. |
| `git diff --check`                     |    0 | Clean.                                                                                                                                 |

The failing probes independently proved:

- direct `FINALIZED` insert resolved successfully;
- published CurriculumVersion metadata update resolved successfully;
- `NONE` finalization with a non-null rubric score resolved successfully.

## 6. Technical debt update

- TD-008 is closed: the Phase 10 report now clearly distinguishes historical pre-remediation evidence from the final state.
- TD-009 remains Critical: commit traceability exists, but the final lint gate fails.
- TD-010 remains Critical: three database invariant bypasses are confirmed.
- TD-011 remains Critical but partially remediated: services/audits exist; complete response mapping and bidirectional/full-state authorization evidence remain.
- TD-012 remains Critical but partially remediated: substantial integration coverage exists, but adversarial cases and the complete gate are not passing.
- TD-013 remains Critical: finalized response mapping and exact rubric/null database rules remain incomplete.

## 7. Decision Log update

No ADR is added, changed, or superseded. The required fixes implement ADR-004 and the already approved Phase 20 rules.

## 8. Risk Register update

R-013 and R-014 remain open. The new tests materially reduce uncertainty, but the independent bypasses demonstrate that database enforcement and test coverage still diverge. R-004 and R-012 remain monitored until bidirectional/full-state Assessment authorization evidence is complete.

## 9. Documentation state

The implementation report is structured, traceable, and substantially improved. Its all-PASS table and final gate record do not match independent evidence: lint fails, and criteria 5, 10, 12, and 14 have confirmed database counterexamples. The report must be corrected after remediation and must reference the final corrective commit/HEAD.

The repository was clean at documentation HEAD before review and was restored to clean after temporary diagnostic testing.

## 10. Phase verdict

**REQUIRES FIXES – Do not proceed yet**

Phase 20 is close, but the remaining defects are direct violations of its core production guarantees, not documentation polish. A small final remediation must close the direct-finalization, published-version immutability, and `NONE`-rubric bypasses; complete the missing boundary/authorization tests; repair lint; and rerun the entire gate sequence. Phase 30 remains blocked.

### Final remediation exit conditions

1. Reject direct insertion of `AssessmentRevision.state = FINALIZED`; only an existing `BUILDING` row may transition once to `FINALIZED` after all checks.
2. Run published-Curriculum and score-finalization guards on every entry path, including INSERT where relevant.
3. Make all CurriculumVersion content fields immutable once published; permit only `PUBLISHED → DEPRECATED` lifecycle metadata changes.
4. In `NONE`, reject non-null section/question/subquestion/rubric scores in PostgreSQL. In `POINTS`, enforce every non-null aggregate and the approved all-null-or-complete rubric rule.
5. Guard both OLD and NEW ownership paths for updates that could move Curriculum or Assessment child rows out of immutable parents.
6. Fix the domain post-Skill child bug and add the full hierarchy/depth/size matrix.
7. Add the three architect counterexamples as permanent PostgreSQL tests plus move-from-immutable-parent cases.
8. Complete finalized-response mapping/runtime tests with nested generated identities.
9. Add genuinely bidirectional tenant tests and the new-operation inactive/role matrix.
10. Fix lint, update the report classifications/evidence, run every gate after the final report edit, and create a corrective local commit without pushing.
