# Phase 10 Implementation Report — Secure Foundation and Contracts

Status: implementation complete with environment-limited PostgreSQL evidence; this report does **not** approve Phase 10. Permanent architecture review is required.

## 1. Executive summary

A TypeScript/pnpm/Turborepo foundation now separates Next.js web, NestJS API, and an independent PostgreSQL outbox worker. It adds provider-neutral identity, server-side tenant authorization, Prisma schema/reviewed migration, versioned Zod contracts, safe HTTP defaults, deterministic fake AI boundary, RTL shell, CI, and operational runbooks. Reviewed commit/hash: not available (repository was not initialized or committed by this session).

## 2. Responsibility map

- `apps/web`: minimal accessible Hebrew RTL shell; contracts-only client boundary.
- `apps/api`: HTTP orchestration, fail-closed authentication boundary, membership-backed authorization, health/OpenAPI/security middleware.
- `apps/worker`: graceful single-worker polling and no-op outbox handling.
- `packages/contracts`: versioned Zod runtime contracts and JSON Schema snapshots.
- `packages/domain`: normalization and centralized tenancy/role policy.
- `packages/db`: Prisma schema/client, reviewed SQL migration, identity/workspace transaction, audit/outbox repositories.
- `packages/ai`: narrow model interface and deterministic fake only.
- `packages/rendering`: Phase 70 compile-time placeholder only.
- `tests`: enforceable import-boundary checks.

## 3. Schema and invariants

The migration creates User, IdentityMapping, Organization, Membership, AuditEvent, and OutboxEvent structures. UUID keys, normalized-email uniqueness, unique membership, foreign keys, lifecycle enums, audit append trigger, outbox unique idempotency key, attempt check, publication state, and availability indexes are database enforced. Personal creation uses a serializable transaction and normalized-email retry identity. A trigger prevents more than one active member in a personal organization; atomic creation plus domain cardinality policy requires exactly one.

## 4. Authentication and authorization

The authenticated principal is application-owned and versioned. Development/test headers can never run under `NODE_ENV=production`; production requires a future managed adapter and currently fails closed. A client organization identifier requests context only. API authorization loads active internal user/membership/organization state and applies centralized non-disclosing policy.

## 5. Acceptance evidence

|   # | Status       | Evidence / follow-up                                                                                                                                         |
| --: | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | PARTIAL      | Frozen install succeeded with pinned Node/pnpm and setup is documented; Docker was unavailable, so clean PostgreSQL setup was not verified.                  |
|   2 | PASS         | `pnpm build` built nine targets including distinct Next.js web, NestJS API, and worker targets.                                                              |
|   3 | PASS         | Format-check, lint, strict typecheck, unit tests, integration command, and build exited 0; database suites were skipped.                                     |
|   4 | PARTIAL      | CI installs frozen lockfile and includes PostgreSQL migrations/integration, quality, contracts, boundaries, and builds; workflow was not executed on GitHub. |
|   5 | NOT VERIFIED | Reviewed migration/readiness exist, but no PostgreSQL or Docker binary was available locally.                                                                |
|   6 | PARTIAL      | Prisma schema and reviewed SQL contain required structures/constraints; clean database application was not executed.                                         |
|   7 | NOT VERIFIED | Serializable retrying transaction and concurrent idempotency test exist; PostgreSQL execution was skipped.                                                   |
|   8 | NOT VERIFIED | Bidirectional API read/mutation isolation test with two real users/organizations exists; PostgreSQL execution was skipped.                                   |
|   9 | PARTIAL      | Unit policy covers inactive user/membership and role denial and passes; database-backed API cases were skipped.                                              |
|  10 | PASS         | `AuthService` production guard fails closed; no vendor selected.                                                                                             |
|  11 | PARTIAL      | API tests passed liveness, correlation, size limit, headers, CORS, and safe envelope; database readiness was not exercised.                                  |
|  12 | PASS         | Recursive redaction/absence test passed; request logger records no headers, cookies, credentials, or bodies.                                                 |
|  13 | PASS         | Web tests and production build passed Hebrew `lang`, RTL, skip link, LTR code, and `bdi` mixed-text fixtures.                                                |
|  14 | PASS         | Four architecture dependency tests passed.                                                                                                                   |
|  15 | PASS         | Deterministic fake is the only adapter; no provider SDK dependency.                                                                                          |
|  16 | NOT VERIFIED | Graceful worker and PostgreSQL no-op/retry integration test exist; database suite was skipped.                                                               |
|  17 | PASS         | Runtime rejection and JSON Schema version/snapshot tests passed.                                                                                             |
|  18 | PASS         | Only local PostgreSQL configured; examples contain no real credentials.                                                                                      |
|  19 | PASS         | README and auth/database runbooks describe actual scope and limitations.                                                                                     |
|  20 | PASS         | No Phase 20+ educational/product functionality was added.                                                                                                    |

