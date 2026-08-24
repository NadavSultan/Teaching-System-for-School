CREATE TABLE "source_version_contents" ("source_version_id" UUID PRIMARY KEY REFERENCES "source_versions"("id") ON DELETE RESTRICT,"content_hash" CHAR(64) NOT NULL,"content" VARCHAR(1000000) NOT NULL,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE "ingestion_runs" DROP CONSTRAINT "ingestion_runs_content_hash_pipeline_version_key";
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_version_hash_pipeline_key" UNIQUE ("source_version_id","content_hash","pipeline_version");

CREATE OR REPLACE FUNCTION phase30_remediation_source_version_guard() RETURNS trigger AS $$ BEGIN
  IF NEW.source_id<>OLD.source_id OR NEW.content_hash<>OLD.content_hash OR NEW.content_reference<>OLD.content_reference OR NEW.content_mime_type<>OLD.content_mime_type OR NEW.version_number<>OLD.version_number OR NEW.request_fingerprint<>OLD.request_fingerprint OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN RAISE EXCEPTION 'source version content identity is immutable'; END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS source_version_identity_immutable ON source_versions;
CREATE TRIGGER source_version_identity_immutable BEFORE UPDATE ON source_versions FOR EACH ROW EXECUTE FUNCTION phase30_remediation_source_version_guard();
CREATE OR REPLACE FUNCTION phase30_remediation_content_guard() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'source version content is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER source_version_content_append_only BEFORE UPDATE OR DELETE ON source_version_contents FOR EACH ROW EXECUTE FUNCTION phase30_remediation_content_guard();
CREATE OR REPLACE FUNCTION phase30_remediation_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Phase 30 evidence is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER pedagogical_reviews_append_only BEFORE UPDATE OR DELETE ON pedagogical_reviews FOR EACH ROW EXECUTE FUNCTION phase30_remediation_append_only();
CREATE TRIGGER usage_permissions_append_only BEFORE UPDATE OR DELETE ON usage_permissions FOR EACH ROW EXECUTE FUNCTION phase30_remediation_append_only();
CREATE TRIGGER source_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON source_lifecycle_events FOR EACH ROW EXECUTE FUNCTION phase30_remediation_append_only();
CREATE OR REPLACE FUNCTION phase30_remediation_item_guard() RETURNS trigger AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'knowledge item provenance is immutable'; END IF;
  IF NEW.source_version_id<>OLD.source_version_id OR NEW.ingestion_run_id<>OLD.ingestion_run_id OR NEW.locator<>OLD.locator OR NEW.normalized_text<>OLD.normalized_text OR NEW.text_hash<>OLD.text_hash OR NEW.metadata IS DISTINCT FROM OLD.metadata OR NEW.pipeline_version<>OLD.pipeline_version OR NEW.parser_version<>OLD.parser_version OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.visibility<>OLD.visibility THEN RAISE EXCEPTION 'knowledge item provenance is immutable'; END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS knowledge_item_provenance_immutable ON knowledge_items;
CREATE TRIGGER knowledge_item_provenance_immutable BEFORE UPDATE OR DELETE ON knowledge_items FOR EACH ROW EXECUTE FUNCTION phase30_remediation_item_guard();
CREATE TRIGGER source_version_curriculum_append_only BEFORE UPDATE OR DELETE ON source_version_curriculum_node_links FOR EACH ROW EXECUTE FUNCTION phase30_remediation_append_only();
CREATE TRIGGER knowledge_item_curriculum_append_only BEFORE UPDATE OR DELETE ON knowledge_item_curriculum_node_links FOR EACH ROW EXECUTE FUNCTION phase30_remediation_append_only();
