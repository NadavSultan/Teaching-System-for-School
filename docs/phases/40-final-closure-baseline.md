# Phase 40 Final Closure — Protected Red Baseline

Date: 2026-08-25

Branch: `codex/phase-40-final-remediation`

Product baseline: `ee59dd3cd017a64e55f00b21afb6f7016338a368`

This is intentional red master-owned evidence. It is not an implementation report or approval.

## Protected source/unit gate

Command: `pnpm test -- tests/phase40-master-control.test.ts`

Exit code: `1` as required on the baseline.

- Test files: 15 passed, 1 failed, 16 total.
- Tests: 69 passed, 2 failed, 71 total.
- Exact expected failures: `MG-15`, `MG-16`.
- `MG-15`: binding matrix sources still contain bare `rejects.toThrow()`, aggregated cases, and non-exact assertions.
- `MG-16`: expected citations are copied from `question_source_links`; upgrade target exclusion uses `q.key <> 'q1'`; the report falsely says migration `04600` was unchanged.
- Zero skips, todos, and `only` filters.

## Protected PostgreSQL gate

Command: `pnpm test-integration:local`

Exit code: `1` as required on the baseline.

- PostgreSQL: `17.10`.
- All 14 migrations applied successfully before the tests.
- Test files: 19 passed, 1 failed, 20 total.
- Tests: 266 passed, 2 failed, 268 total.
- Exact expected failures: `MG-13`, `MG-14`.
- `MG-13`: a two-citation validated provider output had one actual insert suppressed by a master DB trigger; the run incorrectly returned `SUCCEEDED` instead of atomically failing.
- `MG-14`: a direct expected-citation insert after a run reached `SUCCEEDED` completed, so the test reached `MASTER_EXPECTED_VALIDATOR_REJECTION_MISSING` instead of `generation expected citation set is closed`.
- Zero skips, todos, and `only` filters.

The clean-database and drift steps did not run because the required integration suite stopped red first. They must pass after the exact four failures are closed.

## Required green transition

The executor must make `MG-13` through `MG-16` pass without changing any protected master file. All original `MG-01` through `MG-12`, all other 266 integration tests, all other 69 unit tests, the 173-row matrix manifest, migrations `00100`–`04500`, and all prior approved contracts must remain green and unchanged in meaning.
