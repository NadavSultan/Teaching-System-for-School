# Phase 40 evidence integrity baseline

Baseline HEAD before this master gate: `ede203d8ad09152e31c5da70b0f2fedf7f95d005` on `codex/phase-40-final-remediation`.

The structural gate and 75/75 unit/source tests were green. Independent source inspection rejected the handoff before rerunning PostgreSQL because E1 contained a self-check sentinel, G spellings were placed in a source-gate comment with computed keys, O expectations were generated as grouped fallbacks, and database messages were checked by substring including generic `Key (` evidence.

The new baseline must be structurally green with 24 protected cases. After the semantic fixes, MG-21 remains intentionally red only when matcher-driven `prettier-ignore` comments are present; ordinary quoted or unquoted literal keys are accepted.
