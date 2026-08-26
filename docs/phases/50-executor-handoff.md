# Executor Handoff — Phase 50 Validation Engine

Implement `docs/phases/50-phase-control-pack.md` completely. It is the binding contract; this handoff controls execution order and stop conditions.

## Hard identity invariants

- Repository: `Teaching-System-for-School`
- Exact branch: `codex/phase-50-validation-engine`
- Exact starting commit: the control/preparation commit named in the delegation message.
- Product baseline ancestor: `8f09173f073f13b8e565a12f3d37abac18b33bf5`
- Approved scope: Phase 50 Validation Engine only.
- Phase 60 and every later phase are prohibited.
- Keep the selected executor model and reasoning settings unchanged.
- Do not push, merge, deploy, rewrite history, self-approve, activate a real provider/evaluator, or use network/paid model calls.

Before editing, run and record `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, and `git merge-base --is-ancestor 8f09173f073f13b8e565a12f3d37abac18b33bf5 HEAD`. Stop as BLOCKED only if the branch/start commit is wrong or the worktree is not clean before your first change.

## Read completely before implementation

1. `docs/phases/50-phase-control-pack.md`
2. this handoff
3. `docs/phases/40-phase-review.md`
4. `docs/phases/40-implementation-report.md`
5. `docs/phases/40-phase-control-pack.md`
6. `docs/architecture/project-state.md`
7. `docs/architecture/system-architecture-v1.md`, especially validation, testing and roadmap sections
8. `docs/architecture/decision-log.md`, risk register, and technical-debt register
9. `tests/phase50-acceptance-manifest.json`
10. `docs/phases/50-master-gate-baseline.md`
11. `tests/phase50-master-control.test.ts`
12. `scripts/verify-phase50-control.mjs`
13. Prisma schema and all migrations `00100`–`04600`
14. Phase 20 assessment contracts/domain/database mapping and scoring/finalization tests
15. Phase 30 eligibility/authorization/retrieval code and matrices
16. Phase 40 generation contracts, registries, production code, all matrices, master gates, migration/upgrade scripts, and runbook
17. current contracts generator, API/worker/outbox/audit/redaction boundaries, architecture tests, package scripts, and CI workflow

Search for and obey every applicable `AGENTS.md`.

## Protected master artifacts

Do not edit, delete, rename, weaken, regenerate, skip, or work around:

- `docs/phases/40-phase-review.md`
- `docs/phases/50-phase-control-pack.md`
- `docs/phases/50-executor-handoff.md`
- `docs/phases/50-master-gate-baseline.md`
- `tests/phase50-acceptance-manifest.json`
- `tests/phase50-master-control.test.ts`
- `scripts/verify-phase50-control.mjs`

Do not edit any migration `00100`–`04600`. Add only `20260826005000_phase50_validation_engine`.

## Required internal work packages

Continue autonomously through every package. Inspect the substantive diff and run the nearest tests after each package, but do not return control or ask for “continue.”

1. **Frozen contracts and registries:** strict Phase 50 Zod contracts, seven generated schema artifacts, deterministic rule registry, semantic evaluator registry, strict result mapping, manifest test wiring.
2. **Forward migration and database invariants:** exact 05000 migration, registry seed, tenant/revision identities, monotonic sequence, state machine, complete-success shape, append-only evidence, legal acknowledgement, indexes, database readiness assertion, and direct-DB probes.
3. **Pure validation and semantic boundary:** all 11 deterministic rules, normalized exact leakage/duplicate policy, provider-neutral evaluator, deterministic fake, strict parser, error/retry taxonomy, no network/provider dependency.
4. **Persisted authorization and services:** implement P1–P5 and I1–I2 exactly, reusing persisted `resolveAccessContext`; never trust client role/org/user/state/registry/severity/readiness.
5. **Worker, outbox, concurrency and recovery:** ID-only events, atomic request/outbox, claim/lease/attempt policy, row locks, monotonic sequence, idempotent replay, stale recovery, exactly one terminal result.
6. **Complete evidence matrices:** implement all 130 IDs exactly with independent fixtures and exact assertions. One case may not satisfy another case merely through a combined branch. Database failures must assert SQLSTATE and exact intended database message.
7. **Upgrade, drift, source and scope gates:** staged 04600→05000 upgrade with real positive/negative probes, two clean databases, isolated shadow drift, registry/runtime agreement, disabled live evaluator, inherited Phase 40 gate, and no Phase 60/UI/PDF scope.
8. **Commits and report:** create the two implementation/evidence commits, run the full final gate, then and only then write the truthful report-only commit.

## Evidence-integrity rules

- A PASS marker is printed only after its assertion succeeds; no error may occur after a PASS marker.
- No `toBeGreaterThan(0)`, `toBeGreaterThanOrEqual(0)` as behavioral proof, bare `rejects.toThrow()`, generic-key substring, alternative-error regex, self-equality, sentinel, source-gate comment, formatter suppression, swallowed error, expected-failure wrapper, conditional skip, todo, or `.only`.
- Each matrix case arranges its named precondition and reaches the intended first guard. Discover exact PostgreSQL diagnostics from the real integration run; do not invent or broaden them.
- Timestamps cannot select latest validation; use the committed monotonic per-revision sequence.
- A failed/malformed/incomplete semantic evaluation is FAILED, never success with zero findings.
- A deterministic finding, semantic BLOCKING finding, or semantic INFO finding cannot be acknowledged. Only SEMANTIC WARNING is legal.
- Readiness re-checks current source eligibility and current trusted registries; stored old success is insufficient.
- Do not log or audit prompts, questions, answers, source text, evaluator raw output, tokens, cookies, authorization headers, credentials, or secrets.

## Mechanical pre-report stop

Do not create or modify `docs/phases/50-implementation-report.md` until the six pre-report commands in the Control Pack pass with inspected output, including `MATRIX_MANIFEST=130`, all 130 executed case IDs, zero skips, PostgreSQL, upgrade probes, and `git diff --check`.

## Final gate and commits

Run every command in the Control Pack full final gate. Record exact command, exit code, file/test counts, migration counts, zero-skip status, required markers, and deviations. Re-check exact branch, baseline ancestry, changed paths, migration prefix, protected hashes, prohibited later-phase paths, and handoff label immediately before every commit and final response.

Create:

1. core implementation commit;
2. permanent evidence/runbook/gate commit;
3. report-only commit modifying only `docs/phases/50-implementation-report.md`.

End with a clean worktree.

Final status must be exactly `READY FOR INDEPENDENT PHASE 50 REVIEW`, or `BLOCKED` only for the genuine blocker definition in the Control Pack. A progress-only final response is prohibited.
