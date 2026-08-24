-- Phase 40 final review closure. 04000 and 04100 are immutable history.

CREATE OR REPLACE FUNCTION phase40_lock_source_version() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM source_versions WHERE id = NEW.source_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source version does not exist'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS phase40_review_source_lock ON pedagogical_reviews;
CREATE TRIGGER phase40_review_source_lock
  BEFORE INSERT ON pedagogical_reviews
  FOR EACH ROW EXECUTE FUNCTION phase40_lock_source_version();
DROP TRIGGER IF EXISTS phase40_permission_source_lock ON usage_permissions;
CREATE TRIGGER phase40_permission_source_lock
  BEFORE INSERT ON usage_permissions
  FOR EACH ROW EXECUTE FUNCTION phase40_lock_source_version();

-- Existing 04100 rows are repaired only inside this migration, then append-only is restored.
DROP TRIGGER IF EXISTS generation_context_append_only ON generation_context_items;
UPDATE generation_context_items c
SET lineage = jsonb_build_array(jsonb_build_object(
  'curriculumVersionId', c.curriculum_version_id,
  'curriculumNodeId', c.curriculum_node_id
))
WHERE c.lineage = '[]'::jsonb
  AND EXISTS (
    SELECT 1 FROM knowledge_item_curriculum_node_links l
    WHERE l.knowledge_item_id = c.knowledge_item_id
      AND l.curriculum_version_id = c.curriculum_version_id
      AND l.curriculum_node_id = c.curriculum_node_id
  );
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM generation_context_items c
    WHERE jsonb_typeof(c.lineage) <> 'array' OR jsonb_array_length(c.lineage) = 0
  ) THEN RAISE EXCEPTION 'generation context lineage backfill incomplete'; END IF;
END;
$$;
ALTER TABLE generation_context_items
  DROP CONSTRAINT IF EXISTS generation_context_items_lineage_ck;
ALTER TABLE generation_context_items
  ADD CONSTRAINT generation_context_items_lineage_ck
  CHECK (jsonb_typeof(lineage) = 'array' AND jsonb_array_length(lineage) > 0);
CREATE TRIGGER generation_context_append_only
  BEFORE UPDATE OR DELETE ON generation_context_items
  FOR EACH ROW EXECUTE FUNCTION phase40_generation_append_only();

CREATE OR REPLACE FUNCTION phase40_generation_run_guard() RETURNS trigger AS $$
DECLARE assessment_org UUID; base_assessment UUID; target_assessment UUID; target_revision UUID; output_assessment UUID; output_org UUID; output_state "AssessmentRevisionState";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'generation run is immutable'; END IF;
  SELECT organization_id INTO assessment_org FROM assessments WHERE id = NEW.assessment_id;
  IF assessment_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'generation assessment owner invalid'; END IF;
  IF NEW.operation = 'DRAFT' AND (NEW.base_revision_id IS NOT NULL OR NEW.target_question_id IS NOT NULL) THEN RAISE EXCEPTION 'draft run shape invalid'; END IF;
  IF NEW.operation = 'REGENERATE_QUESTION' THEN
    IF NEW.base_revision_id IS NULL OR NEW.target_question_id IS NULL THEN RAISE EXCEPTION 'regeneration run shape invalid'; END IF;
    SELECT assessment_id INTO base_assessment FROM assessment_revisions WHERE id = NEW.base_revision_id;
    SELECT ar.assessment_id, ar.id INTO target_assessment, target_revision FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id JOIN assessment_revisions ar ON ar.id=s.revision_id WHERE q.id=NEW.target_question_id;
    IF base_assessment IS DISTINCT FROM NEW.assessment_id OR target_assessment IS DISTINCT FROM NEW.assessment_id OR target_revision IS DISTINCT FROM NEW.base_revision_id THEN RAISE EXCEPTION 'regeneration base target mismatch'; END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.attempts <> 0 OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL OR NEW.output_revision_id IS NOT NULL OR NEW.failure_code IS NOT NULL OR NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'initial generation run shape invalid'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.requesting_user_id IS DISTINCT FROM OLD.requesting_user_id OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.operation IS DISTINCT FROM OLD.operation OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR NEW.frozen_specification IS DISTINCT FROM OLD.frozen_specification OR NEW.curriculum_version_id IS DISTINCT FROM OLD.curriculum_version_id OR NEW.base_revision_id IS DISTINCT FROM OLD.base_revision_id OR NEW.target_question_id IS DISTINCT FROM OLD.target_question_id OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version OR NEW.prompt_template_hash IS DISTINCT FROM OLD.prompt_template_hash OR NEW.model_configuration_version IS DISTINCT FROM OLD.model_configuration_version OR NEW.model_configuration_hash IS DISTINCT FROM OLD.model_configuration_hash OR NEW.response_schema_version IS DISTINCT FROM OLD.response_schema_version OR NEW.response_schema_hash IS DISTINCT FROM OLD.response_schema_hash THEN RAISE EXCEPTION 'generation run identity is immutable'; END IF;
  IF NOT ((OLD.state='PENDING' AND NEW.state='PROCESSING') OR (OLD.state='PROCESSING' AND NEW.state IN ('PENDING','SUCCEEDED','INSUFFICIENT_CONTEXT','FAILED'))) THEN RAISE EXCEPTION 'invalid generation run transition'; END IF;
  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN RAISE EXCEPTION 'attempt transition invalid'; END IF;
  IF NEW.state='SUCCEEDED' THEN
    IF NEW.output_revision_id IS NULL OR NEW.provider IS NULL OR NEW.model IS NULL OR NEW.processed_at IS NULL OR NEW.failure_code IS NOT NULL THEN RAISE EXCEPTION 'success shape invalid'; END IF;
    SELECT assessment_id, a.organization_id, state INTO output_assessment, output_org, output_state FROM assessment_revisions r JOIN assessments a ON a.id=r.assessment_id WHERE r.id=NEW.output_revision_id;
    IF output_assessment IS DISTINCT FROM NEW.assessment_id OR output_org IS DISTINCT FROM NEW.organization_id OR output_state <> 'FINALIZED' THEN RAISE EXCEPTION 'output revision identity invalid'; END IF;
  ELSIF NEW.state IN ('FAILED','INSUFFICIENT_CONTEXT') THEN
    IF NEW.failure_code IS NULL OR NEW.processed_at IS NULL OR NEW.output_revision_id IS NOT NULL OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL THEN RAISE EXCEPTION 'failure shape invalid'; END IF;
  ELSE
    IF NEW.output_revision_id IS NOT NULL OR NEW.provider IS NOT NULL OR NEW.model IS NOT NULL OR NEW.failure_code IS NOT NULL OR NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'nonterminal shape invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS generation_run_guard ON generation_runs;
