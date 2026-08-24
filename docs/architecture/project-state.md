# Project State

Last updated: 2026-08-24

| Field                     | State                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Phase             | 40 — Generation Engine implementation authorized and in progress                                                                                                       |
| Completed Phases          | 00 — Product Control & System Architecture; 10 — Secure Foundation and Contracts; 20 — Curriculum and Assessment Domain; 30 — Source Registry and Controlled Knowledge |
| Next Phase                | Phase 50 remains blocked pending independent Phase 40 approval                                                                                                         |
| Architecture Version      | 1.0                                                                                                                                                                    |
| Curriculum Schema Version | 1.0.0 established by approved Phase 20                                                                                                                                 |
| Knowledge Schema Version  | 1.0.0 established by approved Phase 30                                                                                                                                 |
| Assessment Schema Version | 1.0.0 established by approved Phase 20                                                                                                                                 |
| Open ADRs                 | None; ADR-001 through ADR-007 are APPROVED                                                                                                                             |
| Technical Debt            | TD-001–TD-006 and TD-008–TD-013 closed; TD-007 intentionally deferred                                                                                                  |
| Known Risks               | R-001 through R-014 in risk register                                                                                                                                   |
| Blocking Issues           | Phase 50 is blocked until independent Phase 40 approval; live provider evaluation requires owner approval and provider decision                                        |

## Architectural invariants

1. No unapproved source enters production generation context.
2. Pedagogical approval and usage permission remain separate.
3. AI output never self-promotes into trusted knowledge.
4. Structured assessment revisions, not PDFs or prose, are the source of truth.
5. Human approval of a specific revision precedes export.
6. Deterministic scoring/source/schema failures block approval.
7. Tenant ownership and authorization are server-enforced.
8. Curriculum, source, prompt, model, schema, validation, and export versions remain traceable.

## Update rule

This file is updated after every Phase Review. A phase is not marked complete from narrative claims alone; acceptance evidence must be reviewed.
