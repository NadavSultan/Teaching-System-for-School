# Project State

Last updated: 2026-08-16

| Field                     | State                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Phase             | 10 — Secure Foundation and Contracts (implementation reviewed; remediation required)                                                           |
| Completed Phases          | 00 — Product Control & System Architecture                                                                                                     |
| Next Phase                | 20 — Curriculum and Assessment Domain (after Phase 10 review/approval)                                                                         |
| Architecture Version      | 1.0                                                                                                                                            |
| Curriculum Schema Version | Not established; v1 proposed for Phase 20                                                                                                      |
| Knowledge Schema Version  | Not established; v1 proposed for Phase 30                                                                                                      |
| Assessment Schema Version | Not established; v1 proposed for Phase 20                                                                                                      |
| Open ADRs                 | None; ADR-001 through ADR-007 are APPROVED                                                                                                     |
| Technical Debt            | TD-001 through TD-007; TD-001–TD-004 are Critical                                                                                              |
| Known Risks               | R-001 through R-012 in risk register                                                                                                           |
| Blocking Issues           | PostgreSQL integration evidence; personal-workspace invariant; operation-specific mutation authorization; complete external contract snapshots |

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
