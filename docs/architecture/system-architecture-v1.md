# System Architecture Proposal v1

Status: **APPROVED**  
Architecture version: `1.0`  
Date: 2026-08-16
Approved by product owner: 2026-08-16

## A. Product definition

### Users

- MVP: authenticated teachers creating Hebrew-language material for grades 7–9.
- Near-term: coordinators who curate curriculum, sources, and shared content.
- Future: school administrators and platform administrators.

Every record with user or school relevance has explicit ownership and visibility. The first teacher is not a special architectural case.

### MVP use cases

- Select curriculum scope and create a worksheet or test.
- Configure question count, types, difficulty, emphasis, instructions, and scoring.
- Generate a structured draft using only eligible approved knowledge.
- Inspect validation findings; edit, reorder, add, delete, or regenerate one question.
- Explicitly approve a revision and export separate student and teacher PDFs.
- Audit which curriculum, sources, prompt, model configuration, and validations produced it.

### Non-MVP

School administration, team collaboration, broad question-bank sharing, DOCX export, student accounts/submissions, automatic grading, live web retrieval, large-scale curriculum authoring UI, billing, and advanced analytics.

## B. User flows

### Worksheet flow

1. Authenticate; create a draft in the active organization/personal workspace.
2. Select grade → domain → topic → subtopic/skills from a published curriculum version.
3. Configure count, difficulty, types, emphasis, optional passage, and instructions.
4. Server validates the request, resolves curriculum IDs, and freezes a generation specification.
5. Retrieval filters eligible knowledge by approval, usage permission, tenant visibility, version, and curriculum metadata; hybrid ranking is optional only after filtered candidates exist.
6. The model returns schema-constrained JSON. The server rejects malformed output.
7. Deterministic and semantic validators produce findings; nothing is silently “fixed” without a revision trail.
8. Teacher edits or regenerates a selected question. Each change creates a new assessment revision while stable question IDs preserve identity.
9. Teacher explicitly approves one revision.
10. Server renders immutable student and teacher exports from the approved structured revision.

### Test flow

The worksheet flow applies, plus section design, score allocation, and rubric/grading guidance. Before approval, deterministic validation enforces section/question/sub-question sums and the configured total (default 100). Export is blocked on scoring errors or missing answers.

## C. System architecture

Use a **modular monolith with asynchronous workers**, not microservices. One deployable application and one worker share versioned contracts but keep domain boundaries explicit.

| Module           | Responsibility                                                         | Must not do                                          |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Web UI           | RTL configuration, editor, validation display, approval, export access | Call model providers directly                        |
| API/application  | AuthZ, use-case orchestration, transactions, idempotency               | Embed curriculum/source rules in controllers         |
| Identity/tenancy | Users, organizations, memberships, roles, ownership policy             | Infer tenant from client-supplied IDs alone          |
| Curriculum       | Versioned hierarchy and publish lifecycle                              | Hard-code Hebrew curriculum in application logic     |
| Source registry  | Authority, review, permission, eligibility, source versions            | Collapse pedagogy and legal permission into one flag |
| Ingestion worker | Parse, normalize, chunk, validate, index, preserve provenance          | Ingest unapproved sources into production retrieval  |
| Retrieval        | Mandatory structured eligibility filter, then lexical/semantic ranking | Search the open web during generation                |
| Generation       | Provider adapter, prompt assembly, structured output, usage capture    | Persist raw prose as assessment truth                |
| Validation       | Deterministic rules and separately identified AI-assisted checks       | Treat model self-review as proof                     |
| Assessment       | Revisions, sections/questions, approval state, scoring                 | Mutate an approved revision                          |
| Rendering        | Student/teacher view models and PDF artifacts                          | Reinterpret educational logic                        |
| Audit/telemetry  | Events, traces, cost, model/prompt/schema versions                     | Log secrets or unnecessary personal content          |

Boundary rule: modules communicate through application services and versioned schemas; only the owning module writes its tables. Jobs use an outbox-backed queue so database commit and job publication cannot diverge.

## D. Technology stack