CREATE TRIGGER generation_run_guard BEFORE INSERT OR UPDATE OR DELETE ON generation_runs FOR EACH ROW EXECUTE FUNCTION phase40_generation_run_guard();

CREATE OR REPLACE FUNCTION phase40_generation_context_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; item_row RECORD; source_row RECORD; latest_lifecycle TEXT; latest_review TEXT; latest_permission TEXT; permission_until TIMESTAMPTZ; lineage_item JSONB;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id=NEW.generation_run_id FOR SHARE;
  SELECT ki.source_version_id, ki.organization_id, ki.visibility, ki.locator, ki.text_hash INTO item_row FROM knowledge_items ki WHERE ki.id=NEW.knowledge_item_id FOR SHARE;
  SELECT sv.source_id, ks.organization_id, ks.visibility INTO source_row FROM source_versions sv JOIN knowledge_sources ks ON ks.id=sv.source_id WHERE sv.id=NEW.source_version_id FOR SHARE;
  SELECT to_status INTO latest_lifecycle FROM source_lifecycle_events WHERE source_version_id=NEW.source_version_id ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT decision INTO latest_review FROM pedagogical_reviews WHERE source_version_id=NEW.source_version_id ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT decision, valid_until INTO latest_permission, permission_until FROM usage_permissions WHERE source_version_id=NEW.source_version_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF run_row.id IS NULL OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.locator IS DISTINCT FROM NEW.locator OR item_row.text_hash IS DISTINCT FROM NEW.text_hash OR source_row.source_id IS NULL OR latest_lifecycle <> 'ACTIVE' OR latest_review <> 'APPROVED' OR latest_permission <> 'ALLOWED' OR (permission_until IS NOT NULL AND permission_until <= NOW()) THEN RAISE EXCEPTION 'generation context identity or eligibility invalid'; END IF;
  IF NEW.curriculum_version_id IS DISTINCT FROM run_row.curriculum_version_id OR NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l JOIN curriculum_versions v ON v.id=l.curriculum_version_id WHERE l.knowledge_item_id=NEW.knowledge_item_id AND l.curriculum_version_id=NEW.curriculum_version_id AND l.curriculum_node_id=NEW.curriculum_node_id AND v.status='PUBLISHED') THEN RAISE EXCEPTION 'generation context curriculum invalid'; END IF;
  IF jsonb_typeof(NEW.lineage) <> 'array' OR jsonb_array_length(NEW.lineage)=0 THEN RAISE EXCEPTION 'generation context lineage required'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.lineage) x WHERE NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l WHERE l.knowledge_item_id=NEW.knowledge_item_id AND l.curriculum_version_id=(x->>'curriculumVersionId')::uuid AND l.curriculum_node_id=(x->>'curriculumNodeId')::uuid)) THEN RAISE EXCEPTION 'generation context lineage forged'; END IF;
  IF item_row.visibility='ORGANIZATION_PRIVATE' AND item_row.organization_id IS DISTINCT FROM run_row.organization_id THEN RAISE EXCEPTION 'generation context tenant invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS generation_context_identity ON generation_context_items;
