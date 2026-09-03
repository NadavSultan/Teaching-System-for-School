# Executor Handoff — Phase 60 Teacher Workspace and Approval

Implement `docs/phases/60-phase-control-pack.md` completely.

## Exact identity

- Branch: `codex/phase-60-teacher-workspace`
- Starting commit: `eb94f524435c0ecd58277649ef33d07ff9c51624`
- Phase: 60 only
- Pilot: Hebrew language, Grade 8, worksheet-first manual QA
- Final Phase 60 scope: data-driven Grades 7–9 from their persisted approved curriculum and eligible learning materials

Before editing, verify and report internally:

```text
branch=codex/phase-60-teacher-workspace
HEAD=eb94f524435c0ecd58277649ef33d07ff9c51624
baseline_is_ancestor=YES
worktree=clean
migrations=15
phase60_control=EXPECTED_RED_MISSING_IMPLEMENTATION
```

If identity differs or the tree contains changes you did not create, do not reset, copy, or reconcile. Inspect and report the exact state.

## Required reading

Read every governing/protected file listed in the Control Pack, plus all production and permanent test code for Phase 20 assessment revisions, Phase 30 source eligibility, Phase 40 generation/regeneration, Phase 50 validation/readiness, the current API/auth boundary, and the current web shell.

## Binding implementation rules

1. Never mutate a finalized assessment revision. Every teacher edit creates an atomic new finalized snapshot.
2. Add stable logical question identity and preserve it through edit/reorder/regeneration.
3. Approve only the latest owned revision through a database guard that invokes the Phase 50 approvability assertion in the same transaction.
4. Reload persisted user, membership, role, organization, tenant ownership, revision identity, validation identity, and approval identity. Never trust client authority fields.
5. Grade 8 is only the pilot fixture. Grades 7–9 use generic persisted curriculum/source data. Never hard-code Grade 8 or borrow material across grades.
6. Student preview is a separate answer-free view model. CSS hiding is prohibited.
7. Preserve all 15 historical migrations and every Phase 10–50 invariant. Create only the exact `06000` migration.
8. Do not add PDF/rendering/storage/download, provider SDK/network, collaboration, admin, student, deployment, billing, analytics, or Phase 70 scope.
9. Implement all 125 named cases as explicit permanent tests with real arrangements and exact assertions. No callback/proxy acceptance table, skip, todo, only, or expected-failure case.
10. Capture real API/worker/browser logging surfaces for redaction evidence; string inspection of a fake payload alone is insufficient.

## Autonomous packages

Execute P60-0 through P60-8 in the exact order defined by the Control Pack. After each package, inspect the diff and run focused gates, then continue automatically. Do not return control after a package, after a test run, or after an ordinary failure.

Use the mechanical pre-report stop. Do not create or edit `docs/phases/60-implementation-report.md` until all eight stop conditions pass with inspected output. Then run the complete final gate, create coherent forward commits, create one final report-only commit, and leave the branch clean.

## Stop policy

Do not stop for implementation complexity, a failing test, TypeScript/lint/format error, missing fixture/helper, migration/SQL correction, browser setup, port conflict, package-cache issue, or a need to revise your own Phase 60 code. Fix it and continue.

Stop only for the genuine external/product blocker defined in the Control Pack. A blocker report must include exact commands, errors, attempted recoveries, and the smallest missing decision/artifact.

Do not push, merge, deploy, rewrite history, self-approve, or start Phase 70.

Final status must be exactly one of:

- `READY FOR INDEPENDENT PHASE 60 REVIEW`
- `BLOCKED`
