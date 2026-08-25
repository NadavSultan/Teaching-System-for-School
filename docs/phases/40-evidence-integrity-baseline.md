# Phase 40 evidence integrity baseline

Baseline HEAD before this master gate: `ede203d8ad09152e31c5da70b0f2fedf7f95d005` on `codex/phase-40-final-remediation`.

The structural gate and 75/75 unit/source tests were green. Independent source inspection rejected the handoff before rerunning PostgreSQL because E1 contained a self-check sentinel, G spellings were placed in a source-gate comment with computed keys, O expectations were generated as grouped fallbacks, and database messages were checked by substring including generic `Key (` evidence.

The new baseline must be structurally green with 23 protected cases and red only on MG-21 through MG-23.
