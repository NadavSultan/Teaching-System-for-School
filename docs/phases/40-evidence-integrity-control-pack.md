# Phase 40 evidence integrity control pack

## Why this gate exists

The MG-17 through MG-20 source gate became green, but independent inspection found non-evidence tokens added only to satisfy source matching: a self-equality string in E1, registry spellings placed in a comment, computed object keys, and a grouped O expectation generator. The database helper also accepted message substrings such as `Key (` rather than one parsed exact database message.

## Required closure

1. Delete every source-gate or formatter-suppression comment, self-check constant/assertion, computed-key workaround, and evidence-only sentinel. Normal quoted or unquoted literal object keys are both accepted; do not suppress Prettier to preserve a matcher-specific spelling.
2. Keep the real E1 SQL count helper and assert its numeric result; do not mention a nonexistent Prisma model merely to satisfy a source string.
3. Write literal, explicit, comment-free expectation entries for every G and O registry ID. Do not generate O expectations with `Object.fromEntries`, `map`, grouped ternaries, or shared fallback objects.
4. Add `extractDatabaseDiagnostic` that extracts a real PostgreSQL SQLSTATE and the underlying database message from the caught Prisma/raw error. `expectExactDatabaseError` must compare `databaseMessage` with `expectedMessage` using exact equality.
5. Replace generic unique evidence such as `Key (` with the exact observed PostgreSQL message for the specific named constraint and retain the exact SQLSTATE.
6. Give every D ID a distinct arrangement. In particular, `run-identity` must reach immutable run identity; `forged-owner` must reach owner validation; `success-without-revision` must first enter PROCESSING and reach `success shape invalid`; `wrong-assessment-revision` must use a real foreign finalized revision and reach `output revision identity invalid`; forged question/run and source identities must use new, otherwise-valid inserts that reach their named question-source guards rather than terminal append-only; duplicate idempotency must use a new row ID and collide on the idempotency constraint rather than the primary key.
7. All product, graph, zero-write, manifest, migration, branch, phase, and protected-file requirements from the earlier control packs remain binding.

MG-21 through MG-24 are protected. Passing source tests without real runtime evidence is prohibited.
