ALTER TABLE "source_versions"
  ADD CONSTRAINT "source_versions_source_id_version_number_key" UNIQUE ("source_id", "version_number");

CREATE OR REPLACE FUNCTION phase30_knowledge_source_identity_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    RAISE EXCEPTION 'knowledge source ownership and visibility are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER knowledge_source_identity_immutable
  BEFORE UPDATE OF organization_id, visibility ON knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION phase30_knowledge_source_identity_immutable();

CREATE OR REPLACE FUNCTION phase30_lifecycle_chain_insert() RETURNS trigger AS $$
DECLARE
  version_row RECORD;
  latest_status "SourceLifecycleStatus";
BEGIN
  IF NEW.source_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sv.id, sv.source_id, ks.organization_id
    INTO version_row
    FROM source_versions sv
    JOIN knowledge_sources ks ON ks.id = sv.source_id
   WHERE sv.id = NEW.source_version_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle evidence requires an existing source version';
  END IF;
  IF NEW.source_id IS DISTINCT FROM version_row.source_id THEN
    RAISE EXCEPTION 'lifecycle evidence source identity is invalid';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM version_row.organization_id THEN
    RAISE EXCEPTION 'lifecycle evidence organization identity is invalid';
  END IF;

  SELECT to_status INTO latest_status
    FROM source_lifecycle_events
   WHERE source_version_id = NEW.source_version_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF latest_status IS NULL THEN
    IF NEW.from_status IS NOT NULL OR NEW.to_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'first lifecycle evidence must be DRAFT from null';
    END IF;
  ELSE
    IF NEW.from_status IS DISTINCT FROM latest_status THEN
      RAISE EXCEPTION 'lifecycle evidence from status is stale';
    END IF;
    IF NOT (
      (latest_status = 'DRAFT' AND NEW.to_status IN ('ACTIVE','SUSPENDED','DEPRECATED','FAILED','NEEDS_RE_REVIEW')) OR
      (latest_status = 'ACTIVE' AND NEW.to_status IN ('SUSPENDED','DEPRECATED','FAILED','NEEDS_RE_REVIEW')) OR
      (latest_status = 'SUSPENDED' AND NEW.to_status IN ('ACTIVE','DEPRECATED','FAILED','NEEDS_RE_REVIEW')) OR
      (latest_status = 'NEEDS_RE_REVIEW' AND NEW.to_status IN ('ACTIVE','SUSPENDED','DEPRECATED','FAILED')) OR
      (latest_status = 'FAILED' AND NEW.to_status IN ('NEEDS_RE_REVIEW','DEPRECATED'))
    ) THEN
      RAISE EXCEPTION 'source lifecycle transition is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER source_lifecycle_chain_insert
  BEFORE INSERT ON source_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION phase30_lifecycle_chain_insert();
