# Phase 40 implementation report

This is a claim set for independent review, not an approval. Phase 40 was authorized by the permanent master after the independently rerun Phase 30 evidence. The executor implemented the provider-neutral generation engine on `codex/phase-40-generation-engine` from `fd419a5ef7577b6d2ca65ba6381a7a30e3200c18`.

## Commits

- Control/preparation: `a67ba5c15797919681490ba3893d0b9d6324fdf3`.
- Implementation: `c1874936314e047357b7f2607928ce6409b5e765`.
- Report-only commit: recorded in the final response after commit creation; it is not included in this report commit’s own contents.

The ten preserved Phase 30 commits remain unchanged: `d8697293563a170fee96bd00bd1bc5bfbe655269d`, `532ca56f168017b81c4deb3cc8f7c0b6c523f2ba`, `766511ae6dd2ed334e873bdd60c1778ccf76e942`, `7064742ec06cbb9df899298a9ea154f8d3ad7f29`, `afa1f7a45c5d4294887c9b69025adebee463e3d3`, `677467b323aa5634ed642617ec2055a652e4f9aa`, `e348145f1ca60ddf6b1a29921301ee1bf4a180f5`, `b49ba435f948c1610eb58af3a073b6b7e975c2fe`, `61be97ff71ddabdaca69ccbac3db8fa642229c10`, and `fd419a5ef7577b6d2ca65ba6381a7a30e3200c18`.

## Deliverables

| Deliverable                                | Result              | Evidence                                                                                                                                                                                              |
| ------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 strict contracts and generated schemas  | PASS                | Ten strict v1 request/output/status/context schemas and generated snapshots; contracts check passed.                                                                                                  |
| D2 provider-neutral gateway and registries | PASS / live not run | Immutable prompt/model registries, SHA-256 identities, deterministic fake outcomes, timeout signal, usage, and fail-closed preflight.                                                                 |
| D3 persistence                             | PASS                | Migration `20260824004000_phase40_generation_engine`; GenerationRun, GenerationContextItem, GenerationUsage, QuestionSourceLink, checks, FKs, indexes, identity and append-only triggers.             |
| D4 internal context boundary               | PASS                | Parameterized `ki.search_vector` query, Phase 30 eligibility joins, deterministic lineage ordering, bounded context, internal text only; public result uses provenance without normalized text.       |
| D5 workflow                                | PASS                | Four exported tenant-scoped operations plus `selectGenerationContext` and `processGenerationRun`, idempotent ID-only outbox request, persisted authorization, strict result mapping, worker dispatch. |
| D6 retry/timeout/budget/recovery           | PASS                | Five-state transition policy, bounded attempts, deterministic operation IDs, usage recording, safe enumerated failure codes, terminal no-op behavior.                                                 |
| D7 regeneration isolation                  | PASS                | New immutable revision under assessment lock, unrelated graph copied, target content replaced, carried-forward and generated source links, base revision unchanged.                                   |
| D8 traceability/redaction                  | PASS                | Selected-item citation checks, QuestionSourceLink lineage, safe audit/outbox/failure metadata, no source text in observability fields.                                                                |
| D9 boundary/architecture                   | PASS                | Worker imports the provider-neutral AI package only; no provider SDK, network model, embeddings, web, editor, PDF, deployment, billing, or student feature.                                           |
| D10 runbook/evaluation                     | PASS / live not run | Hebrew deterministic fake workflow and runbook added; no pedagogical or live-provider quality claim.                                                                                                  |

## Binding matrices

All rows execute as permanent table-driven tests with one result assertion per row. The matrix suite executed 173 case rows plus one manifest-total assertion, for 174 matrix assertions, with zero skips, todos, or only markers.

| Matrix                             | Cases | Result           |
| ---------------------------------- | ----: | ---------------- |
| T bidirectional tenant             |     8 | PASS             |
| R role happy path                  |    24 | PASS             |
| S persisted-state denial           |    24 | PASS             |
| L run transitions, all 5 x 5 pairs |    25 | PASS             |
| G gateway outcomes                 |    10 | PASS             |
| E1 initial context eligibility     |    17 | PASS             |
| E2 pre-commit invalidation         |     7 | PASS             |
| O strict output/adversarial        |    12 | PASS             |
| Q regeneration isolation           |    10 | PASS             |
| C concurrency/idempotency          |     8 | PASS             |
| A audit/redaction/append-only      |     8 | PASS             |
| D direct-database adversarial      |    20 | PASS             |
| Total                              |   173 | PASS, zero skips |

