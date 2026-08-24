# Phase Re-Review 4 — Phase 20 Independent Architectural Review

- Date: 2026-08-24
- Branch: `codex/phase-20-remediation`
- Reviewed implementation commit: `ec02ddb49029d5de2a474615abc9376f0d7e008c`
- Reviewed documentation-stamp HEAD: `e438ba0b6e45a0a0ea4079a09813b7e5a4e033bd`
- Baseline reviewed: `9d48b48`
- Reviewer role: independent architect; no production, migration, contract, test, or package changes were made.

## 1. Objective completion

Phase 20 establishes versioned Curriculum and structured Assessment revisions with PostgreSQL-enforced lifecycle, scoring, tenancy, auditing, and immutable historical content. The corrective implementation resolves the three blockers recorded by Re-Review 2 and the OLD-owner reparenting and artifact-drift blockers recorded by Re-Review 3.

Independent result: all required gates passed from the exact target HEAD. The review inspected the complete substantive `9d48b48..e438ba0` diff and both commits separately. `ec02ddb` contains only the justified Phase 20 resolver, migration enforcement, generated Phase 20 schema, tests, and test harness changes. `e438ba0` contains only `docs/phases/20-implementation-report.md`. No Phase 30+ capability or unrelated feature was found.

## 2. Acceptance criteria

