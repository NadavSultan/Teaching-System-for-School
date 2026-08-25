# Phase 40 evidence integrity executor handoff

Start from the exact master commit that introduces MG-21 through MG-23. Reproduce a green structural verifier and a red 78-test unit/source baseline. Change only the six executor matrix tests and, after all gates pass, the implementation report. Do not edit protected tests, verifiers, control documents, migrations, production code, the registry, or later phases.

Remove source-only sentinels and comments. Implement explicit G/O tables and an exact parsed database diagnostic helper. Discover real database messages from the PostgreSQL integration run; do not invent or broaden them. Repeat the full Phase 40 gate, create one implementation/test commit followed by one report-only commit, and return only after a clean `READY FOR INDEPENDENT PHASE 40 RE-REVIEW` handoff.
