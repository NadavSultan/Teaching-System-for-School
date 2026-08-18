# Phase Re-Review 3 — Phase 20 Corrective Remediation

- Date: 2026-08-18
- Corrective implementation commit: `0f79cd3f90b743b30b460e473261f5ef9cbc8433`
- Documentation-stamp HEAD: `4beaec716c58a8ba01d3ba21de2b13277a2e3d56`
- Branch: `codex/phase-20-remediation`
- Prior verdict: **REQUIRES FIXES – Do not proceed yet**

## 1. Objective completion

The corrective commit fixes the three database bypasses confirmed in Re-Review 2: direct `FINALIZED` insertion, published CurriculumVersion metadata mutation, and non-null rubric scores in `NONE`. It also fixes the lint defect, terminal Skill hierarchy handling, all-null rubric behavior, published Curriculum mapping, and nested finalized-response identities.

Phase 20 is still not complete. A new independent PostgreSQL probe confirmed that a section can be moved from an already finalized revision into a new `BUILDING` revision and committed after finalizing the new revision. This mutates the historical finalized graph and violates ADR-004. Code inspection shows the same OLD-owner weakness in other Assessment child/link update guards.

The final contract drift gate also fails because the generated `finalized-assessment-revision.v1.json` artifact was not regenerated after its Zod response shape changed.

## 2. Acceptance criteria

|   # | Status  | Evidence and remaining requirement                                                                                                                                    |
| --: | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | PARTIAL | Contracts/models are implemented, but the finalized-response JSON Schema is stale.                                                                                    |
|   2 | PASS    | Both isolated PostgreSQL migration targets apply successfully.                                                                                                        |
|   3 | PARTIAL | Terminal Skill/depth/count validation is fixed, but the complete permanent cross-version/transition database matrix remains limited.                                  |
|   4 | PARTIAL | Atomic import and bounds exist; comprehensive invalid-case PostgreSQL coverage remains incomplete.                                                                    |
|   5 | PASS    | The previously confirmed published-version metadata bypass is fixed and permanently tested.                                                                           |
|   6 | PASS    | Published records are assembled into a deterministic validated hierarchy response.                                                                                    |
|   7 | PARTIAL | Organization scoping exists; the requested complete bidirectional and role/state integration matrix is not present.                                                   |
|   8 | PASS    | Complete graphs persist/reload with deterministic ordering and mapped nested identities.                                                                              |
|   9 | FAIL    | A section can be moved out of a finalized revision, mutating historical revision content.                                                                             |
|  10 | PASS    | Direct-finalized insertion is rejected and published/exact-version checks run on legal finalization.                                                                  |
|  11 | PASS    | Test default and TEST/POINTS validation exist at service/database layers.                                                                                             |
|  12 | PARTIAL | The confirmed NONE/rubric bypass is fixed in SQL and domain all-null behavior is fixed, but the requested permanent direct-database rubric/null matrix is incomplete. |
|  13 | FAIL    | Stable identities/indexes exist, but nested rows can be reparented out of a finalized owner because UPDATE guards inspect only NEW ownership.                         |
|  14 | FAIL    | Direct update immutability is incomplete: the architect's finalized-section reparent probe committed successfully.                                                    |
|  15 | PARTIAL | Explicit operations exist; complete bidirectional/role/inactive evidence remains incomplete.                                                                          |
|  16 | PASS    | Safe identifier-only audit evidence remains valid.                                                                                                                    |
|  17 | FAIL    | `pnpm contracts:check` reports missing/stale JSON Schema snapshots after the response-contract change.                                                                |
|  18 | PASS    | TD-008 remains resolved.                                                                                                                                              |
|  19 | FAIL    | Normal format/lint/typecheck/unit/architecture/build pass, but contract drift fails and the independent immutability probe fails.                                     |
|  20 | PASS    | No Phase 30+ functionality was added.                                                                                                                                 |

Summary: 9 PASS, 6 PARTIAL, 5 FAIL, 0 NOT VERIFIED.

## 3. Architecture compliance

The architecture remains correct and no new ADR is required. The remaining defect is enforcement drift: finalized revision ownership is checked through the NEW parent on UPDATE, allowing content to be moved away from an immutable OLD parent.

The fix must apply consistently to revision links, sections, questions, subquestions, answers, and rubrics. Each UPDATE guard must resolve both OLD and NEW owning revisions and reject the operation when either owner is finalized.

## 4. Integration impact

- Phase 10 regression behavior remains intact.
- Phase 30 remains blocked because historical Assessment snapshots are not yet database-immutable.
- Build and ordinary tests are green, but the release contract drift gate is red.
- No remote merge to `main` is authorized by this review.

## 5. Test and QA review

Independent results:

- Install, Prisma generation, format, lint, 9-package typecheck, 29 unit tests, four architecture tests, and 9-package build passed.
- The committed PostgreSQL suite's 27 tests passed during the architect run.
- `pnpm contracts:check` exited 1: generated contract snapshot missing/stale.
- A temporary PostgreSQL probe attempted to move a section from finalized revision 1 into building revision 2 and then finalize revision 2. The transaction resolved successfully instead of rejecting. The probe was removed afterward.
- The working tree was restored before architectural documentation updates.

## 6. Technical debt update

- TD-008 remains closed.
- TD-009 remains open because the complete final gate sequence is not green.
- TD-010 remains Critical: finalized OLD-owner reparenting bypasses immutability.
- TD-011 remains partially remediated: service/output mapping is improved, but authorization evidence is incomplete.
- TD-012 remains Critical: contract drift and the missing permanent adversarial move tests remain.
- TD-013 remains partially remediated: response/scoring improved, but immutable ownership protection remains incomplete.

## 7. Decision Log update

No ADR change is required.

## 8. Risk Register update

R-013 and R-014 remain open. The independent probe again demonstrates that passing normal service-path tests does not prove all database mutation paths.

## 9. Documentation state

The implementation report's all-PASS table and contract-gate claim do not match independent evidence. It must be corrected after the remaining trigger and artifact fixes.

## 10. Phase verdict

**REQUIRES FIXES – Do not proceed yet**

The remaining code fix is narrow: enforce immutable OLD and NEW ownership on every Assessment child/link UPDATE, add permanent reparent tests, regenerate contract artifacts, rerun all gates, and update the implementation report. The branch may be pushed for backup/review, but it must not be merged into `main` or used as the Phase 30 baseline.

### Final exit conditions

1. UPDATE guards for links, sections, questions, subquestions, answers, and rubrics reject when either OLD or NEW owner revision is `FINALIZED`.
2. Add permanent direct reparent/move tests, including the confirmed section counterexample and representative deep descendants/links.
3. Regenerate all JSON Schema artifacts and make `pnpm contracts:check` pass byte-for-byte.
4. Add the missing permanent direct-database scoring and authorization matrices identified in Re-Review 2.
5. Update the report, rerun every final gate, create a corrective commit, and push it to the same branch without merging.