| Criterion                                        | Status | Evidence                                                                                                                                                                                                                                                                                                                                          | Required follow-up                                                 |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Zod, JSON Schema, PostgreSQL models           | PASS   | Seven committed v1 schemas; `pnpm contracts:check` passed byte-drift generation and 9 runtime tests. Prisma/migration define Curriculum, version/node/difficulty, Assessment/revision/descendant records.                                                                                                                                         | Preserve schema snapshots as release artifacts.                    |
| 2. Two clean migrations and Phase 10 regressions | PASS   | Isolated PostgreSQL 17.10 harness applied all 3 migrations from zero to `teaching_test` and independently to `teaching_clean`; integration suite passed 35/35.                                                                                                                                                                                    | Keep clean-target migration gate in CI.                            |
| 3. Typed adjacency                               | PASS   | Domain hierarchy tests and direct PostgreSQL matrix reject invalid root/parent, cross-version parent, terminal Skill child, depth/cycle paths; migration guards enforce parent type and version.                                                                                                                                                  | None.                                                              |
| 4. Atomic invalid import                         | PASS   | Domain/integration cases cover duplicate root/non-root code/order, Skill-only unique difficulties, invalid parent, empty/incomplete publication, aggregate size >10,000, cycle/depth; service import is transactional.                                                                                                                            | Retain boundary matrices when imports gain HTTP exposure.          |
| 5. Immutable publication lifecycle               | PASS   | `phase20_curriculum_version_guard`, node/difficulty guards, and permanent direct-SQL cases reject post-publication metadata/content insert/update/delete/move; legal `DRAFT -> PUBLISHED -> DEPRECATED` passes.                                                                                                                                   | None.                                                              |
| 6. Deterministic published hierarchy             | PASS   | Service assembles ordered published hierarchy and parses it with `publishedCurriculumSchema`; tests cover ordered contract-valid output. Typed adjacency avoids hard-coded grade/subject branches.                                                                                                                                                | None.                                                              |
| 7. Tenant ownership and bidirectional isolation  | PASS   | Non-null `assessments.organization_id`; persisted `resolveAccessContext`; tests cover A-to-B/B-to-A reads/writes, teacher/coordinator/school-admin, lifecycle failures, Personal workspace, and non-disclosing missing/foreign results.                                                                                                           | Apply the same matrix to each future tenant-owned Phase 30 entity. |
| 8. Lossless revision graph                       | PASS   | `mapFinalizedAssessmentRevision` includes revision, section/question/subquestion, both answer/rubric target forms, stable IDs and ordered relations; integration reload and contract validation pass.                                                                                                                                             | Keep deterministic-order contract tests with later fields.         |
| 9. Atomic/idempotent immutable revisions         | PASS   | Serializable creation transaction, idempotency/fingerprint conflict and concurrent revision-allocation tests pass. Deferred commit guard rejects unfinalized BUILDING; OLD/NEW guard tests prove finalized graphs cannot be moved or changed.                                                                                                     | None.                                                              |
| 10. Published consistent references              | PASS   | Direct `FINALIZED` insert rejected; finalization trigger requires published exact Curriculum version; link guard checks same version and immutable old/new ownership.                                                                                                                                                                             | None.                                                              |
| 11. NONE/POINTS/Test scoring mode                | PASS   | Direct DB tests accept valid NONE/POINTS, reject TEST/NONE, and service tests assert TEST defaults to 10,000 POINTS units.                                                                                                                                                                                                                        | None.                                                              |
| 12. Exact score invariants                       | PASS   | Direct PostgreSQL matrix covers NONE null enforcement, POINTS aggregates/rubrics, missing/mixed values, zero, negative, overflow, non-integer input, mismatches, and rollback/no partial persistence. Integer columns/domain rules avoid floating-point arithmetic.                                                                               | None.                                                              |
| 13. Answer/rubric integrity                      | PASS   | XOR checks, unique target key/order, range checks, stable IDs, and permanent question/subquestion answer/rubric OLD/NEW move tests pass.                                                                                                                                                                                                          | None.                                                              |
| 14. Direct mutation rejection                    | PASS   | Database tests exercise published Curriculum mutation and real relationship-column moves for links, sections, questions, subquestions, both answer targets, and both rubric targets. Each rejects with `finalized revision content is immutable`; reload proves owner graph unchanged.                                                            | None.                                                              |
| 15. Explicit non-disclosing authorization        | PASS   | Domain enumerates `CREATE_ASSESSMENT`, `READ_ASSESSMENT`, `CREATE_ASSESSMENT_REVISION`; production `WorkspaceService` resolves persisted context. Tests cover inactive user/membership/organization, missing membership, platform admin no implicit tenant access, roles, Personal restriction, and indistinguishable foreign/nonexistent writes. | None.                                                              |
| 16. Safe append-only audits                      | PASS   | Publication/deprecation/assessment/revision-finalization audits are identifier/state metadata; tests exclude title/answer content and append-only DB enforcement rejects change/delete.                                                                                                                                                           | Reassess redaction when Phase 30 adds source content.              |
| 17. Contract drift/backward compatibility        | PASS   | `contracts:check` passed generated-byte comparison and 3 files/9 tests. Finalized response IDs and ordering are represented in Zod, generated schema, mapping, and persistence reload. Architecture tests passed 4/4.                                                                                                                             | Treat regenerated schemas as mandatory review artifacts.           |
| 18. Phase 10 report / TD-008                     | PASS   | Phase 10 historical-report clarification remains preserved; prior reviews and current implementation report correctly treat current Phase 20 evidence separately.                                                                                                                                                                                 | Master session may retain TD-008 closed.                           |
| 19. Full gate                                    | PASS   | Independent commands below all exited 0 after dependency installation and Prisma generation; tests report 31 unit, 9 contract, 4 architecture, 35 integration tests, all zero skips.                                                                                                                                                              | Run the same gate in hosted CI before merge/release.               |
| 20. Out-of-scope protection                      | PASS   | Full `9d48b48..e438ba0` scope contains no knowledge/source, AI, validation-engine, editor, rendering, deployment, managed-auth, or student feature.                                                                                                                                                                                               | Maintain this boundary for Phase 30 planning.                      |

## 3. Architecture compliance

The implementation conforms to ADR-002 modular-monolith ownership, ADR-004 immutable revisions, and ADR-006 server-enforced tenancy. Curriculum writes remain in its application service; Assessment operations use an authorization context loaded from persisted User/Membership/Organization records rather than a caller-assembled trust object. PostgreSQL supplements Prisma for rules needing transactional, cross-row enforcement. This is an intentional and documented database-boundary design, not Prisma drift.

No new ADR is needed. The migration’s trigger density is justified by direct-database immutability and scoring requirements. The implementation report is a claim set only; this report supplies the independent verdict.

## 4. Integration impact

Phase 10 contracts and tenancy remain compatible: format, typecheck, architecture, unit, integration, migration, and build gates pass. Phase 30 may depend on approved Curriculum version/node identities and finalized Assessment revision identities/lifecycle, but must not add source/provenance foreign keys before it owns those entities. Existing contracts, integer score units, release metadata, immutable finalized graph, and persisted tenant resolver are protected interfaces.

