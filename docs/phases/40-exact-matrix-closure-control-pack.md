# Phase 40 exact matrix closure control pack

## Verdict that opened this remediation

The implementation and all existing automated gates passed, but independent semantic review found that the binding acceptance matrices still contained false-positive assertion shapes. Passing counts are not closure while a wrong database guard, failure code, or incomplete graph can satisfy an assertion.

## Required closure

1. A, D, and L database-negative rows must capture and assert one exact intended database message and stable SQLSTATE for the arranged mutation. Regex alternatives, generic constraint matches, and `rejects.toThrow` are prohibited in those blocks.
2. C rows must assert the complete outcome, including the rejected concurrent call's exact reason and stable before/after counts for revisions, usage, links, outbox, and audit evidence.
3. G and O must use explicit per-ID expected tables covering state, failure code, attempts, usage, output revisions, and source links. Every registry ID must prove its own expected terminal result.
4. E1 must call the deterministic fake gateway so the eligibility path is actually reached, then assert `INSUFFICIENT_CONTEXT`, `CONTEXT_EMPTY`, null output revision, and zero output revisions, actual links, and expected links.
5. T and S write denials must assert `AccessDeniedError` plus the exact non-disclosing message. R happy paths must use explicit per-operation expected evidence. Q must compare the complete carried base/output source sets and exact concurrent results.
6. Preserve the exact 173 registry IDs, all protected master files, Phase 10/20/30 behavior, and the migration set. No Phase 50 work is allowed.

## Protected cases

- MG-17 rejects generic, alternative, aggregate, and non-exact non-empty assertion shapes.
- MG-18 requires exact database message and SQLSTATE evidence in A/D/L.
- MG-19 requires complete per-row G/O/E1 terminal and zero-write evidence.
- MG-20 requires exact T/R/S/Q/C evidence.

The executor must turn the protected source gate and the complete 268-test integration suite green. It may not edit this control pack, its handoff, the baseline, the protected tests, or either Phase 40 verifier.
