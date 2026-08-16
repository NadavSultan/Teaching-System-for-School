# PostgreSQL and migration runbook

Phase 10 uses local PostgreSQL only. `DATABASE_URL` is server-only and must never be exposed to the web bundle.

## Development

Start PostgreSQL with `docker compose up -d postgres`, apply reviewed migrations with `pnpm db:migrate:deploy`, and use `pnpm db:migrate -- --name descriptive_name` only when intentionally creating a migration. Inspect generated SQL before committing it.

Windows development without Docker can use `pnpm test-integration:local`. It starts pinned PostgreSQL 17.10 in the system temporary directory, applies all migrations to `teaching_test`, runs every DB/API/worker integration test, then applies the migrations independently to `teaching_clean`. `pnpm test-integration` requires an explicit `DATABASE_URL` and fails before discovery when it is absent.

`pnpm db:reset` destroys the selected database and is permitted only for a disposable local/test database after verifying the URL. It is not a production rollback mechanism.

## Production policy

Production changes are forward-only: back up, rehearse on a production-shaped copy, apply with `prisma migrate deploy`, observe readiness and errors, then recover using a reviewed forward migration or database restore procedure. This repository does not claim rollback safety and intentionally has no destructive down migration.

The personal-workspace transaction takes a transaction-scoped advisory lock keyed by normalized email and runs serializably. A deferred PostgreSQL constraint trigger enforces that every active Personal Organization has exactly one active `TEACHER` membership at commit. A second active member, zero active members, or changing the only member to another role fails. Deactivating the organization and membership in one transaction succeeds. School organizations are not subject to the one-member rule.

Outbox claims use `FOR UPDATE SKIP LOCKED` and a five-second default lease. Pending/failed events are claimable only after `available_at`; abandoned `PROCESSING` events are reclaimable only after `lease_expires_at`. Handler failure stores only a bounded safe error class, clears the lease, and schedules retry. Published events are never claimable again. This is verified single-worker crash recovery, not a claim of complete multi-worker semantics.
