# Phase 10 Remediation Master Prompt

Use this prompt in the implementation session that performed Phase 10, or in a new focused implementation session. This is a Phase 10 remediation cycle only. It is not Phase 20.

## Role and authority

You are responsible for remediating Phase 10 after the architectural verdict:

**REQUIRES FIXES – Do not proceed yet**

Before changing anything, read these files completely and in order:

1. `docs/architecture/system-architecture-v1.md`
2. `docs/architecture/decision-log.md`
3. `docs/architecture/project-state.md`
4. `docs/architecture/technical-debt-register.md`
5. `docs/architecture/risk-register.md`
6. `docs/phases/10-master-implementation-prompt.md`
7. `docs/phases/10-implementation-report.md`
8. `docs/phases/10-phase-review.md`
9. `README.md` and the relevant runbooks

Also read every applicable `AGENTS.md`, starting at the repository root. Do not alter an approved ADR, start Phase 20, or redesign the system. If a fix requires a material architectural change, stop and return the decision to the permanent architecture session.

## Objective

Close every Phase 10 re-review condition through focused code, migration, contract, authorization, CI, test, and documentation changes. Run the implementation against real PostgreSQL and prove that all foundational behavior passes without skipped database tests.

The outcome must be a corrected Phase 10 implementation ready for architectural re-review. You may not approve the phase yourself.

## Mandatory boundaries

- Do not add curriculum, assessment, knowledge-source, ingestion, retrieval, prompt, LLM, editor, or PDF functionality.
- Do not select or connect a managed authentication provider.
- Do not add Redis, a vector database, Kafka, microservices, cloud deployment, or a paid service.
- Do not introduce real credentials.
- Do not delete, weaken, or bypass tests to produce a green result.
- Do not replace database integration evidence with mock-only tests.
- Do not classify a criterion as `PASS` if its test was skipped, not executed, or supported only by a narrative claim.
- Preserve the approved web/API/worker/package boundaries and ADR-001 through ADR-007.
- Do not configure a remote, push, or open a pull request. Local Git initialization and one local commit are authorized below.

## Required work

### 1. Establish the baseline

- Inspect the workspace and determine whether it is already a Git repository.
- Record the actual Node.js, pnpm, PostgreSQL, and Docker versions.
- Run the existing quality and test commands before changing code. Record exact pass, fail, and skip counts.
- Do not treat exit code zero from a suite containing skipped database tests as PostgreSQL evidence.
- Preserve unrelated user changes.

### 2. Run real PostgreSQL verification and close TD-001

PostgreSQL verification is mandatory. Use the existing Docker Compose configuration when Docker is available. Otherwise, check for a safe, already-installed local PostgreSQL option. If installation or additional authority is required, request approval. Do not skip PostgreSQL and do not declare completion without it.

Required work:

- Run PostgreSQL 17 or a demonstrably compatible version.
- Create a clean, isolated, disposable test database or schema.
- Apply every migration through the real deployment command.
- Exercise readiness with the database available; verify HTTP 200 and the runtime contract.
- Exercise readiness with the database unavailable or a deliberately invalid test URL; verify HTTP 503 and a safe error contract.
- Run every DB, API, and worker integration test without skips.
- Make `pnpm test-integration` fail clearly when its required `DATABASE_URL` is absent. It must not silently skip database suites.
- Isolate or clean test data so repeated runs are deterministic.

### 3. Correct the Personal Workspace invariant and close TD-002

The required policy is:

- An `ACTIVE PERSONAL Organization` must contain **exactly one active Membership**.
- That member owns access to the Personal Workspace and has the `TEACHER` role in Phase 10.
- A second active member cannot be added.
- An active Personal Organization cannot be left with zero active members.
- Deactivating its only active membership must either deactivate the Personal Organization in the same transaction or be rejected.
- Creation remains atomic and idempotent by normalized email.

Implement this consistently across domain, service/repository, and PostgreSQL layers. A reviewed deferred constraint trigger or equivalent robust database mechanism is acceptable. Protect concurrent transitions. An unused domain assertion is not enforcement.

Prefer a new corrective migration. Do not rewrite a migration that may have been applied. Rewrite or squash only if you prove and document that it was never applied anywhere and repository policy permits it.

