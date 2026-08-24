ALTER TABLE "generation_runs"
  ADD COLUMN "processing_started_at" TIMESTAMPTZ,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ;
ALTER TABLE "generation_context_items" ADD COLUMN "lineage" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION phase40_generation_run_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'generation run is immutable'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.operation = 'DRAFT' AND (NEW.base_revision_id IS NOT NULL OR NEW.target_question_id IS NOT NULL) THEN RAISE EXCEPTION 'draft run shape invalid'; END IF;
    IF NEW.operation = 'REGENERATE_QUESTION' AND (NEW.base_revision_id IS NULL OR NEW.target_question_id IS NULL) THEN RAISE EXCEPTION 'regeneration run shape invalid'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.requesting_user_id IS DISTINCT FROM OLD.requesting_user_id OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.operation IS DISTINCT FROM OLD.operation OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR NEW.frozen_specification IS DISTINCT FROM OLD.frozen_specification OR NEW.curriculum_version_id IS DISTINCT FROM OLD.curriculum_version_id OR NEW.base_revision_id IS DISTINCT FROM OLD.base_revision_id OR NEW.target_question_id IS DISTINCT FROM OLD.target_question_id OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version OR NEW.prompt_template_hash IS DISTINCT FROM OLD.prompt_template_hash OR NEW.model_configuration_version IS DISTINCT FROM OLD.model_configuration_version OR NEW.model_configuration_hash IS DISTINCT FROM OLD.model_configuration_hash OR NEW.response_schema_version IS DISTINCT FROM OLD.response_schema_version OR NEW.response_schema_hash IS DISTINCT FROM OLD.response_schema_hash THEN
    RAISE EXCEPTION 'generation run identity is immutable';
  END IF;
  IF NEW.operation = 'DRAFT' AND (NEW.base_revision_id IS NOT NULL OR NEW.target_question_id IS NOT NULL) THEN RAISE EXCEPTION 'draft run shape invalid'; END IF;
  IF NEW.operation = 'REGENERATE_QUESTION' AND (NEW.base_revision_id IS NULL OR NEW.target_question_id IS NULL) THEN RAISE EXCEPTION 'regeneration run shape invalid'; END IF;
  IF NEW.provider IS DISTINCT FROM OLD.provider AND NEW.state <> 'SUCCEEDED' THEN RAISE EXCEPTION 'provider only allowed on success'; END IF;
  IF NEW.model IS DISTINCT FROM OLD.model AND NEW.state <> 'SUCCEEDED' THEN RAISE EXCEPTION 'model only allowed on success'; END IF;
  IF NEW.output_revision_id IS DISTINCT FROM OLD.output_revision_id AND NEW.state <> 'SUCCEEDED' THEN RAISE EXCEPTION 'output revision only allowed on success'; END IF;
  IF NEW.failure_code IS DISTINCT FROM OLD.failure_code AND NEW.state NOT IN ('FAILED','INSUFFICIENT_CONTEXT') THEN RAISE EXCEPTION 'failure code only allowed on terminal failure'; END IF;
  IF NEW.processed_at IS DISTINCT FROM OLD.processed_at AND NEW.state NOT IN ('SUCCEEDED','FAILED','INSUFFICIENT_CONTEXT') THEN RAISE EXCEPTION 'processed time only allowed on terminal state'; END IF;
  IF NOT ((OLD.state = 'PENDING' AND NEW.state = 'PROCESSING') OR (OLD.state = 'PROCESSING' AND NEW.state IN ('PENDING','SUCCEEDED','INSUFFICIENT_CONTEXT','FAILED'))) THEN
    RAISE EXCEPTION 'invalid generation run transition';
  END IF;
  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN RAISE EXCEPTION 'generation attempts are immutable except one claim'; END IF;
  IF NEW.state = 'SUCCEEDED' AND (NEW.output_revision_id IS NULL OR NEW.provider IS NULL OR NEW.model IS NULL OR NEW.processed_at IS NULL) THEN RAISE EXCEPTION 'successful run shape invalid'; END IF;
  IF NEW.state IN ('FAILED','INSUFFICIENT_CONTEXT') AND NEW.failure_code IS NULL THEN RAISE EXCEPTION 'terminal failure code required'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_generation_context_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; item_row RECORD; source_row RECORD; latest_lifecycle TEXT; latest_review TEXT; latest_permission TEXT; permission_until TIMESTAMPTZ;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id = NEW.generation_run_id FOR SHARE;
  SELECT ki.source_version_id, ki.organization_id, ki.visibility, ki.locator, ki.text_hash INTO item_row FROM knowledge_items ki WHERE ki.id = NEW.knowledge_item_id FOR SHARE;
  SELECT sv.source_id, sv.content_hash, ks.organization_id, ks.visibility INTO source_row FROM source_versions sv JOIN knowledge_sources ks ON ks.id = sv.source_id WHERE sv.id = NEW.source_version_id FOR SHARE;
  SELECT to_status INTO latest_lifecycle FROM source_lifecycle_events WHERE source_version_id = NEW.source_version_id ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT decision INTO latest_review FROM pedagogical_reviews WHERE source_version_id = NEW.source_version_id ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT decision, valid_until INTO latest_permission, permission_until FROM usage_permissions WHERE source_version_id = NEW.source_version_id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF run_row.id IS NULL OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.locator IS DISTINCT FROM NEW.locator OR item_row.text_hash IS DISTINCT FROM NEW.text_hash OR source_row.source_id IS NULL OR latest_lifecycle <> 'ACTIVE' OR latest_review <> 'APPROVED' OR latest_permission <> 'ALLOWED' OR (permission_until IS NOT NULL AND permission_until <= NOW()) THEN RAISE EXCEPTION 'generation context identity or eligibility invalid'; END IF;
  IF jsonb_array_length(NEW.lineage) < 1 THEN RAISE EXCEPTION 'generation context lineage required'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.lineage) lineage WHERE NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l WHERE l.knowledge_item_id = NEW.knowledge_item_id AND l.curriculum_version_id = (lineage->>'curriculumVersionId')::uuid AND l.curriculum_node_id = (lineage->>'curriculumNodeId')::uuid)) THEN RAISE EXCEPTION 'generation context lineage is forged'; END IF;
  IF item_row.visibility = 'ORGANIZATION_PRIVATE' AND item_row.organization_id IS DISTINCT FROM run_row.organization_id THEN RAISE EXCEPTION 'generation context tenant invalid'; END IF;
  IF source_row.visibility = 'ORGANIZATION_PRIVATE' AND source_row.organization_id IS DISTINCT FROM run_row.organization_id THEN RAISE EXCEPTION 'generation context source owner invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l JOIN curriculum_versions cv ON cv.id = l.curriculum_version_id WHERE l.knowledge_item_id = NEW.knowledge_item_id AND l.curriculum_version_id = NEW.curriculum_version_id AND l.curriculum_node_id = NEW.curriculum_node_id AND cv.status = 'PUBLISHED') THEN RAISE EXCEPTION 'generation context curriculum lineage invalid'; END IF;
  IF NEW.curriculum_version_id IS DISTINCT FROM run_row.curriculum_version_id THEN RAISE EXCEPTION 'generation context curriculum version invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_question_source_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; question_row RECORD; prior_row RECORD; item_row RECORD;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id = NEW.generation_run_id FOR SHARE;
  SELECT aq.id, ar.assessment_id, ar.id AS revision_id INTO question_row FROM assessment_questions aq JOIN assessment_sections s ON s.id = aq.section_id JOIN assessment_revisions ar ON ar.id = s.revision_id WHERE aq.id = NEW.assessment_question_id FOR SHARE;
  SELECT ki.source_version_id, ki.locator, ki.text_hash, ki.organization_id, ki.visibility INTO item_row FROM knowledge_items ki WHERE ki.id = NEW.knowledge_item_id FOR SHARE;
  IF run_row.id IS NULL OR question_row.id IS NULL OR question_row.assessment_id IS DISTINCT FROM run_row.assessment_id OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.locator IS DISTINCT FROM NEW.locator OR item_row.text_hash IS DISTINCT FROM NEW.text_hash THEN RAISE EXCEPTION 'question source identity invalid'; END IF;
  IF item_row.visibility = 'ORGANIZATION_PRIVATE' AND item_row.organization_id IS DISTINCT FROM run_row.organization_id THEN RAISE EXCEPTION 'question source tenant invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM generation_context_items c WHERE c.generation_run_id = NEW.generation_run_id AND c.knowledge_item_id = NEW.knowledge_item_id) THEN RAISE EXCEPTION 'question source item was not selected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l JOIN curriculum_versions cv ON cv.id = l.curriculum_version_id WHERE l.knowledge_item_id = NEW.knowledge_item_id AND l.curriculum_version_id = NEW.curriculum_version_id AND l.curriculum_node_id = NEW.curriculum_node_id AND cv.status = 'PUBLISHED') THEN RAISE EXCEPTION 'question source curriculum lineage invalid'; END IF;
  IF NEW.lineage = 'GENERATED' AND run_row.operation = 'REGENERATE_QUESTION' AND NEW.prior_question_id IS NULL THEN RAISE EXCEPTION 'generated source link requires prior question'; END IF;
  IF NEW.lineage = 'GENERATED' AND run_row.operation = 'DRAFT' AND NEW.prior_question_id IS NOT NULL THEN RAISE EXCEPTION 'draft generated source link cannot carry prior question'; END IF;
  IF NEW.lineage = 'CARRIED_FORWARD' AND NEW.prior_question_id IS NULL THEN RAISE EXCEPTION 'carried source link requires prior question'; END IF;
  IF NEW.prior_question_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assessment_questions pq JOIN assessment_sections ps ON ps.id = pq.section_id JOIN assessment_revisions pr ON pr.id = ps.revision_id WHERE pq.id = NEW.prior_question_id AND pr.assessment_id = run_row.assessment_id) THEN RAISE EXCEPTION 'prior question lineage invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_generation_usage_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.input_tokens < 0 OR NEW.output_tokens < 0 OR NEW.total_tokens < 0 OR NEW.cost_micros < 0 OR NEW.total_tokens <> NEW.input_tokens + NEW.output_tokens THEN RAISE EXCEPTION 'generation usage values invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM generation_runs r WHERE r.id = NEW.generation_run_id AND NEW.attempt <= r.attempts) THEN RAISE EXCEPTION 'generation usage attempt invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generation_run_guard ON generation_runs;
CREATE TRIGGER generation_run_guard BEFORE INSERT OR UPDATE OR DELETE ON generation_runs FOR EACH ROW EXECUTE FUNCTION phase40_generation_run_guard();
DROP TRIGGER IF EXISTS generation_context_identity ON generation_context_items;
CREATE TRIGGER generation_context_identity BEFORE INSERT ON generation_context_items FOR EACH ROW EXECUTE FUNCTION phase40_generation_context_identity();
DROP TRIGGER IF EXISTS question_source_identity ON question_source_links;
CREATE TRIGGER question_source_identity BEFORE INSERT ON question_source_links FOR EACH ROW EXECUTE FUNCTION phase40_question_source_identity();
DROP TRIGGER IF EXISTS generation_usage_guard ON generation_usages;
CREATE TRIGGER generation_usage_guard BEFORE INSERT OR UPDATE ON generation_usages FOR EACH ROW EXECUTE FUNCTION phase40_generation_usage_guard();
