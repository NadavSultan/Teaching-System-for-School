# Phase 30 Implementation Report — Source Registry and Controlled Knowledge

Status: **READY FOR INDEPENDENT PHASE 30 REVIEW**

This is an implementation claim set, not a Phase 30 approval. Phase 20 contracts and the independent Phase 20 verdict were not edited. Phase 40 was not started.

## Baseline and commits

- Branch: `codex/phase-30-source-registry`
- Starting HEAD: `9b594f9234d709125febc681bd2f5508d229275c`
- Implementation commit: `d8697293563a170fee96bd00bd1bc5bfbe655269d`
- Report-only commit: recorded below after this report is committed

## Exact implementation scope

Implementation commit files:

- `apps/worker/src/worker.ts`
- `docs/runbooks/database.md`
- `docs/runbooks/ingestion.md`
- `packages/contracts/scripts/generate-schemas.mjs`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/phase30.contracts.test.ts`
- `packages/contracts/schemas/eligible-knowledge-item.v1.json`
- `packages/contracts/schemas/ingestion-request.v1.json`
- `packages/contracts/schemas/ingestion-status.v1.json`
- `packages/contracts/schemas/pedagogical-review-decision.v1.json`
- `packages/contracts/schemas/retrieval-request.v1.json`
- `packages/contracts/schemas/retrieval-result.v1.json`
- `packages/contracts/schemas/source-creation.v1.json`
- `packages/contracts/schemas/source-summary.v1.json`
- `packages/contracts/schemas/source-version-registration.v1.json`
- `packages/contracts/schemas/source-version-summary.v1.json`
- `packages/contracts/schemas/usage-permission-decision.v1.json`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260824003000_phase30_source_registry/migration.sql`
- `packages/db/src/index.ts`
- `packages/db/src/phase30.integration.test.ts`
- `packages/domain/src/index.ts`
- `packages/domain/src/phase30.test.ts`

The migration adds KnowledgeSource, SourceVersion, independent review/permission/lifecycle evidence, IngestionRun, immutable KnowledgeItem, exact curriculum lineage links, PostgreSQL `tsvector` lexical indexing, visibility checks, identity/provenance triggers, and exact-published-curriculum triggers. The worker uses the existing Phase 10 outbox claim, lease, stale recovery, retry, and safe-failure boundary.

## Acceptance criteria

|   # | Result | Evidence                                                                                                                                                                                           |
| --: | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 |  PASS  | Strict Zod contracts, 11 generated Phase 30 schemas, Prisma models, and one reviewed additive migration.                                                                                           |
|   2 |  PASS  | Server SHA-256, source/hash uniqueness, immutable identity trigger, idempotent exact request fingerprint, and changed-hash integration test.                                                       |
|   3 |  PASS  | Separate PedagogicalReview, UsagePermission, and SourceLifecycleEvent append-only evidence; independent review/permission test.                                                                    |
|   4 |  PASS  | Domain truth table tests every negative eligibility dimension; retrieval is relational deny-by-default.                                                                                            |
|   5 |  PASS  | Database visibility check requires platform-shared/null organization or private/non-null organization; service authorization enforces creation policy.                                             |
|   6 |  PASS  | Persisted access context, non-disclosing failures, private-source foreign-tenant rejection, and A→B/B→A retrieval isolation assertions.                                                            |
|   7 |  PASS  | Registration requires published exact CurriculumVersion and node IDs; application and database reject cross-version/free-text bypasses.                                                            |
|   8 |  PASS  | IngestionRun unique content-hash/pipeline key, request upsert, duplicate delivery, and repeated worker ingestion test.                                                                             |
|   9 |  PASS  | Ingestion publishes items and lineage in one transaction; failures are terminal without active partial publication.                                                                                |
|  10 |  PASS  | Existing Phase 10 worker tests cover retry, lease, stale PROCESSING recovery, and terminal safe failure; Phase 30 dispatches through that boundary.                                                |
|  11 |  PASS  | KnowledgeItem stores source, locator, normalized text hash, pipeline/parser, visibility, and exact curriculum lineage; direct provenance mutation rejects.                                         |
|  12 |  PASS  | Suspension removes retrieval immediately; latest permission/review and lifecycle predicates are evaluated at query time.                                                                           |
|  13 |  PASS  | Parameterized PostgreSQL query applies tenant, visibility, lifecycle, review, permission, and curriculum joins before `ts_rank`.                                                                   |
|  14 |  PASS  | Bounded limit, stable score-then-ID order, rank, IDs, locator, hashes, and curriculum lineage are returned and contract-validated.                                                                 |
|  15 |  PASS  | Hebrew fixture query returns the expected eligible paragraph order with zero ineligible and zero cross-tenant results.                                                                             |
|  16 |  PASS  | Audit metadata is identifier/safe-metadata only; database content guard, existing outbox redaction tests, and safe failure classes prevent raw text evidence.                                      |
|  17 |  PASS  | `contracts:check` generated byte-drift gate passes; persisted mappings are Zod-validated before return.                                                                                            |
|  18 |  PASS  | Locked install, Prisma checks, format, lint, typecheck, unit, contracts, architecture, PostgreSQL integration, clean migrations, drift, build, and diff checks all passed with zero skipped tests. |
|  19 |  PASS  | Implementation commit and this exact-evidence report are delivered as separate commits; no push/merge was performed.                                                                               |
|  20 |  PASS  | No AI/model calls, embeddings, semantic retrieval, editor, validation engine, document, deployment, billing, collaboration, or student functionality was added.                                    |

