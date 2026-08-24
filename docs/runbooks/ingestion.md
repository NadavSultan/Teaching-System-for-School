# Source ingestion runbook

Phase 30 ingestion is a durable outbox workflow. Registering a source version computes its SHA-256 content hash on the server and records an immutable version plus exact published CurriculumVersion/Node links. Registration never carries forward review, usage permission, lifecycle, or ingestion state from another hash.

The request operation creates or reuses an `IngestionRun` keyed by source content hash and pipeline version, then publishes a bounded `source.ingest.requested` outbox event. The worker claims the event using the Phase 10 lease/stale-recovery mechanism. A narrow local text adapter normalizes paragraphs, assigns deterministic `paragraph:N` locators, hashes each normalized item, validates quality, links exact curriculum lineage, and activates the item set in one transaction.

Review approval, AI usage permission, and operational activation are separate append-only evidence dimensions. Retrieval is deny-by-default: tenant visibility, exact published curriculum, source lifecycle, item lifecycle, latest pedagogical decision, and latest non-expired usage permission are all applied before PostgreSQL lexical ranking. Suspension or permission removal therefore excludes items immediately.

Test fixtures use documented `fixture://` references and contain no student data. Raw source/item text must not be placed in audit metadata, outbox payloads, safe failure classes, logs, telemetry, or thrown errors. No arbitrary URL fetcher or paid storage provider is enabled by this phase.