## 6. Commands and results

- `pnpm install --frozen-lockfile` — exit 0 after adding bundled Node 24 to `PATH`; 10 workspace projects and lockfile policy verified.
- `pnpm db:generate` — exit 0; Prisma Client `6.19.3` generated.
- `pnpm format-check` — exit 0; all matched files formatted.
- `pnpm lint` — exit 0; zero warnings under `--max-warnings=0`.
- `pnpm typecheck` — exit 0; 9/9 Turborepo tasks successful under strict TypeScript.
- `pnpm test` — exit 0; 8 files, 19 tests passed.
- `pnpm test-integration` — exit 0; API foundation 4 passed, PostgreSQL-dependent 6 skipped across DB/API/worker suites because `DATABASE_URL`/PostgreSQL was unavailable.
- `pnpm test:architecture` — exit 0; 4 boundary tests passed.
- `pnpm contracts:check` — exit 0; contract parsing check passed (schema snapshot checks also passed in the complete unit run).
- `pnpm build` — exit 0; 9/9 targets built, including a successful Next.js 16.3.1 production build and Prisma generation.
- `docker version` / `docker compose version` — exit 1; Docker command not installed in this execution environment.

## 7. Security evidence

Tenant policy returns the same non-disclosing error for missing/cross-tenant/inactive access. Secrets/body/header redaction is recursive and passed its unit test. Request IDs, Helmet headers, bounded JSON, explicit CORS, development-only Swagger, safe readiness errors, and graceful shutdown are implemented. Database-backed bidirectional read/mutation isolation remains a release-gate verification item until its integration fixture executes.

## 8. Deviations

- Prisma `6.19.3` was selected instead of latest major `7.9.1` to retain the stable schema configuration compatible with this minimal Node 24 foundation; both versions were discovered from registry metadata.
- TypeScript `7.0.2` was initially discovered but failed with the stable ESLint parser; registry-discovered stable TypeScript `6.0.3` with typescript-eslint `8.67.0` is the verified pinned toolchain.
- No S3 emulator was added because Phase 10 explicitly limits local infrastructure to PostgreSQL.

## 9. Proposed ADRs

None. No approved ADR was changed.

## 10. Technical debt candidates

- Important: add real managed OIDC adapter after vendor/privacy/procurement decision (target before production).
- Important: add immutable-SHA-pinned established secret scanner after security review; CI currently documents the gap.
- Acceptable: multi-worker lease correctness is intentionally unclaimed and deferred until measured need.

## 11. Newly discovered risks

- Supply-chain compatibility risk from newly released Node/TypeScript/framework majors; lockfile and CI reduce but do not eliminate it.
- PostgreSQL trigger/application invariant drift should be retested with every tenancy migration.

## 12. Documentation and environment limits

README, auth runbook, database runbook, CI, environment template, and this report are present. No paid/cloud service, real authentication provider, external telemetry exporter, or production deployment was configured.

## Phase 10 Remediation Evidence

This remediation closes the implementation conditions for TD-001 through TD-006 without changing their register status; only the permanent architecture session may close debt or change the Phase Review verdict.

### Fix map

- TD-001: pinned PostgreSQL 17.10 ran locally; both migrations applied independently to `teaching_test` and `teaching_clean`; 20 integration tests passed with zero skips. Missing `DATABASE_URL` now fails at configuration load.
- TD-002: corrective migration `20260816000200_phase10_remediation` replaces the at-most-one trigger with deferred exact-cardinality triggers. Active Personal organizations require exactly one active `TEACHER`; zero/two/wrong-role fail, while atomic organization/member deactivation succeeds. Email-keyed advisory locking plus serializable retry prevents concurrent orphan workspaces.
- TD-003: centralized `READ_WORKSPACE_CONTEXT` and `RENAME_WORKSPACE` operations enforce the explicit Personal/School matrix. Cross-tenant read/rename is denied bidirectionally.
- TD-004: Zod generates and drift-checks six committed versioned JSON Schema artifacts.
- TD-005: CI migrates the integration schema and a separate `clean_migration` schema. The local equivalent migrates two separate databases and runs all gates without database skips. Hosted GitHub Actions remains NOT VERIFIED because no remote exists.
- TD-006: an injectable handler, bounded safe failure state, delayed retry, explicit leases, no-early-reclaim, stale recovery, and exactly-once publication state are PostgreSQL-tested within the supported single-worker scope.

### Authorization matrix

