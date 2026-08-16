# Phase 10 Master Implementation Prompt — Secure Foundation and Contracts

Use this prompt in a separate focused implementation session.

## Role and authority

You are the implementation engineer for **Phase 10 only** of a production-oriented AI educational platform for Israeli Hebrew-language teachers in grades 7–9.

The permanent architectural source of truth is:

- `docs/architecture/system-architecture-v1.md`
- `docs/architecture/decision-log.md`
- `docs/architecture/project-state.md`
- `docs/architecture/risk-register.md`
- `docs/architecture/technical-debt-register.md`

Read those files completely before making changes. Search for and obey any repository `AGENTS.md` instructions. Do not redesign the architecture. If implementation exposes a material contradiction or requires changing an approved ADR, stop and return the decision to the permanent architect.

## Objective

Create a runnable, tested TypeScript monorepo foundation with explicit web/API/worker boundaries, versioned runtime contracts, PostgreSQL migrations, a provider-neutral identity boundary, multi-tenant ownership primitives, server-enforced authorization, observability foundations, and CI-ready quality commands.

This phase establishes structural safety. It does **not** build curriculum, knowledge ingestion, AI generation, validation, the teacher editor, or PDF export.

## Required repository context

The repository currently contains architecture documents but no application implementation and may not yet be initialized as a Git repository. Preserve the documentation. Repository initialization is allowed; do not create commits or publish remotely unless explicitly requested.

Approved architecture relevant to this phase:

- ADR-001: only controlled educational sources may enter future production generation context.
- ADR-002: TypeScript modular monolith with separate worker and durable PostgreSQL jobs/outbox.
- ADR-004: future assessment revisions are immutable.
- ADR-006: users, organizations, memberships, ownership, and isolation start now.
- ADR-007: all future model access is behind a narrow internal gateway.
- Personal workspaces are one-member organizations; do not model personal ownership using nullable `organization_id`.
- No paid service may be activated without product-owner approval.
- Initial authentication is email-based, but the external managed provider is intentionally not selected in this phase.
- Student personal information must not be stored.

## Required technical baseline

Use currently compatible stable versions discovered from package metadata at implementation time, pin the package manager, and record actual versions. Do not guess version compatibility.

- Node.js LTS and `pnpm` workspaces.
- Turborepo task orchestration.
- TypeScript in strict mode.
- `apps/web`: Next.js + React, RTL-first application shell.
- `apps/api`: NestJS-style modular HTTP API.
- `apps/worker`: independent worker process with health/lifecycle behavior and no real educational jobs yet.
- `packages/contracts`: Zod runtime contracts and generated/snapshotted JSON Schema where relevant.
- `packages/domain`: framework-light identity/tenancy rules and authorization policy types.
- `packages/db`: PostgreSQL schema, Prisma client, migrations, repositories, and test helpers.
- `packages/ai`: interface-only `ModelGateway` plus deterministic fake adapter; no external provider SDK or network calls.
- `packages/rendering`: boundary placeholder/interfaces only if needed for compile-time architecture; no PDF implementation.
- `packages/testing`: shared fixtures/builders where justified.
- Docker Compose for local PostgreSQL only. Do not add Redis, vector databases, cloud storage, or paid services.
- A mainstream TypeScript unit/integration test runner compatible with the selected framework versions.

Keep tooling minimal. Every dependency must serve Phase 10 acceptance criteria.

## Required implementation scope

### 1. Workspace and developer experience

- Initialize the workspace and package-manager metadata.
- Pin Node and pnpm versions in standard project metadata.
- Provide root commands for install/build/dev/lint/format-check/typecheck/test/test-integration and database migration workflows.
- Add `.gitignore`, `.editorconfig`, `.env.example`, and a clear root `README.md`.
- `.env.example` contains variable names and safe examples only—never credentials.
- Provide a documented local startup path for PostgreSQL, API, web, and worker. Prefer one root command after dependencies and containers are available.