| Area           | Recommendation                                                                                      | Reason / trade-off                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language/repo  | TypeScript monorepo, `pnpm`, Turborepo                                                              | One language and shared schemas reduce handoff cost. Python is stronger for some document/ML tooling but adds a second runtime; introduce it only if measured ingestion quality requires it. |
| Frontend       | Next.js + React, server-rendered shell, accessible component primitives, CSS logical properties     | Strong full-stack ecosystem and RTL control. Avoid a UI framework whose RTL behavior cannot be snapshot-tested.                                                                              |
| API            | NestJS-style modular API (within the monorepo)                                                      | Explicit modules, DI, guards, OpenAPI, and testability. Next-only route handlers are simpler but encourage domain/controller coupling as workflows grow.                                     |
| Contracts      | Zod at boundaries; JSON Schema snapshots for AI output and external contracts                       | Runtime validation and TypeScript inference. Database types are not API contracts.                                                                                                           |
| Database       | PostgreSQL; Prisma ORM plus reviewed SQL migrations                                                 | Relational integrity fits versioning, ownership, scoring, and provenance. Prisma improves developer speed; use SQL for constraints/search/features it cannot express well.                   |
| Jobs           | PostgreSQL-backed queue initially                                                                   | Avoids Redis operations for MVP and supports durable ingestion/generation/export jobs. Move only when measured load requires it.                                                             |
| Authentication | Managed OIDC-capable provider, with internal User/Organization/Membership authorization             | Safer than custom auth. Provider selection remains open because cost, region, and desired login methods matter. Domain authorization stays provider-independent.                             |
| Storage        | S3-compatible private object storage with signed short-lived downloads                              | Replaceable and suitable for sources/exports. Metadata and access policy remain in PostgreSQL.                                                                                               |
| AI             | Provider-neutral `ModelGateway`; initial provider/configuration is an approved deployment setting   | Enables structured output, timeouts, retries, usage/cost capture, and controlled migration. Do not promise provider portability at the prompt-behavior level.                                |
| Retrieval      | PostgreSQL metadata + full-text search first; `pgvector` only after evaluation demonstrates benefit | Hebrew curriculum filters are primary. Starting with an external vector database adds operational cost without evidence.                                                                     |
| PDF            | HTML/CSS print templates rendered by pinned Playwright/Chromium with embedded licensed Hebrew fonts | Best path to shared RTL layout and visual regression tests. Browser/version/font pinning is mandatory for reproducibility.                                                                   |
| Deployment     | EU-region managed PostgreSQL/object storage and container hosting; exact vendor open                | Low operations burden and future worker separation. Israeli privacy/data-location needs must be confirmed before vendor approval.                                                            |
| Monitoring     | OpenTelemetry + error tracker + structured logs; product/cost events in PostgreSQL initially        | Vendor-neutral instrumentation with modest MVP overhead. Content redaction and retention rules apply.                                                                                        |

## E. Data model

All mutable business entities use UUIDs, `created_at`, `updated_at`; tenant-owned entities include `organization_id`. Critical tables use database constraints and row-aware authorization in application services; PostgreSQL RLS is defense-in-depth after policies are tested.

- Identity: `User`, `Organization`, `Membership(role,status)`. Personal workspace is represented as a one-member organization, avoiding nullable ownership semantics.
- Curriculum: `Curriculum`, immutable `CurriculumVersion(status)`, `CurriculumNode(parent_id,type,code,label,sort_order)`, and `SkillDifficulty`/metadata. Assessments reference a published version and node IDs.
- Sources: `KnowledgeSource` (logical identity), immutable `SourceVersion` (file/hash/publication metadata), `PedagogicalReview`, `UsagePermission`, `SourceLifecycleEvent`.
- Knowledge: immutable `KnowledgeItem(source_version_id, locator, text_hash, metadata, status)` and optional `KnowledgeEmbedding(model_version, vector)`. Items are never detached from source provenance.
- Assessment: `Assessment` (identity/owner/type), immutable `AssessmentRevision` (specification/status/version stamps), `AssessmentSection`, `AssessmentQuestion`, `SubQuestion`, `Answer`, `RubricCriterion`, `QuestionSourceLink`.
- Execution: `GenerationRun` and `GenerationUsage`; `ValidationRun` and `ValidationResult`; `Export` with artifact hash/template/browser/font versions; `AuditEvent`; `OutboxEvent`.
- Question bank: use `Question` plus immutable `QuestionRevision` only when promotion/reuse is implemented. Assessment questions remain snapshots so later bank edits cannot change old assessments.

Avoid a table for every curriculum level: typed adjacency nodes allow future grades/subjects without schema redesign while validation rules enforce allowed parent-child types.

