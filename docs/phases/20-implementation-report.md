# Phase 20 implementation report — final corrective remediation

Status: **implementation verified; ready for independent architectural re-review; not Phase-approved**.

- Branch: `codex/phase-20-remediation`
- Remote baseline before final remediation: `9d48b48d431327004336d8418a7b4f5f2f5284c7`
- Final implementation commit: `ec02ddb49029d5de2a474615abc9376f0d7e008c`
- Verification date: 2026-08-21
- Runtime: Node 24.19.0, pnpm 11.19.0, PostgreSQL 17.10

The implementation commit contains the final migration enforcement, generated contract artifact, persisted authorization resolver, permanent adversarial matrices, and reproducible migration-drift gate. This report records implementation evidence only. It does not approve Phase 20; the independent architecture review owns that verdict. Phase 30 was not started.

## Files and responsibility map

| Responsibility                   | Final implementation location                 | Verified behavior                                                                     |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Runtime contracts                | `packages/contracts/src/index.ts`             | Strict Curriculum and Assessment v1 request/response contracts                        |
| Generated artifacts              | `packages/contracts/schemas`                  | Seven Phase 20 JSON Schemas generated from Zod; byte-drift check passes               |
| Domain invariants                | `packages/domain/src/index.ts`                | Typed Curriculum hierarchy, lifecycle transitions, integer score validation           |
| Persisted authorization          | `packages/db/src/index.ts`                    | Database-resolved access context and tenant-scoped Assessment operations              |
| API workspace context            | `apps/api/src/app.module.ts`                  | Production workspace path uses the persisted resolver                                 |
| Database enforcement             | Phase 20 migration                            | Lifecycle, scoring, reference, construction, and immutable ownership triggers/checks  |
| Permanent PostgreSQL evidence    | `packages/db/src/phase20.integration.test.ts` | Curriculum, scoring, authorization, reparenting, concurrency, audits, and persistence |
| Isolated migration/drift harness | `scripts/with-test-postgres.mjs`              | Two clean targets plus migration-history drift comparison using a shadow database     |

## Lifecycle and finalization design

Curriculum versions follow `DRAFT → PUBLISHED → DEPRECATED`. Publication validates the persisted hierarchy and required Skill difficulties. Published content, difficulties, release metadata, and lifecycle identity cannot be changed; only the legal deprecation transition is allowed.

Assessment revisions are inserted as `BUILDING`, fully constructed within one transaction, and transitioned once to `FINALIZED`. A deferred constraint prevents a `BUILDING` revision from committing. Direct `FINALIZED` insertion and every other state transition are rejected. Finalization validates the published Curriculum reference, Assessment type/scoring mode, complete integer aggregates, and rubric totals.

## OLD and NEW ownership immutability

Every UPDATE guard resolves both ownership paths. An update is rejected when either the OLD or NEW owning Assessment revision is `FINALIZED` for:

- revision-node links;
- sections;
- questions;
- subquestions;
- question-targeted and subquestion-targeted answers; and
- question-targeted and subquestion-targeted rubric criteria.

Permanent PostgreSQL tests construct otherwise-valid `FINALIZED` and `BUILDING` graphs. They mutate the actual relationship columns in both directions, use savepoints to isolate each expected rejection, assert the specific `finalized revision content is immutable` error, finalize the valid BUILDING graph afterward, and reload owner IDs to prove neither graph changed. INSERT and DELETE protections remain in force.

## Contract and JSON Schema inventory

The Phase 20 inventory is:

1. `curriculum-import.v1.json`
2. `published-curriculum.v1.json`
3. `assessment-creation.v1.json`
4. `assessment-revision.v1.json`
5. `finalized-assessment-revision.v1.json`
6. `assessment-summary.v1.json`
7. `score-validation-result.v1.json`

`finalized-assessment-revision.v1.json` now matches the current validated response contract, including revision, section, question, subquestion, answer, and rubric database identities. `pnpm contracts:check` rebuilds the package, performs byte-for-byte generation drift detection, and executes 3 files / 9 runtime tests.

## Invariant enforcement matrix

