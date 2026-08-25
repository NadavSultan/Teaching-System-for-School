-- Phase 40 final remediation. 04000-04500 are immutable history.

CREATE OR REPLACE FUNCTION phase40_generation_context_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; item_row RECORD; source_row RECORD; latest_lifecycle TEXT; latest_review TEXT; latest_permission TEXT; permission_until TIMESTAMPTZ;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id=NEW.generation_run_id FOR SHARE;
  SELECT ki.source_version_id, ki.organization_id, ki.visibility, ki.locator, ki.text_hash INTO item_row FROM knowledge_items ki WHERE ki.id=NEW.knowledge_item_id FOR SHARE;
  SELECT sv.source_id, ks.organization_id, ks.visibility INTO source_row FROM source_versions sv JOIN knowledge_sources ks ON ks.id=sv.source_id WHERE sv.id=NEW.source_version_id FOR SHARE;
  SELECT to_status INTO latest_lifecycle FROM source_lifecycle_events WHERE source_version_id=NEW.source_version_id ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT decision INTO latest_review FROM pedagogical_reviews WHERE source_version_id=NEW.source_version_id ORDER BY created_at DESC, CASE decision WHEN 'REJECTED' THEN 1 ELSE 0 END DESC, id DESC LIMIT 1;
  SELECT decision, valid_until INTO latest_permission, permission_until FROM usage_permissions WHERE source_version_id=NEW.source_version_id ORDER BY created_at DESC, CASE decision WHEN 'DENIED' THEN 1 ELSE 0 END DESC, id DESC LIMIT 1;
  IF run_row.id IS NULL OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.locator IS DISTINCT FROM NEW.locator OR item_row.text_hash IS DISTINCT FROM NEW.text_hash OR source_row.source_id IS NULL OR latest_lifecycle <> 'ACTIVE' OR latest_review <> 'APPROVED' OR latest_permission <> 'ALLOWED' OR (permission_until IS NOT NULL AND permission_until <= NOW()) THEN RAISE EXCEPTION 'generation context identity or eligibility invalid'; END IF;
  IF NEW.curriculum_version_id IS DISTINCT FROM run_row.curriculum_version_id OR NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l JOIN curriculum_versions v ON v.id=l.curriculum_version_id WHERE l.knowledge_item_id=NEW.knowledge_item_id AND l.curriculum_version_id=NEW.curriculum_version_id AND l.curriculum_node_id=NEW.curriculum_node_id AND v.status='PUBLISHED') THEN RAISE EXCEPTION 'generation context curriculum invalid'; END IF;
  IF jsonb_typeof(NEW.lineage) <> 'array' OR jsonb_array_length(NEW.lineage)=0 THEN RAISE EXCEPTION 'generation context lineage required'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.lineage) x WHERE NOT EXISTS (SELECT 1 FROM knowledge_item_curriculum_node_links l WHERE l.knowledge_item_id=NEW.knowledge_item_id AND l.curriculum_version_id=(x->>'curriculumVersionId')::uuid AND l.curriculum_node_id=(x->>'curriculumNodeId')::uuid)) THEN RAISE EXCEPTION 'generation context lineage forged'; END IF;
  IF item_row.visibility='ORGANIZATION_PRIVATE' AND item_row.organization_id IS DISTINCT FROM run_row.organization_id THEN RAISE EXCEPTION 'generation context tenant invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_question_source_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; question_row RECORD; item_row RECORD;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id=NEW.generation_run_id FOR SHARE;
  SELECT aq.id, ar.assessment_id, ar.id AS revision_id INTO question_row FROM assessment_questions aq JOIN assessment_sections s ON s.id=aq.section_id JOIN assessment_revisions ar ON ar.id=s.revision_id WHERE aq.id=NEW.assessment_question_id FOR SHARE;
  IF run_row.id IS NULL OR question_row.id IS NULL OR question_row.assessment_id IS DISTINCT FROM run_row.assessment_id THEN RAISE EXCEPTION 'question source assessment identity invalid'; END IF;
  SELECT ki.source_version_id, ki.locator, ki.text_hash, ki.organization_id, ki.visibility INTO item_row FROM knowledge_items ki WHERE ki.id=NEW.knowledge_item_id FOR SHARE;
  IF item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.locator IS DISTINCT FROM NEW.locator OR item_row.text_hash IS DISTINCT FROM NEW.text_hash THEN RAISE EXCEPTION 'question source identity invalid'; END IF;
  IF run_row.operation='REGENERATE_QUESTION' AND run_row.output_revision_id IS NOT NULL AND question_row.revision_id IS DISTINCT FROM run_row.output_revision_id THEN RAISE EXCEPTION 'question source output revision invalid'; END IF;
  IF NEW.curriculum_version_id IS DISTINCT FROM run_row.curriculum_version_id OR NOT EXISTS (SELECT 1 FROM generation_context_items c WHERE c.generation_run_id=NEW.generation_run_id AND c.knowledge_item_id=NEW.knowledge_item_id AND c.curriculum_version_id=NEW.curriculum_version_id AND c.curriculum_node_id=NEW.curriculum_node_id) THEN RAISE EXCEPTION 'question source context lineage invalid'; END IF;
  IF NEW.lineage='GENERATED' AND run_row.operation='DRAFT' AND NEW.prior_question_id IS NOT NULL THEN RAISE EXCEPTION 'draft generated link prior invalid'; END IF;
  IF NEW.lineage='GENERATED' AND run_row.operation='REGENERATE_QUESTION' AND NEW.prior_question_id IS DISTINCT FROM run_row.target_question_id THEN RAISE EXCEPTION 'regenerated link prior invalid'; END IF;
  IF NEW.lineage='CARRIED_FORWARD' AND NEW.prior_question_id IS NULL THEN RAISE EXCEPTION 'carried link prior question required'; END IF;
  IF NEW.prior_question_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id JOIN assessment_revisions r ON r.id=s.revision_id WHERE q.id=NEW.prior_question_id AND r.id=run_row.base_revision_id AND q.id IS DISTINCT FROM NEW.assessment_question_id) THEN RAISE EXCEPTION 'prior question lineage invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
