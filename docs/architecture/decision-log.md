# Architectural Decision Log

Last updated: 2026-08-16 — ADR-002 through ADR-007 approved by product owner

## ADR-001 — Controlled educational sources

- Status: **APPROVED** (mandated by product charter)
- Decision: Production educational generation uses only source versions satisfying the platform approval policy. Arbitrary unapproved web content cannot automatically enter generation context.
- Reason: Educational accuracy, reproducibility, quality control, teacher trust, rights control, and commercial viability.
- Alternatives: model internal knowledge as authority; live unrestricted web retrieval; post-generation review only.
- Trade-off: slower corpus growth and explicit curation work in exchange for reliability and auditability.

## ADR-002 — Modular monolith with asynchronous workers

- Status: **APPROVED**
- Decision: one TypeScript monorepo with web, modular API, and worker deployables; PostgreSQL-backed durable jobs and outbox.
- Reason: strong boundaries without microservice operational overhead for a small team.
- Alternatives: Next.js-only application; microservices; serverless functions per capability.
- Trade-off: requires boundary discipline; individual modules can be extracted later based on measured need.

## ADR-003 — PostgreSQL-first retrieval

- Status: **APPROVED**
- Decision: mandatory relational eligibility filtering and PostgreSQL full-text/lexical ranking first; add `pgvector` only after Hebrew evaluation.
- Reason: correctness depends first on structured curriculum, approval, permission, and tenancy filters.
- Alternatives: vector database from day one; semantic-only search.
- Trade-off: lexical recall may be weaker for paraphrases; avoids premature infrastructure and semantic false confidence.

## ADR-004 — Immutable assessment revisions

- Status: **APPROVED**
- Decision: teacher/model changes create assessment revisions; approval targets one immutable revision; exports reference it.
- Reason: auditability, safe editing, reproducibility, and stable export behavior.
- Alternatives: mutate one assessment document; event sourcing every field operation.
- Trade-off: additional storage and revision logic without full event-sourcing complexity.

## ADR-005 — HTML-to-PDF with pinned runtime and fonts

- Status: **APPROVED**
- Decision: render separate student/teacher view models through versioned HTML/CSS templates using pinned Chromium and embedded licensed Hebrew fonts.
- Reason: controllable RTL layout and practical visual testing.
- Alternatives: direct PDF drawing; office-suite conversion; hosted document API.
- Trade-off: Chromium artifacts are sensitive to version/fonts, so pinning and visual regression are mandatory.

## ADR-006 — Tenant baseline in Foundation

- Status: **APPROVED**
- Decision: users, organizations, memberships, ownership, and isolation tests start in Phase 10; richer role/admin workflows remain Phase 80.
- Reason: retrofitting ownership after data exists is risky and contradicts multi-user architecture.
- Alternatives: defer all authentication/multi-user work to Phase 80.
- Trade-off: modest early effort prevents pervasive migration and authorization debt.

## ADR-007 — Model gateway and evidence-based provider selection

- Status: **APPROVED**
- Decision: all model calls use a narrow internal gateway; initial model/provider is selected with Hebrew structured-output, quality, latency, privacy, and cost evidence.
- Reason: capture configuration/cost and contain provider-specific behavior.
- Alternatives: direct SDK calls throughout; lowest-cost provider by default.
- Trade-off: adapter code does not make prompts behaviorally portable; each change still needs evaluation.