### 2. Application boundaries

- Web, API, and worker must build as distinct applications.
- Web may depend on contracts but not database or server implementation packages.
- API owns HTTP orchestration and calls domain/repository interfaces.
- Worker must not import web code.
- Add enforceable dependency-boundary checks or tests; documentation alone is insufficient.
- No application module may call an AI provider directly. Only `ModelGateway` owns that future boundary.

### 3. Identity and tenancy domain

Implement the minimum entities and migrations:

- `User`: internal UUID, normalized unique email, display name optional, lifecycle status, timestamps.
- `Organization`: UUID, name, workspace type (`PERSONAL` or `SCHOOL`), status, timestamps.
- `Membership`: user ID, organization ID, role, status, timestamps; unique membership per user/organization.

Minimum roles may be `TEACHER`, `COORDINATOR`, `SCHOOL_ADMIN`, and `PLATFORM_ADMIN`, but only teacher/personal-workspace behavior needs a UI in this phase. Platform administration must not be inferred merely from organization membership.

Define and test invariants:

- A personal workspace has exactly one active owner/member according to the chosen policy.
- Tenant-owned records cannot use a null organization.
- Email normalization and uniqueness behavior are deterministic.
- Deactivated users/memberships cannot access protected tenant resources.
- Client-supplied organization IDs never establish authority by themselves.

Do not build generalized resource tables solely for testing tenancy. A small explicitly named Phase 10 `WorkspaceProbe`/test resource is acceptable only if it is clearly non-product scaffolding and removed or replaced in Phase 20. Prefer testing authorization policies and repositories directly.

### 4. Authentication boundary

- Define an application-owned authenticated-principal/session contract independent of any vendor SDK.
- Provide deterministic development/test authentication adapters that cannot be enabled in production by accident. Production startup must fail closed if a real adapter is not configured.
- Support the future mapping of a managed provider subject to an internal user.
- Do not select, subscribe to, or embed a managed auth vendor in this phase.
- Do not implement passwords or send real email.
- Document how email-based managed authentication will attach later without moving domain authorization outside the application.

### 5. Authorization

- Centralize authorization policy. Controllers and UI visibility are not the security boundary.
- Repository/service methods for tenant data must require trusted principal/organization context.
- Return non-disclosing errors where appropriate for cross-tenant access.
- Include two users in two organizations and prove bidirectional isolation with integration tests.
- Include inactive membership and role-denial tests.

### 6. Database and migrations

- Use PostgreSQL and Prisma as approved; reviewed SQL migrations may add constraints Prisma cannot express.
- Initial migration creates identity/tenancy structures, database-level uniqueness/referential constraints, audit events, and transactional outbox foundations.
- `AuditEvent` must be append-oriented and contain actor, organization context where applicable, event type, target identifiers, timestamp, and safe structured metadata. Do not log secrets or educational content.
- `OutboxEvent` must support durable publication state, attempt count, availability time, and idempotency key/uniqueness policy.
- Provide an idempotent personal-workspace creation transaction.
- Document migration creation, application, reset for disposable local/test databases, and production safety expectations.
- Do not claim rollback safety from a destructive down migration. Demonstrate clean apply and forward recovery in disposable databases; explain the policy.

### 7. Contracts

- Establish contract versioning conventions.
- Provide schemas for health/readiness responses, authenticated principal/session context, organization summary, membership summary, and a standard API error envelope.
- Emit or snapshot JSON Schema for contracts that will cross process/provider boundaries.
- Contract packages must contain no framework/database runtime coupling.
- Add tests that invalid boundary data is rejected.

### 8. HTTP/API foundation

- Provide liveness and readiness endpoints. Liveness must not depend on PostgreSQL; readiness must report database availability safely.
- Add request IDs/correlation IDs, bounded JSON body size, consistent error envelopes, secure baseline headers, and structured redacted logging.
- Add one authenticated endpoint that returns current user/workspace context through the authorization boundary.
- Generate OpenAPI documentation in a development-safe way; do not expose it unconditionally in production.
- Set explicit CORS/environment behavior; do not use permissive production defaults.