| Operation    | Personal organization          | School organization                                       |
| ------------ | ------------------------------ | --------------------------------------------------------- |
| Read context | Active `TEACHER` member        | Active `TEACHER`, `COORDINATOR`, or `SCHOOL_ADMIN` member |
| Rename       | Single active `TEACHER` member | Active `SCHOOL_ADMIN` member only                         |

Every operation additionally requires an active internal user, active membership, active matching organization, and trusted authenticated principal. `PLATFORM_ADMIN` is not inferred from membership.

### Outbox policy

Claims use `FOR UPDATE SKIP LOCKED`. A claim changes state to `PROCESSING`, increments attempts, and records `locked_at` plus `lease_expires_at` (five-second default). Failed handlers store only the bounded error class, clear the lease, and move availability forward by one second. Processing rows are not reclaimable before lease expiry and become reclaimable afterward. Published rows are terminal for polling.

### Contract artifacts

- `authenticated-principal.v1.json`
- `health-readiness.v1.json`
- `organization-summary.v1.json`
- `membership-summary.v1.json`
- `workspace-context.v1.json`
- `api-error.v1.json`

`pnpm contracts:generate` derives these from Zod. `pnpm contracts:check` rebuilds contracts, compares every byte for drift, and runs runtime rejection/snapshot tests.

### Verification evidence

- Runtime baseline: Node `24.19.0`; pnpm `11.19.0`; Git `2.53.0.windows.3`; PostgreSQL `17.10`; Docker unavailable.
- Baseline before remediation: format/lint/typecheck/build passed; 19 unit tests passed; integration reported 4 passed and 6 skipped; not a Git repository.
- `pnpm test-integration` without `DATABASE_URL`: exit 1 with an explicit required-configuration error before discovery.
- `pnpm test-integration:local`: exit 0; both migrations applied to two clean databases; 3 integration files and 20 tests passed, zero skipped.
- Readiness: real HTTP 200 response validated by `healthSchema` with PostgreSQL available; deliberately invalid port returned HTTP 503 validated by `apiErrorSchema` with `SERVICE_UNAVAILABLE`.
- Tenant isolation: two users/two Personal organizations were denied real HTTP reads and renames in both directions; own Personal rename and the full School role matrix passed.
- Local CI equivalent: frozen install passed; format/lint passed; strict typecheck 9/9; unit 24/24; architecture 4/4; contract suite 7/7 with six-schema drift check; build 9/9; integration 20/20 with zero skips; two clean databases migrated.
- Hosted CI: NOT VERIFIED; no GitHub remote was configured or used.

### Remediation acceptance criteria

|   # | Status | Evidence                                                                              |
| --: | ------ | ------------------------------------------------------------------------------------- |
|   1 | PASS   | Real PostgreSQL 17.10 version queried.                                                |
|   2 | PASS   | Two migrations applied independently to two clean databases.                          |
|   3 | PASS   | 20 integration tests, zero skips; absent URL exits 1.                                 |
|   4 | PASS   | Contract-validated HTTP 200 and safe 503 tests pass.                                  |
|   5 | PASS   | Concurrent normalized-email creation returns one workspace and no orphan.             |
|   6 | PASS   | Deferred DB triggers reject zero, two, and non-teacher active membership.             |
|   7 | PASS   | School multiple-member PostgreSQL test passes.                                        |
|   8 | PASS   | Read policy checks active user, membership, organization, and tenant.                 |
|   9 | PASS   | Own Personal rename passes; other access fails.                                       |
|  10 | PASS   | School teacher/coordinator denied; administrator allowed.                             |
|  11 | PASS   | Bidirectional real HTTP/PostgreSQL read and mutation denial passes.                   |
|  12 | PASS   | 401, distinct 400, inactive, role-denial, and safe error contracts pass.              |
|  13 | PASS   | Success, failure, delay, retry, lease, stale recovery, and terminal publication pass. |
|  14 | PASS   | Six generated schema groups have drift protection.                                    |
|  15 | PASS   | Complete local equivalent includes two clean DB migrations and zero-skip integration. |
|  16 | PASS   | Format, lint, strict typecheck, unit, architecture, contracts, and build pass.        |
|  17 | PASS   | README, runbooks, and this evidence match the verified behavior.                      |
|  18 | PASS   | Local repository/commit evidence is recorded below.                                   |

### Git and remaining limitations

The exact local `HEAD` hash and `git status --short` are returned alongside this report after the authorized commit. A content-addressed commit cannot embed its own final hash without changing that hash. Hosted Actions and the deferred TD-007 items remain NOT VERIFIED/deferred. The workspace-local PostgreSQL package uses a Windows cleanup fallback because the embedded runtime retains a closed child-process handle; the next run safely clears its fixed temporary directory. No real credentials, remote, paid service, or Phase 20 functionality was introduced.