## F. Source and knowledge architecture

Pedagogical status, usage permission, and operational lifecycle are independent dimensions.

Eligibility predicate for production generation is deny-by-default:

`pedagogical_review = approved AND usage_permission.ai_generation = allowed AND source_version = active AND knowledge_item = active AND tenant_visibility permits access`

Lifecycle: discovered → pending review → pedagogically reviewed → usage classified → approved → ingested → indexed → active. Rejected, suspended, deprecated, and needs-re-review are terminal/side states with recorded reasons. Approval applies to a source version, not forever to a URL. A new content hash requires review or an explicit controlled carry-forward policy.

Ingestion is idempotent by source-version hash and pipeline version: malware/file checks → parsing → normalized structural extraction → metadata assignment → chunk/item creation → quality checks → index publication. Failed runs never partially activate items. Every item stores page/section/location and source-version lineage.

AI-generated content has origin `ai_generated` and is retrieval-ineligible until a human review and permitted-use decision explicitly promotes that exact revision.

## G. AI/RAG architecture

1. Resolve only published curriculum IDs; reject free-text attempts to bypass the taxonomy.
2. Build the candidate set using the eligibility predicate and request metadata.
3. Rank candidates lexically first. Evaluate semantic or hybrid retrieval on a Hebrew benchmark before enabling it.
4. Construct a bounded context with item IDs and source-version IDs; enforce token and cost budgets.
5. Send versioned system/task prompts through `ModelGateway` and require the current assessment JSON schema.
6. Parse and validate server-side; persist the exact run configuration, item lineage, token counts, costs, and provider request identifier (not secrets).
7. Regenerate a question using its stable ID, neighboring constraints, generation specification, and approved context; create a new assessment revision and leave other question snapshots unchanged.

The model may generate pedagogical material from approved context but must not assert that its internal knowledge is an approved source. Insufficient context is a first-class outcome, not permission to improvise facts.

## H. Validation architecture

- Deterministic blocking rules: schema, required fields, counts, allowed curriculum IDs, answer presence, score arithmetic, unique IDs, source eligibility, revision consistency, approval/export invariants.
- Semantic findings: Hebrew correctness, ambiguity, answer validity, difficulty, curriculum fit, duplication, accidental answer leakage. These are versioned evaluator outputs with confidence/severity, never disguised as deterministic proof.
- Teacher validation: findings are visible; teacher must explicitly approve a specific revision. Critical deterministic failures cannot be overridden. Semantic warnings may be acknowledged with an audit event.

Validation rules and evaluator/prompt/model versions are stored on each run. A test must use integers in the smallest scoring unit or exact decimals—never floating-point equality.

## I. Document architecture

Approved `AssessmentRevision` → deterministic student/teacher view models → escaped semantic HTML → versioned RTL print templates → pinned Chromium + embedded fonts → PDF → structural and visual QA → private immutable artifact.

The teacher view includes answers, explanations, point allocation, rubrics, and optional internal notes; the student view excludes those fields by construction, not CSS hiding. Exports store input revision ID and artifact/configuration hashes. DOCX can later consume the same view models.

## J. Security model

MVP baseline: managed authentication; server-side authorization on every object; explicit tenant ownership; private buckets; short-lived signed URLs; encrypted transport/storage; CSRF/session protections; secure headers; strict input/file validation; malware scanning before ingestion; secret manager; model keys server-only; rate/cost quotas; idempotency; immutable audit events; dependency scanning; backups and restore test; deletion/retention policy; log redaction.

Do not collect student accounts or unnecessary student PII. Free-text student names should not be stored by default; PDF name fields can be blank for handwriting. Future sharing and school roles require policy tests before UI exposure.

## K. Testing strategy

- Unit: scoring, eligibility predicate, curriculum transitions, schemas, revision behavior, authorization policy, view-model separation.
- Database/integration: migrations, constraints, transaction/outbox behavior, tenant isolation, source lifecycle, job idempotency, storage access.
- Contract: JSON Schema fixtures, OpenAPI compatibility, provider adapter error/retry behavior.
- Retrieval evaluation: curated Hebrew queries with expected eligible source/item sets; measure recall/precision and verify zero ineligible leakage.
- AI evaluation: frozen representative tasks, schema success, groundedness/source use, correctness and ambiguity scored by a reviewed rubric; model changes require comparison, not blind snapshots.
- Hebrew/RTL: punctuation, numbering, mixed-direction text, parentheses, tables, nikud, long text, page breaks, headers/footers.
- PDF: text extraction assertions, student-answer leakage checks, page count/splitting invariants, and rendered-page image regression with approved tolerances.
- End-to-end: worksheet and 100-point test from configuration through approval/export, single-question regeneration, insufficient knowledge, failed provider, unauthorized cross-tenant access.