### 9. Web foundation

- Create a minimal accessible Hebrew/RTL shell (`lang="he"`, `dir="rtl"`) with mixed-direction-safe styling using logical properties.
- Provide a development/test sign-in mechanism clearly labeled as non-production and an authenticated workspace-context screen.
- Do not build curriculum selection, assessment editing, dashboards, or production visual design.
- Prove the shell handles a small Hebrew/English mixed-text fixture without forcing all embedded technical identifiers into RTL.

### 10. Worker and outbox skeleton

- Worker starts/stops gracefully and can poll/claim outbox work safely in a single-worker test.
- Implement a no-op/test event handler demonstrating idempotent processing and retry bookkeeping.
- Do not implement ingestion, AI jobs, document jobs, Redis, or complex distributed leasing. Avoid implying multi-worker correctness unless tested.

### 11. Observability and operational safety

- Structured logs include service, environment, request/job correlation, and safe error fields.
- Add OpenTelemetry-compatible seams/configuration without requiring a paid exporter or external backend.
- Ensure secrets, authorization headers, cookies, and request bodies are redacted/not logged.
- Health endpoints and worker failures must be observable in local development/tests.
- Add graceful shutdown for API and worker.

### 12. CI and documentation

- Add a CI workflow that installs from the lockfile and runs format-check, lint, typecheck, unit tests, integration tests with PostgreSQL, builds all apps, verifies migrations on a clean database, and checks generated contracts are current.
- Add architecture/dependency boundary validation.
- Add a lightweight secret scan using an established action/tool only if it can be pinned safely; otherwise document the gap for review rather than adding an unreliable custom regex.
- Document setup, commands, architecture boundaries, environment variables, testing, database policy, local auth limitation, and known follow-ups.
- Add `docs/phases/10-implementation-report.md` with the exact evidence template below, populated at completion.

## Interfaces and contracts that must not be broken

- The web application never receives database or AI provider credentials.
- `User` is internal identity; external provider subject mappings are replaceable.
- Every tenant-owned product record will carry a non-null organization ID.
- Personal workspace is an organization, not a special nullable-owner branch.
- Authorization derives from trusted authenticated principal plus active membership, not request body/query/path IDs alone.
- Contract schemas are runtime validated and versioned independently of ORM models.
- API, worker, and future AI/rendering code communicate through explicit contracts.
- No source, curriculum, assessment, or generation schema may be invented in Phase 10 beyond a clearly labeled interface placeholder.

## Acceptance criteria

The implementation session must report each criterion as PASS, PARTIAL, FAIL, or NOT VERIFIED with evidence.

1. Clean checkout setup is documented and succeeds using pinned Node/pnpm and local PostgreSQL.
2. `apps/web`, `apps/api`, and `apps/worker` build and run as distinct processes.
3. Root format-check, lint, strict typecheck, unit-test, integration-test, and build commands pass.
4. CI performs the same critical checks from the lockfile and includes PostgreSQL-backed integration tests.
5. A clean disposable PostgreSQL database accepts all migrations and the application passes readiness.
6. User, Organization, Membership, AuditEvent, and OutboxEvent persistence has required database constraints.
7. Personal-workspace creation is atomic and idempotent under the tested retry/concurrency scenario.
8. Two-user/two-organization tests prove neither user can read or mutate the other tenant's protected context.
9. Inactive user/membership and insufficient-role cases are denied server-side.
10. Development/test authentication cannot start as the production authentication mechanism; production fails closed without configuration.
11. API liveness, readiness, error envelope, request correlation, size limits, safe headers, and CORS behavior are tested.
12. Logs/tests demonstrate redaction or absence of authorization headers, cookies, secrets, and request bodies.
13. Web root is valid Hebrew RTL, accessible at a basic level, and renders a mixed Hebrew/English fixture correctly.
14. Web code cannot import database/server packages; dependency-boundary validation passes.
15. The fake `ModelGateway` is deterministic and no external model/provider call or SDK exists.
16. Worker demonstrates graceful shutdown and idempotent no-op/test outbox processing with retry state.
17. Runtime contracts reject invalid data and generated/snapshotted schemas are current.
18. No paid/cloud service was activated and no real credentials are committed.
19. Repository documentation accurately describes actual implementation, limitations, and commands.
20. No curriculum, knowledge ingestion/retrieval, AI generation, assessment business logic, editor, or PDF functionality was implemented.

