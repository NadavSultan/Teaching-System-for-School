DO $$
DECLARE
  version_row RECORD;
BEGIN
  FOR version_row IN
    SELECT sv.id, sv.source_id, ks.organization_id, sv.lifecycle
    FROM source_versions sv
    JOIN knowledge_sources ks ON ks.id = sv.source_id
    WHERE NOT EXISTS (
      SELECT 1 FROM source_lifecycle_events sle WHERE sle.source_version_id = sv.id
    )
  LOOP
    INSERT INTO source_lifecycle_events
      (source_version_id, source_id, organization_id, actor_user_id, from_status, to_status, reason, safe_metadata)
    VALUES
      (version_row.id, version_row.source_id, version_row.organization_id, NULL, NULL, version_row.lifecycle,
       'Backfilled lifecycle evidence', '{}'::jsonb);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS source_version_lifecycle_controlled ON source_versions;
DROP TRIGGER IF EXISTS source_version_lifecycle_evidence ON source_versions;
DROP TRIGGER IF EXISTS knowledge_item_status_immutable ON knowledge_items;
DROP FUNCTION IF EXISTS phase30_controlled_lifecycle_update();
DROP FUNCTION IF EXISTS phase30_lifecycle_evidence_match();
DROP FUNCTION IF EXISTS phase30_item_status_immutable();

CREATE OR REPLACE FUNCTION phase30_final_lifecycle_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source lifecycle is controlled by append-only evidence';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER source_version_lifecycle_immutable
  BEFORE UPDATE OF lifecycle ON source_versions
  FOR EACH ROW EXECUTE FUNCTION phase30_final_lifecycle_immutable();

CREATE OR REPLACE FUNCTION phase30_final_lifecycle_insert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.lifecycle <> 'DRAFT' THEN
    RAISE EXCEPTION 'source version must begin in DRAFT';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER source_version_lifecycle_insert_guard
  BEFORE INSERT ON source_versions
  FOR EACH ROW EXECUTE FUNCTION phase30_final_lifecycle_insert_guard();

CREATE OR REPLACE FUNCTION phase30_final_item_status_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'knowledge item status is immutable; source lifecycle controls eligibility';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER knowledge_item_status_immutable
  BEFORE UPDATE OF status ON knowledge_items
  FOR EACH ROW EXECUTE FUNCTION phase30_final_item_status_immutable();