| Invariant               | Contract                                   | Domain                                         | Service                                         | PostgreSQL                                                             |
| ----------------------- | ------------------------------------------ | ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Typed Curriculum chain  | Bounded discriminated nodes                | Exact next-child and terminal Skill validation | Atomic import                                   | Parent type, root, same-version triggers                               |
| Sibling identity/order  | Bounded codes/orders                       | Duplicate detection                            | Transactional import                            | Root/non-root unique indexes                                           |
| Difficulty targets      | Difficulty enum                            | Skill-only and duplicate validation            | Atomic persistence                              | Skill-only trigger and unique band constraint                          |
| Curriculum lifecycle    | Versioned publish/read shapes              | Legal transition predicate                     | Publish/deprecate operations                    | Draft-only insert, publication completeness, immutable release trigger |
| Tenant authority        | Organization fields excluded from requests | Operation-specific policy                      | Persisted resolver and scoped queries           | Non-null organization FK                                               |
| Revision construction   | Bounded complete graph                     | Deterministic score tree                       | Serializable transaction, idempotency, row lock | Deferred BUILDING guard and one-way state trigger                      |
| Curriculum references   | UUID/version contracts                     | —                                              | Published exact-version lookup                  | Published/same-version link trigger                                    |
| Exact scoring           | Integer bounded units                      | NONE/POINTS/TEST tree validation               | TEST default of 10,000                          | Range checks plus scoped aggregate/rubric finalization trigger         |
| Stable descendants      | Generated IDs in finalized response        | —                                              | Deterministic reload mapping                    | UUID PKs, XOR checks, key/order indexes                                |
| Historical immutability | Finalized response shape                   | —                                              | No mutation operation                           | OLD/NEW link, section, question, descendant guards                     |
| Safe audit evidence     | No content-bearing audit contract          | —                                              | Identifier-only metadata                        | Append-only audit trigger                                              |

## Curriculum invalid-case PostgreSQL evidence

Permanent cases cover legal typed construction and publication plus separate rejection of invalid root/parent transitions, a child after terminal Skill, cross-version parents, root and non-root sibling code/order collisions, non-Skill difficulty targets, duplicate difficulty bands, empty publication, structurally incomplete publication, cycles/depth beyond the five typed levels, aggregate hierarchy size above 10,000, illegal lifecycle transitions, and direct post-publication node/difficulty insert, update, move, and delete attempts. Legal `DRAFT → PUBLISHED → DEPRECATED` continues to pass, and published reads remain deterministic and contract-validated.

## Direct-database scoring evidence

The PostgreSQL matrix bypasses the service score validator and constructs revisions directly:

- `NONE`: a fully null graph finalizes; individual non-null revision, section, question, subquestion, question-rubric, and subquestion-rubric values each fail; rolled-back assessments are counted to prove no partial persistence.
- `POINTS`: valid direct questions, composite questions/subquestions, question rubrics, subquestion rubrics, and intentionally all-null unused rubrics finalize with exact totals.
- Missing revision/section/question/subquestion aggregates, mixed-null rubrics, revision/section/question/rubric mismatches, negative values, values above `MAX_SCORE_UNITS`, and non-integer input are rejected by the named trigger/check/datatype boundary.
- Zero is accepted as the valid lower boundary. A TEST with POINTS finalizes, TEST/NONE is rejected, and the service-path TEST default of 10,000 remains permanently asserted.

## Authorization operation and tenant matrix

`resolveAccessContext` loads the actual user, membership, role, organization lifecycle, and workspace type from PostgreSQL. Assessment operations then apply the trusted policy and tenant scope.

| Persisted state                         | CREATE_ASSESSMENT              | READ_ASSESSMENT                | CREATE_ASSESSMENT_REVISION     |
| --------------------------------------- | ------------------------------ | ------------------------------ | ------------------------------ |
| Active TEACHER in own organization      | Allow                          | Allow                          | Allow                          |
| Active COORDINATOR in own organization  | Allow                          | Allow                          | Allow                          |
| Active SCHOOL_ADMIN in own organization | Allow                          | Allow                          | Allow                          |
| Inactive user                           | Deny                           | Deny                           | Deny                           |
| Inactive membership                     | Deny                           | Deny                           | Deny                           |
| Inactive organization                   | Deny                           | Deny                           | Deny                           |
| Missing membership                      | Resolver denies                | Resolver denies                | Resolver denies                |
| PLATFORM_ADMIN membership/principal     | No implicit tenant access      | No implicit tenant access      | No implicit tenant access      |
| Personal Workspace TEACHER              | Own Personal organization only | Own Personal organization only | Own Personal organization only |

Two persisted school organizations each own an Assessment and finalized revision. A-to-B and B-to-A reads return `null`; foreign and nonexistent write targets return the same `Resource not found or unavailable` message; neither tenant can create a revision for the other. A Personal Workspace teacher can create content only in the resolved Personal organization.

## Audit and redaction evidence

Publication, deprecation, Assessment creation, and revision finalization audits contain identifiers, schema/lifecycle state, and revision numbers only. Permanent assertions exclude Assessment titles and answer content. API redaction tests remain part of the unit gate, and audit rows remain append-only.

