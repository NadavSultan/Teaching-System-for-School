# Phase 40 exact matrix closure executor handoff

Start only from the master-gate commit that adds MG-17 through MG-20. Work only on `codex/phase-40-final-remediation`. Do not edit protected master artifacts, migrations, the acceptance registry, or later-phase files.

Read `40-exact-matrix-closure-control-pack.md` completely. Reproduce the red unit/source gate before implementation. Correct every binding T/R/S/G/O/Q/C/A/D/L/E1 row, not only the four source patterns named by the test. Use real arrangements, exact expected values, and stable database error evidence. Do not weaken assertions or replace them with new sentinels.

Before the report, all of these must pass with zero skips: both Phase 40 verifiers, all unit/source tests, all 268 PostgreSQL integration tests, the staged upgrade test, format, lint, typecheck, contracts, architecture, fresh migration, drift, live-disabled preflight, build, protected hashes, and `git diff --check`.

Create one implementation commit, then update the Phase 40 report truthfully and create one report-only commit. Return only `READY FOR INDEPENDENT PHASE 40 RE-REVIEW` after a clean worktree, or a genuine external/contract blocker.