Each phase ships tests and evidence; “works” without commands/results/artifacts is not acceptance evidence.

## L. Repository and development environment

```text
apps/web                 # Next.js UI
apps/api                 # modular HTTP API
apps/worker              # ingestion/generation/export workers
packages/contracts       # Zod + published JSON Schemas
packages/domain          # framework-light domain rules
packages/db              # schema, migrations, repositories
packages/ai              # gateway, prompts, model configs
packages/rendering       # view models, templates, fonts policy
packages/testing         # fixtures and test helpers
docs/architecture        # proposal, ADRs, state, risks, debt
docs/runbooks            # local/deploy/restore/incident procedures
```

Local development uses pinned Node/pnpm versions, containerized PostgreSQL, an S3-compatible emulator, deterministic seed data, and fake model/provider adapters by default. Secrets live in ignored `.env.local`; a committed `.env.example` contains names only. CI runs formatting, lint, type checking, tests, migration checks, secret/dependency scans, and selected PDF snapshots.

## M. Development roadmap

### 00 — Architecture approval and controls

- Objective: approve boundaries, technologies, schemas, quality gates, ADRs, and roadmap.
- Deliverables: this proposal, state/debt/risk registers, approved ADRs.
- Dependencies: product-owner decisions in section O.
- Acceptance: all blocking decisions explicitly approved/amended; no application code.
- Tests: document consistency review.
- Out of scope: implementation.

### 10 — Secure foundation and contracts

- Objective: runnable monorepo and secure multi-tenant application shell.
- Scope: web/API/worker, PostgreSQL/migrations, fake adapters, authentication integration, User/Organization/Membership, authorization policy, observability skeleton, CI, core versioned contracts.
- Acceptance: local one-command startup; two-user isolation test; health/readiness; migration up/down in disposable DB; no client model keys; ADR/docs current.
- Required tests: unit, API integration, tenant isolation, CI smoke.
- Out of scope: curriculum data, real generation, ingestion, polished UI.

### 20 — Curriculum and assessment domain

- Objective: versioned curriculum and structured revision/scoring model.
- Scope: curriculum lifecycle/import, assessment schema, revision state machine, exact scoring rules.
- Dependencies: Phase 10 identity/contracts.
- Acceptance: published versions are immutable; hierarchy validation; valid worksheet/test fixtures; 100-point invariant; no hard-coded curriculum branches.
- Tests: domain/property tests, migration/integration, invalid hierarchy/scoring cases.
- Out of scope: complete national mapping, AI, editor, PDF.

### 30 — Source registry and controlled knowledge

- Objective: auditable approved-source lifecycle and retrieval substrate.
- Scope: separate reviews/permissions, versioned sources, ingestion jobs, provenance, filtered lexical retrieval, small approved seed set.
- Acceptance: deny-by-default eligibility; new source hash cannot inherit eligibility silently; idempotent ingestion; every result traceable; suspension removes results.
- Tests: lifecycle matrix, tenant visibility, parser fixtures, failure recovery, retrieval benchmark baseline.
- Out of scope: open-web generation, massive corpus, semantic search unless evidence supports it.

### 40 — Generation engine

- Objective: schema-valid, traceable worksheet/test drafts and isolated question regeneration.
- Scope: gateway, versioned prompts/configs, context budgets, usage/cost, structured output, failure/retry policy.
- Acceptance: fake-provider deterministic suite; real-provider gated evaluation; source lineage; insufficient-context behavior; regeneration preserves unrelated snapshots.
- Tests: contracts, adapters, idempotency, timeout/rate-limit, Hebrew evaluation set.
- Out of scope: final validation/editor/PDF polish.

### 50 — Validation engine

- Objective: block invalid material and expose versioned semantic findings.
- Scope: deterministic rules, semantic evaluator interface, findings/overrides, validation runs.
- Acceptance: score/schema/source failures block approval; semantic evidence retained; evaluator failures do not become passes.
- Tests: rule matrix, adversarial answers/leakage, regression/evaluation suite.
- Out of scope: fully automated educational certification.

