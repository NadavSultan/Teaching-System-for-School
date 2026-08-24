-- Phase 40 acceptance closure. 04000-04200 are immutable migration history.

-- Repair all legacy context rows to the complete, requested published lineage.
DROP TRIGGER IF EXISTS generation_context_append_only ON generation_context_items;
UPDATE generation_context_items c
SET lineage = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'curriculumVersionId', l.curriculum_version_id,
    'curriculumNodeId', l.curriculum_node_id
  ) ORDER BY l.curriculum_version_id, l.curriculum_node_id)
  FROM knowledge_item_curriculum_node_links l
  JOIN curriculum_versions cv ON cv.id = l.curriculum_version_id
  JOIN generation_runs r ON r.id = c.generation_run_id
  WHERE l.knowledge_item_id = c.knowledge_item_id
    AND l.curriculum_version_id = r.curriculum_version_id
    AND cv.status = 'PUBLISHED'
    AND l.curriculum_node_id = ANY(ARRAY(
      SELECT value::uuid FROM jsonb_array_elements_text(r.frozen_specification->'curriculumNodeIds')
    ))
), c.lineage);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM generation_context_items c
    WHERE jsonb_typeof(c.lineage) <> 'array' OR jsonb_array_length(c.lineage) = 0
  ) THEN RAISE EXCEPTION 'phase40 complete lineage backfill incomplete'; END IF;
END $$;

ALTER TABLE generation_context_items DROP CONSTRAINT IF EXISTS generation_context_items_lineage_ck;
ALTER TABLE generation_context_items ADD CONSTRAINT generation_context_items_lineage_ck
  CHECK (jsonb_typeof(lineage) = 'array' AND jsonb_array_length(lineage) > 0);

CREATE OR REPLACE FUNCTION phase40_generation_context_complete_lineage() RETURNS trigger AS $$
DECLARE r RECORD; expected JSONB; primary_pair JSONB;
BEGIN
  SELECT * INTO r FROM generation_runs WHERE id = NEW.generation_run_id FOR SHARE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'curriculumVersionId', l.curriculum_version_id,
    'curriculumNodeId', l.curriculum_node_id
  ) ORDER BY l.curriculum_version_id, l.curriculum_node_id), '[]'::jsonb)
  INTO expected
  FROM knowledge_item_curriculum_node_links l
  JOIN curriculum_versions cv ON cv.id = l.curriculum_version_id
  WHERE l.knowledge_item_id = NEW.knowledge_item_id
    AND l.curriculum_version_id = r.curriculum_version_id
    AND cv.status = 'PUBLISHED'
    AND l.curriculum_node_id = ANY(ARRAY(
      SELECT value::uuid FROM jsonb_array_elements_text(r.frozen_specification->'curriculumNodeIds')
    ));
  primary_pair := jsonb_build_object('curriculumVersionId', NEW.curriculum_version_id, 'curriculumNodeId', NEW.curriculum_node_id);
  IF r.id IS NULL OR NEW.curriculum_version_id IS DISTINCT FROM r.curriculum_version_id
     OR NEW.lineage <> expected OR NOT (NEW.lineage @> jsonb_build_array(primary_pair))
     OR jsonb_array_length(NEW.lineage) <> (SELECT count(DISTINCT (x->>'curriculumVersionId') || ':' || (x->>'curriculumNodeId')) FROM jsonb_array_elements(NEW.lineage) x)
     OR expected = '[]'::jsonb THEN
    RAISE EXCEPTION 'generation context complete lineage invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS generation_context_complete_lineage ON generation_context_items;
CREATE TRIGGER generation_context_complete_lineage BEFORE INSERT ON generation_context_items
FOR EACH ROW EXECUTE FUNCTION phase40_generation_context_complete_lineage();
CREATE TRIGGER generation_context_append_only
BEFORE UPDATE OR DELETE ON generation_context_items FOR EACH ROW EXECUTE FUNCTION phase40_generation_append_only();

CREATE OR REPLACE FUNCTION phase40_question_source_commit_guard() RETURNS trigger AS $$
DECLARE r RECORD; q_revision UUID; q_key TEXT; q_section_key TEXT; prior_revision UUID; prior_key TEXT; prior_section_key TEXT;
BEGIN
  SELECT * INTO r FROM generation_runs WHERE id = NEW.generation_run_id;
  SELECT ar.id, aq.key, s.key INTO q_revision, q_key, q_section_key
  FROM assessment_questions aq JOIN assessment_sections s ON s.id = aq.section_id
  JOIN assessment_revisions ar ON ar.id = s.revision_id WHERE aq.id = NEW.assessment_question_id;
  IF r.id IS NULL OR r.state <> 'SUCCEEDED' OR r.output_revision_id IS NULL
     OR q_revision IS DISTINCT FROM r.output_revision_id
     OR NOT EXISTS (SELECT 1 FROM assessment_revisions ar JOIN assessments a ON a.id = ar.assessment_id WHERE ar.id = r.output_revision_id AND ar.assessment_id = r.assessment_id AND a.organization_id = r.organization_id AND ar.state = 'FINALIZED' AND ar.idempotency_key = 'generation:' || r.id)
     OR NOT EXISTS (SELECT 1 FROM generation_context_items c WHERE c.generation_run_id = r.id AND c.knowledge_item_id = NEW.knowledge_item_id AND c.lineage @> jsonb_build_array(jsonb_build_object('curriculumVersionId', NEW.curriculum_version_id, 'curriculumNodeId', NEW.curriculum_node_id)))
     OR NEW.curriculum_version_id IS DISTINCT FROM r.curriculum_version_id THEN
    RAISE EXCEPTION 'deferred question source final identity invalid';
  END IF;
  IF NEW.lineage = 'GENERATED' AND NEW.prior_question_id IS NOT NULL AND r.operation = 'DRAFT' THEN RAISE EXCEPTION 'draft generated prior invalid'; END IF;
  IF NEW.lineage = 'GENERATED' AND r.operation = 'REGENERATE_QUESTION' AND NEW.prior_question_id IS DISTINCT FROM r.target_question_id THEN RAISE EXCEPTION 'regeneration prior invalid'; END IF;
  IF NEW.lineage = 'CARRIED_FORWARD' THEN
    IF NEW.prior_question_id IS NULL OR r.operation <> 'REGENERATE_QUESTION' THEN RAISE EXCEPTION 'carried forward prior invalid'; END IF;
    SELECT ar.id, aq.key, s.key INTO prior_revision, prior_key, prior_section_key
    FROM assessment_questions aq JOIN assessment_sections s ON s.id = aq.section_id JOIN assessment_revisions ar ON ar.id = s.revision_id
    WHERE aq.id = NEW.prior_question_id;
    IF prior_revision IS DISTINCT FROM r.base_revision_id OR NEW.prior_question_id = r.target_question_id OR q_key IS DISTINCT FROM prior_key OR q_section_key IS DISTINCT FROM prior_section_key THEN RAISE EXCEPTION 'carried forward mapping invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS question_source_commit_guard ON question_source_links;
CREATE CONSTRAINT TRIGGER question_source_commit_guard AFTER INSERT ON question_source_links
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase40_question_source_commit_guard();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM question_source_links q JOIN generation_runs r ON r.id = q.generation_run_id
    WHERE r.state <> 'SUCCEEDED' OR r.output_revision_id IS NULL
  ) THEN RAISE EXCEPTION 'existing question source links have no terminal output'; END IF;
END $$;