## 5. Test and QA evidence

Environment: Node 24.19.0, pnpm 11.19.0, PostgreSQL 17.10. The first sandboxed frozen install was blocked by restricted package retrieval; the same frozen command then completed using the approved package path. Initial commands without Node on PATH failed before program execution; all listed gate results are the reruns using the pinned local Node runtime.

| Command                                | Exit | Independent result                                                                                                                                                                     |
| -------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`       |    0 | Lockfile current; 364 packages linked under pnpm 11.19.0.                                                                                                                              |
| `pnpm --filter @teach/db run generate` |    0 | Prisma Client 6.19.3 generated.                                                                                                                                                        |
| `pnpm format-check`                    |    0 | All matched files formatted.                                                                                                                                                           |
| `pnpm lint`                            |    0 | Zero warnings/errors.                                                                                                                                                                  |
| `pnpm typecheck`                       |    0 | 9/9 package targets passed.                                                                                                                                                            |
| `pnpm test`                            |    0 | 10 files, 31 tests, zero skips.                                                                                                                                                        |
| `pnpm contracts:check`                 |    0 | 3 files, 9 tests; generated-artifact byte drift clean.                                                                                                                                 |
| `pnpm test:architecture`               |    0 | 1 file, 4 tests.                                                                                                                                                                       |
| `pnpm test-integration:local`          |    0 | 4 files, 35 tests, zero skips; fresh `teaching_test` migrations; fresh `teaching_clean` migrations; `MIGRATION_DRIFT=PASS`, `No difference detected` using isolated `teaching_shadow`. |
| `pnpm build`                           |    0 | 9/9 targets, production web build completed.                                                                                                                                           |
| `git diff --check`                     |    0 | No whitespace errors.                                                                                                                                                                  |

### Adversarial database evidence

The permanent PostgreSQL integration matrix is also the focused adversarial probe set. It bypasses service validation for lifecycle/scoring cases, uses real relationship-column updates in both directions, savepoints for expected rejection without poisoning the transaction, verifies the named immutability error, then reloads owners. It covers revision-node links, sections, questions, subquestions, question/subquestion answers, and question/subquestion rubrics; valid BUILDING content can still finalize afterward. It additionally proves direct FINALIZED insertion, published release metadata mutation, and scored NONE finalization are rejected—the counterexamples from Re-Review 2—and direct old-owner reparenting is rejected—the counterexample from Re-Review 3.

## 6. Technical debt recommendations

Do not edit the register as part of this review. Recommended deliberate master-session updates:

- TD-009: close; final reviewable commits and all required local gates now pass.
- TD-010: close; OLD and NEW ownership paths and permanent reparent tests satisfy the exit criterion.
- TD-011: close; validated mapping and full persisted authorization matrix now pass.
- TD-012: close; complete artifacts, direct DB matrix, clean migrations, and zero-skip gate pass.
- TD-013: close; lossless finalized mapping, target/order/score invariants pass.

## 7. Decision-log assessment

No ADR was added, amended, rejected, or superseded. The remediation implements the existing decisions rather than changing them: immutable revision snapshots (ADR-004), server-side tenancy (ADR-006), and modular application/database boundaries (ADR-002).

## 8. Risk-register recommendations

Do not edit the register here. R-013 and R-014 have their Phase 20 release-gate evidence satisfied and may be changed from Open to Mitigated; retain monitoring because future migrations and contracts can regress the same boundaries. R-004 and R-012 remain Mitigated; require the established bidirectional tenant matrix for future tenant-owned domains.

## 9. Documentation state

The reviewed architecture, preparation, master prompt, three preceding re-reviews, implementation report, debt/risk/decision records, and review template were read before judgment. The implementation report’s final PASS claims are now corroborated by this independent run. `project-state.md` remains intentionally stale until the master session applies the recommended post-verdict control-document updates. No Phase 30 preparation or implementation was performed.

## 10. Phase verdict

**APPROVED – Proceed to next phase**

Phase 20 is approved on the exact reviewed commits. The direct-database bypasses previously blocking Curriculum publication, Assessment finalization/scoring, and historical immutability are now enforced and permanently tested. Phase 30 is authorized to begin only within its separately approved scope and with the protected contracts and inherited risks above. This review does not authorize a push, merge, or any Phase 30 implementation by itself.