Required PostgreSQL tests:

- Creation produces one organization and one membership atomically.
- Two concurrent requests with the same normalized email return the same workspace and leave no orphan organization.
- Adding a second active member fails.
- Leaving an active Personal Organization with zero active members fails.
- Deactivating the organization and membership together succeeds if that transition is implemented.
- A School Organization is not restricted to one member.

### 4. Add operation-specific authorization and close TD-003

Separate read and mutation authorization. Do not reuse one broad default role list.

Required policy:

- Read workspace context: an active `TEACHER`, `COORDINATOR`, or `SCHOOL_ADMIN` membership may read its own active organization only.
- Rename `PERSONAL`: only its single active member may rename it.
- Rename `SCHOOL`: only an active `SCHOOL_ADMIN` membership may rename it.
- `TEACHER` and `COORDINATOR` may not rename a School Workspace.
- `PLATFORM_ADMIN` authority is not derived from an organization membership row.
- Inactive users, memberships, and organizations are denied.
- Cross-tenant requests return the same non-disclosing response for reads and mutations in both directions.

Represent operations explicitly in the centralized policy, for example `READ_WORKSPACE_CONTEXT` and `RENAME_WORKSPACE`. Do not scatter role checks across controllers.

Required tests:

- Two users in two organizations are denied cross-tenant read and rename in both directions through real HTTP and PostgreSQL paths.
- A Personal Workspace teacher may rename their own workspace.
- A School teacher and coordinator may not rename the School Workspace.
- A School administrator may rename only their own School Workspace.
- Inactive user, membership, and organization cases are denied.
- A request with an organization header but no authentication returns HTTP 401.
- Missing organization context returns its separately defined error contract.

### 5. Complete external contracts and close TD-004

Keep Zod as the runtime contract source. Generate committed, versioned JSON Schema snapshots for at least:

- `authenticatedPrincipal`
- `health/readiness`
- `organizationSummary`
- `membershipSummary`
- `workspaceContext`
- `apiError`

Requirements:

- Store consistently named, versioned files under `packages/contracts/schemas`.
- Add drift tests covering every committed snapshot.
- `pnpm contracts:check` must execute runtime rejection and every schema drift test, not one partial test file.
- Validate relevant real API responses against these contracts in tests.
- Do not derive contracts from Prisma or introduce framework/database dependencies into the contracts package.

### 6. Add minimum durable Outbox behavior and close TD-006

Preserve the single-worker scope while adding minimum real durability:

- Separate an injectable event handler from polling so success and failure can be tested.
- A failing handler moves the event to `FAILED`, stores bounded safe `lastError`, increments attempts, and schedules a retry.
- An event left `PROCESSING` after a crash becomes reclaimable after a defined lease/timeout. Add `lockedAt`/`leaseExpiresAt` or an equally explicit mechanism.
- Do not reclaim before the lease expires.
- A successful retry marks the event `PUBLISHED` exactly once.
- Never log payloads or secrets.
- Do not claim complete multi-worker support beyond tested behavior. Retain the `FOR UPDATE SKIP LOCKED` safety boundary.

Required PostgreSQL tests: success, injected handler failure, delayed retry, stale `PROCESSING` recovery, no early reclaim, and idempotent publication state.

### 7. Correct CI and close TD-005

- Correct “Verify clean migrations on a new schema.” It must actually use a separate clean database/schema or be renamed accurately if it checks only idempotent reapplication.
- CI must run frozen install, format-check, lint, strict typecheck, unit tests, migrations on a clean database, integration without skips, architecture tests, contract drift tests, and builds.
- Add a guard that fails CI if PostgreSQL tests are skipped.
- Pin Actions reasonably. Do not add an unreviewed secret scanner merely to close a checkbox; the relevant part of TD-007 may remain deferred.
- If no GitHub remote exists, run a complete local CI-equivalent workflow against a clean database. Report hosted Actions as `NOT VERIFIED`; do not invent a run URL or badge.

### 8. Establish Git traceability

- If needed, initialize a local Git repository at the project root.
- Ensure `.gitignore` excludes secrets, `.env`, `node_modules`, `.next`, `dist`, coverage, and build caches.
- Do not track build outputs or credentials.
- After all remediation and verification pass, create one intentional local Phase 10 remediation commit.
- Do not configure a remote, push, or open a pull request.
- Record the exact commit hash and `git status --short` after the commit. If Git identity prevents committing, report the blocker and do not invent a hash.