## Acceptance criteria

|   # | Status | Permanent executable evidence                                                                      |
| --: | ------ | -------------------------------------------------------------------------------------------------- |
|   1 | PASS   | Versioned Zod contracts, seven generated Phase 20 schemas, Prisma models, and migration            |
|   2 | PASS   | All three migrations apply from zero to `teaching_test` and independently to `teaching_clean`      |
|   3 | PASS   | Complete typed parent/root/cross-version/terminal/depth matrix at domain and PostgreSQL boundaries |
|   4 | PASS   | Atomic import, duplicate/order/difficulty/size and invalid publication cases                       |
|   5 | PASS   | Published nodes, difficulties, moves, deletes, metadata, and illegal lifecycle writes rejected     |
|   6 | PASS   | Published hierarchy is ordered, assembled, and contract-validated                                  |
|   7 | PASS   | Persisted resolver plus role/state, Personal Workspace, and bidirectional tenant matrix            |
|   8 | PASS   | Full graph persists/reloads with deterministic order and nested generated identities               |
|   9 | PASS   | Atomic BUILDING construction, idempotent retry/conflict, concurrent allocation, and preservation   |
|  10 | PASS   | Direct FINALIZED insert rejected; finalization requires published exact Curriculum version         |
|  11 | PASS   | TEST requires POINTS, defaults to 10,000 in service path, and valid direct TEST persists           |
|  12 | PASS   | Direct NONE/POINTS null, range, aggregate, rubric, mismatch, and rollback matrix                   |
|  13 | PASS   | XOR targets, stable IDs, partial key/order indexes, and both-target answer/rubric tests            |
|  14 | PASS   | Direct Curriculum mutation and Assessment OLD/NEW ownership mutation tests                         |
|  15 | PASS   | Explicit operations, persisted trusted context, both tenant directions, non-disclosing results     |
|  16 | PASS   | Identifier-only audit assertions and append-only database enforcement                              |
|  17 | PASS   | Generated artifact byte-drift and runtime acceptance/rejection tests                               |
|  18 | PASS   | Phase 10 historical report clarification remains preserved                                         |
|  19 | PASS   | Complete local final gate below passes with zero skipped tests                                     |
|  20 | PASS   | Diff inspection confirms no Phase 30 capability or other out-of-scope feature                      |

These are implementation PASS claims submitted for independent review, not an architectural approval.

## Final implementation verification

| Command                                | Exit | Exact result                                                                     |
| -------------------------------------- | ---: | -------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`       |    0 | Lockfile current; pnpm 11.19.0                                                   |
| `pnpm --filter @teach/db run generate` |    0 | Prisma Client 6.19.3 generated                                                   |
| `prisma format`                        |    0 | Schema parsed/formatted for verification; unrelated rewrite excluded from commit |
| `prisma validate`                      |    0 | Schema valid with validation datasource environment                              |
| `pnpm contracts:generate`              |    0 | Contract package built and artifacts generated                                   |
| `pnpm format-check`                    |    0 | All matched files formatted                                                      |
| `pnpm lint`                            |    0 | Zero warnings/errors                                                             |
| `pnpm typecheck`                       |    0 | 9/9 package targets                                                              |
| `pnpm test`                            |    0 | 10 files, 31 tests, zero skips                                                   |
| `pnpm contracts:check`                 |    0 | 3 files, 9 tests, zero skips; byte drift clean                                   |
| `pnpm test:architecture`               |    0 | 1 file, 4 tests, zero skips                                                      |
| `pnpm test-integration:local`          |    0 | 4 files, 35 tests, zero skips; PostgreSQL 17.10                                  |
| clean `teaching_test` migration        |    0 | 3/3 migrations applied from zero                                                 |
| clean `teaching_clean` migration       |    0 | 3/3 migrations applied independently from zero                                   |
| migration-history drift                |    0 | `No difference detected`; isolated `teaching_shadow` comparison                  |
| `pnpm build`                           |    0 | 9/9 package targets                                                              |
| `git diff --check`                     |    0 | No whitespace errors                                                             |

## Deviations, risks, and technical debt

- No remote push, merge, hosted CI run, independent QA, or architecture verdict was performed.
- The migration drift gate compares migration history with the independently migrated clean database. The hand-authored SQL intentionally contains enforcement beyond the Prisma client datamodel.
- Existing register entries TD-009 through TD-013 and risks R-013/R-014 are not edited here; the independent Phase 20 re-review must decide whether this executable evidence satisfies their exit conditions.
- No genuine implementation blocker remains. Phase 30 was not started.
