# Teaching System — Phase 10 foundation

Secure TypeScript monorepo foundation for a Hebrew/RTL educational platform. This repository currently implements identity, tenancy, authorization, contracts, observability seams, and application boundaries only. It intentionally contains no curriculum, ingestion, generation, assessment, editor, or PDF features.

## Prerequisites

- Node.js `24.x` (pinned by `engines`; implementation runtime was `24.19.0`)
- pnpm `11.19.0` (pinned by `packageManager`)
- Docker with Compose, for PostgreSQL 17 only

On Windows without Docker, `pnpm test-integration:local` uses the pinned workspace-local PostgreSQL 17 runtime for disposable verification.

## Local setup

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres
copy .env.example .env
pnpm db:migrate:deploy
pnpm dev
```

The web shell is at `http://localhost:3000`, API at `http://localhost:4000`, development-only OpenAPI at `http://localhost:4000/docs`, and API liveness/readiness at `/health/live` and `/health/ready`. `pnpm dev` starts web, API, and worker as distinct processes.

Development authentication is deliberately conspicuous and header-based (`x-dev-user-id`, `x-dev-user-email`, and `x-organization-id`). It is allowed only when both environment and adapter are development/test. Organization input selects a requested context but never grants authority: active database membership is mandatory. Production startup rejects the development adapter, and no managed provider has been selected.

`pnpm test-integration` intentionally fails when `DATABASE_URL` is absent; database suites are never silently skipped.

## Commands

| Command                           | Purpose                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| `pnpm build`                      | Build all packages and the three applications                         |
| `pnpm dev`                        | Run all three applications in watch/development mode                  |
| `pnpm format-check` / `pnpm lint` | Source quality gates                                                  |
| `pnpm typecheck`                  | Strict TypeScript across the workspace                                |
| `pnpm test`                       | Unit, contract, web-shell, and architecture tests                     |
| `pnpm test-integration`           | PostgreSQL/API/worker integration tests                               |
| `pnpm test-integration:local`     | Start PostgreSQL 17, migrate two clean DBs, and run integration tests |
| `pnpm db:generate`                | Generate Prisma Client                                                |
| `pnpm db:migrate`                 | Create/apply a migration in local development                         |
| `pnpm db:migrate:deploy`          | Apply reviewed migrations non-interactively                           |
| `pnpm db:reset`                   | Destructively reset a disposable local/test database only             |

## Boundaries and security policy

- Web imports runtime contracts only; it cannot import DB, domain implementation, AI, API, or worker packages.
- API authenticates a provider-neutral principal, resolves active membership from PostgreSQL, and applies centralized domain policy.
- Worker owns Phase 10 single-worker outbox polling and imports no web code.
- All future model access must implement `ModelGateway`; only a deterministic fake exists now and no provider SDK is installed.
- Structured logs must pass through redaction and never include request bodies, authorization, cookies, tokens, or secrets.
- Contracts use semantic versions independently of Prisma models; cross-process snapshots live in `packages/contracts/schemas`.

See [database runbook](docs/runbooks/database.md) and [Phase 10 implementation report](docs/phases/10-implementation-report.md).
