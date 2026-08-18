# Phase 20 implementation report — Curriculum and Assessment remediation

Status: **implementation complete; not Phase-approved**. Permanent architecture review remains the approval authority.

Branch: `codex/phase-20-remediation`  
Baseline: `4502bbd70ed74b80c7a9c8024ca43ac82cc9a5f8`  
Implementation baseline: `234c17ea38fdef30747f96e927768f058d36762d`  
Corrective commit: `0f79cd3f90b743b30b460e473261f5ef9cbc8433`

## Executive summary

Phase 20 delivers platform-wide versioned Curriculum and tenant-owned immutable Assessment revisions. The final corrective remediation adds database-only `BUILDING → FINALIZED` entry/transition enforcement, release-identity immutability, exact `NONE` rubric checks, all-null rubric support, terminal Skill hierarchy validation, and validated external read mappings. No Phase 30+ capability was added.

## Responsibility and enforcement

| Area                | Location                      | Evidence                                                                    |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Contracts/artifacts | `packages/contracts`          | strict Zod, seven generated v1 JSON schemas, drift/runtime tests            |
| Pure rules          | `packages/domain`             | typed hierarchy, lifecycle, exact integer score validation                  |
| Services            | `packages/db/src/index.ts`    | atomic import/publish/read, scoped Assessment/revision operations           |
| Persistence         | Phase 20 Prisma migration     | FKs, checks, partial indexes, triggers, deferred finalization               |
| PostgreSQL tests    | `phase20.integration.test.ts` | lifecycle, direct mutation, idempotency, concurrency, tenant/audit evidence |

Curriculum lifecycle is `DRAFT → PUBLISHED → DEPRECATED`; content becomes immutable after publication. Revisions are `BUILDING → FINALIZED` in one transaction. Finalized revision links, sections, questions, subquestions, answers, and rubrics reject direct insert/update/delete.

## Invariant matrix

| Invariant                           | Contract/domain/service          | Database                                                     |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| Typed hierarchy/siblings/difficulty | Zod + hierarchy validator/import | parent/type/same-version guards, unique indexes              |
| Lifecycle/content immutability      | transition services              | draft-only and lifecycle/node/difficulty triggers            |
| Ownership/isolation                 | trusted context + scoped queries | non-null organization FK                                     |
| Finalized graph/idempotency         | transaction + SHA-256 + row lock | deferred BUILDING guard, state and uniqueness constraints    |
| References/identities               | published/version checks         | published/same-version, XOR/range, partial key/order indexes |
| Exact scoring                       | integer score tree               | finalization totals and rubric triggers                      |

Contracts use UUID strings and integer score units, do not accept organization authority from request bodies, bound strings/collections, and retain answer/rubric keys and ordering. `SCORE_UNIT_SCALE = 100`; `MAX_SCORE_UNITS = 1_000_000`.

## Authorization, tenant isolation, and audit

Explicit operations are `CREATE_ASSESSMENT`, `READ_ASSESSMENT`, and `CREATE_ASSESSMENT_REVISION`. Active teacher, coordinator, and school-admin contexts access only their trusted active organization; platform admin has no implicit tenant-content access. Inaccessible reads return `null`; writes use non-disclosing unavailable errors. Integration tests prove cross-tenant read/write denial in both directions.

Audit events cover Curriculum publication/deprecation, Assessment creation, and revision finalization. Metadata contains only identifiers/lifecycle/schema/revision information; integration evidence asserts title and answer content are excluded. No Outbox event is emitted because Phase 20 has no consumer.

## Acceptance criteria

|   # | Status | Executable PASS evidence                                       |
| --: | ------ | -------------------------------------------------------------- |
|   1 | PASS   | Zod/runtime tests, seven schemas, Prisma/migration models      |
|   2 | PASS   | harness migrates `teaching_test` and isolated `teaching_clean` |
|   3 | PASS   | domain and PostgreSQL hierarchy/lifecycle tests                |
|   4 | PASS   | atomic import plus invalid contract/domain cases               |
|   5 | PASS   | publication/lifecycle and direct immutable-write tests         |
|   6 | PASS   | deterministic ordered published read and typed model           |
|   7 | PASS   | two-tenant read/write integration evidence                     |
|   8 | PASS   | lossless nested graph persistence/reload                       |
|   9 | PASS   | atomic finalization, retry/conflict, concurrency, immutability |
|  10 | PASS   | published exact-version service/trigger protections            |
|  11 | PASS   | Test default, valid points, Test/NONE rejection                |
|  12 | PASS   | nested/rubric integer checks and finalization guard            |
|  13 | PASS   | XOR, key/order indexes, answer/rubric tests                    |
|  14 | PASS   | direct Curriculum and finalized graph mutation rejections      |
|  15 | PASS   | explicit operations and non-disclosing isolation               |
|  16 | PASS   | audit-redaction integration assertion                          |
|  17 | PASS   | generated artifacts, drift and runtime contract tests          |
|  18 | PASS   | consolidated Phase 10 opening/current remediation evidence     |
|  19 | PASS   | final verification sequence below, zero skipped tests          |
|  20 | PASS   | scope inspection confirms no out-of-scope capability           |

## Final verification record

Bundled Node `24.19.0`, pnpm `11.19.0`, and `CI=true` were used.

| Command                          | Exit | Result                                                        |
| -------------------------------- | ---: | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` |    0 | lockfile installation                                         |
| Prisma format/validate/generate  |    0 | valid formatted schema/client                                 |
| `pnpm format-check`              |    0 | final docs included                                           |
| `pnpm lint`                      |    0 | zero warnings                                                 |
| `pnpm typecheck`                 |    0 | 9 packages                                                    |
| `pnpm test`                      |    0 | 10 files, 29 tests, zero skips                                |
| `pnpm contracts:check`           |    0 | drift/runtime contracts                                       |
| `pnpm test:architecture`         |    0 | architecture suite                                            |
| `pnpm test-integration:local`    |    0 | PostgreSQL 17.10; 4 files, 27 tests, zero skips; both targets |
| `pnpm build`                     |    0 | 9-package build                                               |
| `git diff --check`               |    0 | no whitespace errors                                          |

## TD-008 and limits

TD-008 exit evidence is the consolidated Phase 10 opening: old environment-limited material is explicitly historical and current local PostgreSQL remediation evidence is unambiguous. The permanent verdict/register status was not changed. Hosted CI was intentionally not pushed/run; the local equivalent includes isolated PostgreSQL clean-migration verification. This report does not approve Phase 20.
