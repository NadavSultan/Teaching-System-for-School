# Project State

Last updated: 2026-08-18

| Field                     | State                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Current Phase             | 20 — Corrective re-review found finalized-child reparent and contract-drift blockers                  |
| Completed Phases          | 00 — Product Control & System Architecture; 10 — Secure Foundation and Contracts                      |
| Next Phase                | Phase 20 remediation; Phase 30 remains blocked pending approval                                       |
| Architecture Version      | 1.0                                                                                                   |
| Curriculum Schema Version | 1.0.0 candidate definitions exist; not established until Phase 20 approval                            |
| Knowledge Schema Version  | Not established; v1 proposed for Phase 30                                                             |
| Assessment Schema Version | 1.0.0 candidate definitions exist; not established until Phase 20 approval                            |
| Open ADRs                 | None; ADR-001 through ADR-007 are APPROVED                                                            |
| Technical Debt            | TD-001–TD-006 and TD-008 closed; TD-007 deferred; TD-009–TD-013 Phase 20 blockers                     |
| Known Risks               | R-001 through R-014 in risk register                                                                  |
| Blocking Issues           | Finalized OLD-owner reparent bypass; stale generated contract artifact; incomplete permanent evidence |

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
