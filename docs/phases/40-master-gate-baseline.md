# Phase 40 Protected Master Gate — Baseline Evidence

Date: 2026-08-25

Branch: `codex/phase-40-final-remediation`

Starting commit: `a81a9eab7c99a94f19d64591bf9af30735056bf3`

This is intentionally red acceptance evidence. It records the verified gaps the executor must close; it is not an implementation report or approval.

## Structural gate

Command: `node scripts/verify-phase40-master-gate.mjs`

Exit code: `0`

- `PHASE40_CONTROL=STRUCTURAL_PASS`
- `MATRIX_MANIFEST=173`
- `PROTECTED_CASES=12`
- `MIGRATION_COUNT=13`

## Protected source/unit gate

Command: `pnpm test -- tests/phase40-master-control.test.ts`

Exit code: `1` as expected on the baseline.

- 16 test files: 15 passed, 1 failed.
- 69 tests: 66 passed, 3 failed.
- Zero skips/todos/only.
- Expected failing protected cases: `MG-10`, `MG-11`, `MG-12`.
- Verified reasons: `04400` and `04500` are not deployed as distinct upgrade stages; required executed upgrade-probe markers are absent; known false-positive matrix source patterns remain.

## Protected PostgreSQL integration gate

Command: `pnpm test-integration:local`

Exit code: `1` as expected on the baseline.

- PostgreSQL `17.10` started.
- All 13 migrations applied successfully on the isolated database.
- 20 test files: 19 passed, 1 failed.
- 266 tests: 263 passed, 3 failed.
- Zero skips/todos/only.
- Passing protected cases: `MG-01`, `MG-02`, `MG-03`, `MG-04`, `MG-05`, `MG-08`.
- Expected failing protected cases: `MG-06`, `MG-07`, `MG-09`.
- `MG-06`: equal-timestamp `APPROVED`/`REJECTED` incorrectly selected eligible context instead of failing closed.
- `MG-07`: equal-timestamp `ALLOWED`/`DENIED` incorrectly selected eligible context instead of failing closed.
- `MG-09`: the forged question/run source link stopped at generic `question source identity invalid`, not the intended `question source assessment identity invalid` guard.

## Environment note

The original dependency path exceeded the legacy Windows path limit. The successful database run used:

`pnpm --config.virtual-store-dir=../v install --frozen-lockfile`

This is an environment workaround only; it did not change production code, migrations, or acceptance semantics.

## Required green transition

The executor must make all 12 protected cases pass without changing protected files or migrations through `04500`. Existing passing cases must remain passing. A green aggregate count without the exact protected semantics is insufficient.