### 9. Update documentation and evidence

Update:

- `README.md`
- `docs/runbooks/database.md`
- `docs/runbooks/authentication.md` when needed
- `docs/phases/10-implementation-report.md`

Do not change the verdict in `docs/phases/10-phase-review.md`. Do not close Technical Debt records or advance Project State. The permanent architecture session owns those changes.

Add `Phase 10 Remediation Evidence` to the implementation report with:

1. Fixes mapped to TD-001 through TD-006.
2. New migrations and enforced invariants.
3. The implemented role/action/organization matrix.
4. The Outbox lease/retry policy.
5. Every JSON Schema artifact.
6. Every command, exit code, test count, and skip count.
7. Clean migration and available/unavailable readiness evidence.
8. Bidirectional tenant-isolation evidence.
9. Local and hosted CI status, clearly separated.
10. Commit hash and working-tree status.
11. Deviations, failures, remaining debt, and new risks.

## Remediation acceptance criteria

Classify each criterion as `PASS`, `PARTIAL`, `FAIL`, or `NOT VERIFIED`. Criteria 1–18 must all be `PASS` before requesting architectural re-approval:

1. A real PostgreSQL instance ran and its version was recorded.
2. Every migration applied to a clean database/schema.
3. `pnpm test-integration` completed with zero skips and fails when required DB configuration is absent.
4. Readiness returns 200 with PostgreSQL available and contract-safe 503 when unavailable.
5. Personal Workspace creation is atomic and idempotent under concurrency with no orphan rows.
6. An active Personal Organization enforces exactly one active member; zero and two are rejected.
7. A School Workspace supports multiple members.
8. Read authorization requires active user, membership, organization, and matching tenant.
9. Personal rename is permitted only to its active member.
10. School rename is permitted only to `SCHOOL_ADMIN`; `TEACHER` and `COORDINATOR` are denied.
11. Bidirectional cross-tenant reads and mutations are denied through real HTTP and PostgreSQL.
12. Unauthenticated, missing-context, inactive, and insufficient-role paths return consistent contracts.
13. Outbox success, handler failure, retry, and stale-processing recovery pass against PostgreSQL.
14. All six external JSON Schema groups exist, are current, and have drift protection.
15. CI or a complete local equivalent runs every quality gate, migration, and test without skips.
16. Format, lint, strict typecheck, unit, architecture, contracts, and build all pass.
17. README, runbooks, and report match the implementation without unverified claims.
18. A local Git repository and reviewable commit exist with no secrets/build outputs tracked.

These are not blockers and must not expand scope:

- Managed OIDC adapter.
- Hosted secret scanner without an approved pinned tool.
- Multi-worker leasing beyond minimum crash recovery.
- Hosted GitHub Actions when no remote exists; report it separately, while the local CI equivalent must pass.

## Minimum verification commands

Adjust names only if intentionally changed and documented:

```text
pnpm install --frozen-lockfile
pnpm format-check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate:deploy
pnpm test-integration
pnpm test:architecture
pnpm contracts:check
pnpm build
```

Also run migrations against a separate clean database/schema, readiness in available and unavailable states, and `git status --short`.

## Blocked-work behavior

- If PostgreSQL cannot start, do not declare completion. Request the missing authority or resource.
- If a test fails, fix the cause; do not skip it or weaken assertions.
- If an existing migration was applied anywhere, do not rewrite it; add a corrective migration.
- If a material architectural change is required, stop and return options and trade-offs to the architecture session.
- If hosted CI is unavailable, run the complete local equivalent and report the limitation accurately.

## Completion and return for review

When remediation is complete:

1. Update the implementation report with exact evidence.
2. Create the authorized local commit when possible.
3. Stop. Do not begin Phase 20.
4. Return to the permanent architecture session:
   - `docs/phases/10-implementation-report.md`
   - the exact commit hash
   - a concise test, migration, and CI evidence summary
   - every remaining deviation or open item

Only the permanent architecture session may update the Phase Review verdict, close Technical Debt, advance Project State, or authorize Phase 20.
