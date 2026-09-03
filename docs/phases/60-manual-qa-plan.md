# Phase 60 Manual QA Plan — Hebrew Grade 8 Pilot

Status: **BINDING QA PLAN; IMPLEMENTATION NOT STARTED**

## Purpose

Provide the product owner with the first real browser-based QA milestone. The pilot exercises Hebrew-language material for Grade 8, while the completed application remains data-driven for Grades 7–9.

## Test-data rule

The local harness may seed clearly labeled deterministic QA curriculum and source fixtures for Grades 7, 8, and 9. These fixtures are not authoritative Ministry curriculum data and must never be presented as production-approved educational content. Production curriculum/source data remains external, reviewed, persisted input.

## Required startup contract

One documented command must:

1. start a disposable local PostgreSQL database;
2. apply all 16 migrations;
3. seed one active teacher/personal workspace;
4. seed published Grade 7–9 Hebrew-language curriculum nodes;
5. seed separate eligible source items for each grade;
6. start the API and web application on printed local ports;
7. print the test identity and exact browser URL;
8. support a `--smoke` mode that completes scripted health/data checks;
9. provide safe cleanup limited to its own temporary database/processes.

The command must not require a paid provider, production credentials, Docker, external network access, or modification of user project data.

## Manual pilot journey

1. Open the local URL and verify Hebrew RTL shell and active test workspace.
2. Open “המסמכים שלי” and create a new worksheet.
3. Select Grade 8 → Hebrew language → a persisted domain/topic/skill.
4. Configure instructions, difficulty, question count/type, and create the deterministic draft.
5. Edit one question and save; verify a new revision appears and the previous revision remains readable.
6. Add one question, reorder two questions, and delete one question; save and reload after each meaningful step.
7. Regenerate one selected question; verify every unrelated question remains unchanged.
8. Open student preview and verify answers, explanations, rubrics, and teacher-only data are absent.
9. Run validation and inspect deterministic and semantic findings.
10. Correct one blocking finding or use a fixture that transitions from blocked to ready.
11. Enter a reason and acknowledge one eligible semantic warning.
12. Confirm that approval identifies the exact revision and explains immutability.
13. Approve and verify that exact revision becomes locked and remains approved after reload.
14. Create one later edit and verify it becomes a newer unapproved revision while approval history remains intact.
15. Open an older revision read-only and return to the latest revision.

## Mandatory visual/accessibility observations

- Hebrew/English mixed text, numbers, punctuation, parentheses, and nikud display in the intended order.
- No control, text, dialog, or panel clips horizontally at desktop and narrow-mobile widths.
- Keyboard-only navigation can reach all edit, validation, warning, history, and approval controls.
- Focus is visible and returns predictably after dialog completion.
- Errors are associated with the affected field and summarized accessibly.
- Loading, saved, stale conflict, insufficient context, validation blocked, and approved states are visibly distinct without relying on color alone.
- Browser console and failed-network panels remain clean throughout the successful pilot.

## Grade boundary spot checks

- Grade 7 selection shows only Grade 7 curriculum/source fixtures.
- Grade 9 selection shows only Grade 9 curriculum/source fixtures.
- Removing the eligible Grade 8 source fixture yields insufficient context; no Grade 7/9 source appears.

## Manual QA output

Record date, reviewed commit, browser/version, viewport sizes, journey result, screenshots for key states, console result, defects, and final owner verdict. Manual QA informs the independent review but does not replace automated acceptance evidence.