## Final verification evidence

Commands and exit results from the final implementation tree:

| Command                                            | Exit | Result                                            |
| -------------------------------------------------- | ---: | ------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   |    0 | Lockfile current; pnpm 11.19.0.                   |
| `pnpm --filter @teach/db generate`                 |    0 | Prisma Client 6.19.3 generated.                   |
| `prisma format` / `prisma format --check`          |    0 | Schema formatted and check clean.                 |
| `prisma validate`                                  |    0 | Schema valid.                                     |
| `pnpm format-check`                                |    0 | All files formatted.                              |
| `pnpm lint`                                        |    0 | Zero warnings/errors.                             |
| `pnpm typecheck`                                   |    0 | 9/9 package targets.                              |
| `pnpm test`                                        |    0 | 12 files, 35 tests, zero skips.                   |
| `pnpm contracts:check`                             |    0 | 4 files, 11 tests, zero skips; byte drift clean.  |
| `pnpm test:architecture`                           |    0 | 1 file, 4 tests, zero skips.                      |
| `pnpm test-integration:local`                      |    0 | PostgreSQL 17.10; 5 files, 36 tests, zero skips.  |
| clean `teaching_test` migration                    |    0 | 4/4 migrations from zero.                         |
| clean `teaching_clean` migration                   |    0 | 4/4 migrations independently from zero.           |
| isolated `teaching_shadow` migration-history drift |    0 | `No difference detected`; `MIGRATION_DRIFT=PASS`. |
| `pnpm build`                                       |    0 | 9/9 package targets.                              |
| `git diff --check`                                 |    0 | No whitespace errors.                             |

The integration fixture proves independent review and permission, lifecycle suspension, duplicate ingestion, changed-hash non-inheritance, exact Hebrew retrieval lineage, direct SourceVersion identity rejection, direct KnowledgeItem provenance rejection, and private-tenant non-disclosure. Existing Phase 10 outbox integration evidence remains green in the same 36-test integration run.

## Deviations, risks, and remaining debt

- The local parser is intentionally a narrow deterministic plain-text adapter. Additional binary/document adapters require a separately reviewed phase decision and remain out of scope.
- The fixture content reader is a deterministic local/test seam; no arbitrary URL fetch, paid storage provider, malware vendor, or production upload UI is activated.
- PostgreSQL lexical retrieval uses the repository’s reproducible `simple` text-search configuration. This is a Hebrew baseline, not a semantic-quality claim; embeddings and hybrid retrieval remain out of scope.
- Independent review, rights, and Phase 30 approval remain external review gates. This executor did not approve the phase, push, merge, or start Phase 40.
- No genuine implementation blocker remains.

Phase 40 was not started.
