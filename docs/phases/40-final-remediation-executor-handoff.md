# Executor Handoff — Phase 40 Final Remediation

Implement the binding `docs/phases/40-final-remediation-control-pack.md` completely.

- Exact branch: `codex/phase-40-final-remediation`
- Starting point before the master gate commit: `a81a9eab7c99a94f19d64591bf9af30735056bf3`
- The actual executor baseline is the master gate commit at branch HEAD when this task is dispatched.
- Required files to read completely: the final-remediation control pack, this handoff, original Phase 40 control pack/report, project state, migrations `04000–04500`, generation production code, all Phase 40 tests, upgrade/verifier scripts, and protected master tests.

The protected master files listed in the control pack are immutable. Do not edit, delete, rename, skip, weaken, replace, or work around them. First run them and reproduce the expected baseline failures. Then continue autonomously through every internal work package and the full gate.

Keep the executor model selected by the owner. Do not change model or reasoning settings. Do not return a progress-only final response or ask the owner to send `continue`.

Preserve all commits and migrations through `04500`. Use only forward migration `04600` if required. Ordinary coding, test, fixture, concurrency, migration, formatting, and build failures are implementation work, not blockers.

Before writing the report, run the exact mechanical pre-report stop. Inspect logs, not only exit codes. Do not print PASS before the relevant behavioral assertions execute.

Create one implementation commit, then one report-only commit that changes only `docs/phases/40-implementation-report.md`. Do not push, merge, deploy, self-approve, or start Phase 50.

Final status: `READY FOR INDEPENDENT PHASE 40 RE-REVIEW` or `BLOCKED` with a genuine blocker.