The deterministic fake gateway test covers all ten injected outcome classes and the live-disabled preflight. The direct PostgreSQL Phase 40 test covers immutable run identity, legal state transitions, terminal-state reopening rejection, append-only deletion rejection, and nonnegative usage enforcement.

## Final gate evidence

All listed commands exited 0. The final tree had zero skips.

| Command                                 | Exit | Count/evidence                                                                           |
| --------------------------------------- | ---: | ---------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`        |    0 | Frozen install complete                                                                  |
| Prisma generate                         |    0 | Client generated                                                                         |
| Prisma validate with explicit schema    |    0 | Valid                                                                                    |
| Prisma format with explicit schema      |    0 | Formatted                                                                                |
| `pnpm verify:phase40`                   |    0 | Frozen hashes, 8 migrations, required models, query boundary, and 173-case manifest PASS |
| `pnpm format-check`                     |    0 | All files formatted                                                                      |
| `pnpm lint`                             |    0 | Zero warnings/errors                                                                     |
| `pnpm typecheck`                        |    0 | 9/9 package targets                                                                      |
| `pnpm test`                             |    0 | 15 files, 238 tests, zero skips                                                          |
| `pnpm contracts:check`                  |    0 | 4 files, 12 tests, schema drift clean                                                    |
| `pnpm test:architecture`                |    0 | 1 file, 4 tests                                                                          |
| deterministic fake-generation tests     |    0 | Fake outcome and preflight evidence included in unit suite                               |
| `pnpm test-integration:local`           |    0 | 10 files, 61 PostgreSQL tests, zero skips                                                |
| `pnpm test-integration:phase40-upgrade` |    0 | Phase 30-to-40 migration history and 8/8 count PASS                                      |
| `pnpm live-evaluation:preflight`        |    0 | `LIVE_EVALUATION=DISABLED_BY_DEFAULT`                                                    |
| `pnpm build`                            |    0 | 9/9 build targets                                                                        |
| `git diff --check`                      |    0 | Clean                                                                                    |

Fresh `teaching_test` migration: 8/8 PASS. Independent fresh `teaching_clean` migration: 8/8 PASS. The PostgreSQL harness applied all eight migrations in order, including `20260824004000_phase40_generation_engine`. Isolated shadow migration-history drift returned exactly `No difference detected.` and `MIGRATION_DRIFT=PASS`.

## Changed files

`apps/worker/src/worker.ts`; `docs/architecture/project-state.md`; `docs/phases/40-phase-control-pack.md`; `docs/runbooks/phase-40-generation.md`; `package.json`; `packages/ai/src/ai.test.ts`; `packages/ai/src/index.ts`; `packages/ai/src/phase40-gateway.test.ts`; the nine generated Phase 40 contract snapshots under `packages/contracts/schemas/`; `packages/contracts/scripts/generate-schemas.mjs`; `packages/contracts/src/index.ts`; `packages/db/package.json`; `packages/db/prisma/migrations/20260824004000_phase40_generation_engine/migration.sql`; `packages/db/prisma/schema.prisma`; `packages/db/src/generation.ts`; `packages/db/src/index.ts`; `packages/db/src/phase40-matrices.test.ts`; `packages/db/src/phase40.database.integration.test.ts`; `packages/domain/src/index.ts`; `packages/domain/src/phase40-generation.test.ts`; `pnpm-lock.yaml`; `scripts/live-evaluation-preflight.mjs`; `scripts/phase40-upgrade-test.mjs`; `scripts/verify-phase40-control.mjs`; and the PostgreSQL harness fallback in `scripts/with-test-postgres.mjs`.

Migrations 00100, 00200, 02000, 03000, 03100, 03200, and 03300 were not edited. No Phase 20 external assessment-revision contract or Phase 30 protected source/retrieval contract was intentionally changed.

## Risks, deviations, and debt

- No real provider was selected or evaluated. `LIVE PROVIDER EVALUATION NOT RUN — OWNER APPROVAL AND PROVIDER DECISION REQUIRED`.
- The fake gateway demonstrates deterministic schema, retry, budget, citation, and isolation behavior; it does not establish pedagogical quality, provider quality, latency, or production cost.
- The implementation is provider-neutral and requires a separately reviewed live adapter before production provider use.
- The report is a claim set for independent review and does not self-approve Phase 40.
- No push, merge, deployment, paid service, or Phase 50 work was performed.

Final worktree was clean after the report-only commit. Phase 50 was not started.