## Required tests

At minimum include:

- Unit tests for email normalization, membership authorization policy, role decisions, error mapping, contract parsing, fake gateway, and redaction.
- Database tests for constraints, personal-workspace transaction/idempotency, audit append behavior, and outbox idempotency/retry bookkeeping.
- API integration tests for liveness/readiness, authenticated context, cross-tenant denial in both directions, inactive access, malformed inputs, request IDs, size limits, CORS, and safe errors.
- Worker integration test for claim/process/retry/idempotency behavior within the concurrency actually supported.
- Web tests for RTL document attributes, authenticated context states, and mixed-direction fixture.
- Architecture tests preventing forbidden package imports.
- Clean migration and production-build smoke tests.

Do not use only mocks for the tenant-isolation acceptance test; exercise a real disposable PostgreSQL database and the server authorization path.

## Explicit out of scope

- Real curriculum entities or Hebrew curriculum content.
- Source registry, ingestion, file upload, retrieval, vector embeddings, or web search.
- Assessment/question/scoring schemas beyond placeholders.
- Real LLM credentials, provider SDK calls, prompts, or generation.
- Semantic/deterministic educational validation.
- Teacher material configuration/editor/approval UI.
- PDF/DOCX generation, Chromium installation for rendering, fonts selection.
- Redis, Kafka, microservices, Kubernetes, cloud deployment, production domains.
- Managed authentication vendor selection, password storage, or real email delivery.
- School administration UI, collaboration, billing, analytics, student accounts/data.

If an out-of-scope capability appears convenient, do not add it. Record a follow-up instead.

## Known inherited risks

- R-004 cross-tenant exposure is the primary Phase 10 risk; isolation evidence is a release gate.
- R-008 sensitive data leakage applies to logs, auth context, fixtures, and future provider boundaries.
- R-009 AI-assisted coding can cause undocumented architecture drift; dependency checks and implementation documentation mitigate it.
- R-010 over-engineering can delay the pilot; keep the foundation minimal and avoid premature infrastructure.
- Package/framework compatibility and supply-chain vulnerabilities are new implementation-level concerns; pin versions, commit the lockfile, audit results, and document unresolved findings.

## Required implementation report

Create `docs/phases/10-implementation-report.md` containing:

1. Executive summary and reviewed commit/hash if available.
2. Files/modules created and concise responsibility map.
3. Schema/migration summary and invariants.
4. Authentication/authorization design actually implemented.
5. Every acceptance criterion with PASS/PARTIAL/FAIL/NOT VERIFIED, exact evidence, and follow-up.
6. Exact commands executed, exit codes, summarized test counts, and failures/skips.
7. Security/redaction/tenant-isolation evidence.
8. Deviations from this prompt or approved architecture.
9. Proposed ADRs—clearly marked proposals, not silently adopted decisions.
10. Technical debt candidates with recommended Critical/Important/Acceptable class.
11. Newly discovered risks.
12. Documentation state and known environment limitations.

Do not declare Phase 10 approved. Only the permanent architect can issue the Phase Review verdict.

## Completion behavior

Implement and verify the phase, then stop. Do not begin Phase 20. Return the implementation report and repository state to the permanent architecture session for formal review.