CREATE TRIGGER generation_context_identity BEFORE INSERT ON generation_context_items FOR EACH ROW EXECUTE FUNCTION phase40_generation_context_identity();

CREATE OR REPLACE FUNCTION phase40_question_source_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; question_row RECORD; item_row RECORD;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id=NEW.generation_run_id FOR SHARE;
  SELECT aq.id, ar.assessment_id, ar.id AS revision_id INTO question_row FROM assessment_questions aq JOIN assessment_sections s ON s.id=aq.section_id JOIN assessment_revisions ar ON ar.id=s.revision_id WHERE aq.id=NEW.assessment_question_id FOR SHARE;
  SELECT ki.source_version_id, ki.locator, ki.text_hash, ki.organization_id, ki.visibility INTO item_row FROM knowledge_items ki WHERE ki.id=NEW.knowledge_item_id FOR SHARE;
  IF run_row.id IS NULL OR question_row.id IS NULL OR question_row.assessment_id IS DISTINCT FROM run_row.assessment_id OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.locator IS DISTINCT FROM NEW.locator OR item_row.text_hash IS DISTINCT FROM NEW.text_hash THEN RAISE EXCEPTION 'question source identity invalid'; END IF;
  IF run_row.operation='REGENERATE_QUESTION' AND run_row.output_revision_id IS NOT NULL AND question_row.revision_id IS DISTINCT FROM run_row.output_revision_id THEN RAISE EXCEPTION 'question source output revision invalid'; END IF;
  IF NEW.curriculum_version_id IS DISTINCT FROM run_row.curriculum_version_id OR NOT EXISTS (SELECT 1 FROM generation_context_items c WHERE c.generation_run_id=NEW.generation_run_id AND c.knowledge_item_id=NEW.knowledge_item_id AND c.curriculum_version_id=NEW.curriculum_version_id AND c.curriculum_node_id=NEW.curriculum_node_id) THEN RAISE EXCEPTION 'question source context lineage invalid'; END IF;
  IF NEW.lineage='GENERATED' AND run_row.operation='DRAFT' AND NEW.prior_question_id IS NOT NULL THEN RAISE EXCEPTION 'draft generated link prior question invalid'; END IF;
  IF NEW.lineage='GENERATED' AND run_row.operation='REGENERATE_QUESTION' AND NEW.prior_question_id IS DISTINCT FROM run_row.target_question_id THEN RAISE EXCEPTION 'regenerated link prior question invalid'; END IF;
  IF NEW.lineage='CARRIED_FORWARD' AND NEW.prior_question_id IS NULL THEN RAISE EXCEPTION 'carried link prior question required'; END IF;
  IF NEW.prior_question_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id JOIN assessment_revisions r ON r.id=s.revision_id WHERE q.id=NEW.prior_question_id AND r.id=run_row.base_revision_id AND q.id IS DISTINCT FROM NEW.assessment_question_id) THEN RAISE EXCEPTION 'prior question lineage invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS question_source_identity ON question_source_links;
CREATE TRIGGER question_source_identity BEFORE INSERT ON question_source_links FOR EACH ROW EXECUTE FUNCTION phase40_question_source_identity();

CREATE OR REPLACE FUNCTION phase40_generation_usage_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.input_tokens < 0 OR NEW.output_tokens < 0 OR NEW.total_tokens < 0 OR NEW.cost_micros < 0 OR NEW.total_tokens <> NEW.input_tokens + NEW.output_tokens THEN RAISE EXCEPTION 'generation usage values invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM generation_runs r WHERE r.id=NEW.generation_run_id AND NEW.attempt <= r.attempts AND NEW.request_id <> '') THEN RAISE EXCEPTION 'generation usage attempt invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS generation_usage_guard ON generation_usages;
CREATE TRIGGER generation_usage_guard BEFORE INSERT OR UPDATE ON generation_usages FOR EACH ROW EXECUTE FUNCTION phase40_generation_usage_guard();