### 60 — Teacher workspace and approval

- Objective: complete RTL authoring/review workflow.
- Scope: configuration, draft editor, reorder/add/delete/edit/regenerate, findings, revision history, explicit approval.
- Acceptance: no lost edits; approved revision immutable; accessible keyboard workflow; correct mixed RTL/LTR behavior.
- Tests: component, state/concurrency, authorization, E2E user journeys.
- Out of scope: collaboration, advanced templates/shared banks.

### 70 — Document generation

- Objective: production-quality student and teacher PDFs.
- Scope: view models, templates, worker, storage, download policy, Hebrew font licensing/pinning.
- Acceptance: zero answer leakage in student output; accurate teacher scoring; representative RTL corpus visually approved; reproducible artifact metadata.
- Tests: structural, extraction, security, visual regression, long-document performance.
- Out of scope: DOCX and arbitrary template designer.

### 80 — Roles, administration, and operational hardening

- Objective: expand the Phase 10 tenancy baseline for coordinator/admin workflows.
- Scope: role management, source/curriculum review UI, quotas, retention/deletion, audit access, backup/restore drill.
- Acceptance: role matrix enforced server-side; privileged changes audited; restore target demonstrated.
- Tests: policy matrix, escalation attempts, lifecycle E2E, restore drill.
- Out of scope: enterprise SSO/billing unless reprioritized.

### 90 — Full integration and release-candidate QA

- Objective: prove the complete MVP against acceptance/evaluation baselines.
- Acceptance: all critical paths pass; no critical debt; risk review complete; performance/cost/error budgets measured; Hebrew SME sign-off recorded.
- Tests: full regression, security review, load/failure recovery, AI/retrieval evaluations, PDF corpus.
- Out of scope: new features.

### 100 — Production deployment

- Objective: reproducible secure production environment and controlled launch.
- Acceptance: infrastructure/runbooks, migrations, monitoring/alerts, backups, rollback, domain/TLS, secrets, smoke tests, cost caps.
- Tests: staging rehearsal, migration/rollback, restore, synthetic monitoring.
- Out of scope: broad public launch.

### 110 — Production QA and pilot

- Objective: validate with the first teacher under monitored real use.
- Acceptance: incident/feedback triage, output sampling, cost/latency metrics, no unresolved critical defects, go/no-go review.
- Tests: production smoke, sampled educational review, tenant/access audit.
- Out of scope: automatic scope expansion.

Every phase ends with the permanent architect’s Phase Review before dependent work starts.

## N. Principal risks

The maintained register is [risk-register.md](risk-register.md). Highest baseline risks are educational correctness, source rights, Hebrew PDF fidelity, tenant isolation, model variability, and uncontrolled cost. Mitigations are designed into gates rather than deferred to launch.

## O. Approved architectural decisions and operating assumptions

The product owner approved decisions 1–7 as written on 2026-08-16:

1. Modular TypeScript monolith with separate worker; no microservices for MVP.
2. Next.js/React + modular NestJS-style API + PostgreSQL/Prisma.
3. PostgreSQL filtered lexical retrieval first; semantic retrieval only after benchmark evidence.
4. HTML/CSS + pinned Playwright/Chromium PDF architecture.
5. Personal workspaces represented as organizations; authentication/tenant isolation begins in Phase 10, while richer roles remain Phase 80.
6. Managed authentication and EU-region managed infrastructure; exact vendors selected after requirements for login methods, budget, data location, and procurement are confirmed.
7. Provider-neutral model gateway with an initial provider/model approved separately after Hebrew structured-generation evaluation and cost comparison.
   Operating assumptions approved with the architecture:

- Initial login is email-based. Phase 10 keeps the application boundary provider-neutral and uses local/test adapters until a managed provider is deliberately selected.
- Development must not activate paid services without explicit owner approval; local services and free tiers may be used when their terms and limits are documented.
- The initial pilot is one teacher, while all ownership and authorization remain multi-user capable.
- Student personal information is not stored. Source files containing student personal information are out of scope unless a later privacy review explicitly changes this.
- Formal privacy and licensing review is required before commercial production, not before local foundation development.
- Production AI API and infrastructure costs are distinct from Codex membership usage and require approval before activation.
