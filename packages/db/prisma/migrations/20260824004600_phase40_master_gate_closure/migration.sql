-- Phase 40 final remediation. 04000-04500 are immutable history.

CREATE TABLE generation_expected_question_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_run_id UUID NOT NULL REFERENCES generation_runs(id) ON DELETE RESTRICT,
  assessment_question_id UUID NOT NULL REFERENCES assessment_questions(id) ON DELETE RESTRICT,
  knowledge_item_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  source_version_id UUID NOT NULL REFERENCES source_versions(id) ON DELETE RESTRICT,
  locator VARCHAR(500) NOT NULL,
  text_hash CHAR(64) NOT NULL,
  curriculum_version_id UUID NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  curriculum_node_id UUID NOT NULL REFERENCES curriculum_nodes(id) ON DELETE RESTRICT,
  lineage "GenerationLineage" NOT NULL,
  prior_question_id UUID REFERENCES assessment_questions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT generation_expected_question_citations_unique
    UNIQUE (generation_run_id, assessment_question_id, knowledge_item_id)
);

CREATE INDEX generation_expected_question_citations_run_idx
  ON generation_expected_question_citations (generation_run_id, assessment_question_id);

CREATE OR REPLACE FUNCTION phase40_expected_citation_append_only() RETURNS trigger AS $$
DECLARE run_row RECORD; question_row RECORD; context_ok BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO run_row FROM generation_runs WHERE id = NEW.generation_run_id FOR SHARE;
    IF run_row.id IS NULL OR run_row.state <> 'PROCESSING' THEN
      RAISE EXCEPTION 'generation expected citation set is closed';
    END IF;
    SELECT q.id, ar.id AS revision_id, ar.assessment_id, ar.idempotency_key
      INTO question_row
      FROM assessment_questions q
      JOIN assessment_sections s ON s.id = q.section_id
      JOIN assessment_revisions ar ON ar.id = s.revision_id
      WHERE q.id = NEW.assessment_question_id;
    IF question_row.id IS NULL
       OR question_row.assessment_id <> run_row.assessment_id
       OR question_row.idempotency_key <> 'generation:' || run_row.id
       OR question_row.revision_id IS NULL THEN
      RAISE EXCEPTION 'generation expected citation output identity is invalid';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM generation_context_items c
      WHERE c.generation_run_id = NEW.generation_run_id
        AND c.knowledge_item_id = NEW.knowledge_item_id
        AND c.source_version_id = NEW.source_version_id
        AND c.locator = NEW.locator
        AND c.text_hash = NEW.text_hash
        AND c.curriculum_version_id = NEW.curriculum_version_id
        AND c.curriculum_node_id = NEW.curriculum_node_id
    ) INTO context_ok;
    IF NOT context_ok THEN
      RAISE EXCEPTION 'generation expected citation context identity is invalid';
    END IF;
    IF run_row.operation = 'DRAFT' AND (NEW.lineage <> 'GENERATED' OR NEW.prior_question_id IS NOT NULL) THEN
      RAISE EXCEPTION 'generation expected citation lineage is invalid';
    END IF;
    IF run_row.operation = 'REGENERATE_QUESTION' AND (
      (NEW.lineage = 'GENERATED' AND NEW.prior_question_id IS DISTINCT FROM run_row.target_question_id)
      OR (NEW.lineage = 'CARRIED_FORWARD' AND NEW.prior_question_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'generation expected citation lineage is invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'generation expected citation is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generation_expected_question_citations_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON generation_expected_question_citations
  FOR EACH ROW EXECUTE FUNCTION phase40_expected_citation_append_only();

ALTER TABLE generation_expected_question_citations DISABLE TRIGGER generation_expected_question_citations_append_only;
SET LOCAL session_replication_role = replica;

INSERT INTO generation_expected_question_citations (
  generation_run_id, assessment_question_id, knowledge_item_id, source_version_id,
  locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id
)
SELECT l.generation_run_id, l.assessment_question_id, l.knowledge_item_id, l.source_version_id,
       l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id,
       l.lineage, l.prior_question_id
FROM question_source_links l
JOIN generation_runs r ON r.id = l.generation_run_id
WHERE r.state = 'SUCCEEDED';

ALTER TABLE generation_expected_question_citations ENABLE TRIGGER generation_expected_question_citations_append_only;
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION phase40_validate_complete_output_graph(run_id UUID) RETURNS void AS $$
DECLARE r RECORD; output_question_count INTEGER; link_count INTEGER; base_question_count INTEGER;
  target_section_key TEXT; target_section_order INTEGER; target_question_key TEXT; target_question_order INTEGER;
BEGIN
  SELECT * INTO r FROM generation_runs WHERE id = run_id;
  IF r.id IS NULL OR r.state <> 'SUCCEEDED' THEN RETURN; END IF;
  IF r.output_revision_id IS NULL THEN RAISE EXCEPTION 'successful generation requires output revision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM assessment_revisions ar JOIN assessments a ON a.id=ar.assessment_id
    WHERE ar.id=r.output_revision_id AND ar.assessment_id=r.assessment_id AND a.organization_id=r.organization_id
      AND ar.state='FINALIZED' AND ar.idempotency_key='generation:' || r.id)
    THEN RAISE EXCEPTION 'successful generation output identity invalid'; END IF;
  SELECT count(*) INTO output_question_count FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.output_revision_id;
  SELECT count(*) INTO link_count FROM question_source_links l WHERE l.generation_run_id=r.id;
  IF output_question_count=0 OR link_count < output_question_count THEN RAISE EXCEPTION 'successful generation requires complete source graph'; END IF;
  IF EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.output_revision_id
    AND NOT EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.assessment_question_id=q.id))
    THEN RAISE EXCEPTION 'output question has no source link'; END IF;
  IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id
    AND NOT EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.output_revision_id AND q.id=l.assessment_question_id))
    THEN RAISE EXCEPTION 'source link points outside output revision'; END IF;
  IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id GROUP BY l.assessment_question_id, l.knowledge_item_id, l.source_version_id, l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, l.lineage, l.prior_question_id HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'duplicate source citation'; END IF;
  IF EXISTS (
    (SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM question_source_links WHERE generation_run_id=r.id
     EXCEPT
     SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM generation_expected_question_citations WHERE generation_run_id=r.id)
    UNION ALL
    (SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM generation_expected_question_citations WHERE generation_run_id=r.id
     EXCEPT
     SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash, curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM question_source_links WHERE generation_run_id=r.id)
  ) THEN RAISE EXCEPTION 'generation expected citation set mismatch'; END IF;
  IF r.operation='DRAFT' THEN
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND (l.lineage <> 'GENERATED' OR l.prior_question_id IS NOT NULL)) THEN RAISE EXCEPTION 'draft source graph contains carried lineage'; END IF;
  ELSE
    SELECT count(*) INTO base_question_count FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.base_revision_id;
    IF output_question_count <> base_question_count THEN RAISE EXCEPTION 'regeneration changed question cardinality'; END IF;
    SELECT s.key, s."order", q.key, q."order"
      INTO target_section_key, target_section_order, target_question_key, target_question_order
      FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id
      WHERE q.id=r.target_question_id AND s.revision_id=r.base_revision_id;
    IF target_question_key IS NULL THEN RAISE EXCEPTION 'regeneration target identity invalid'; END IF;
    IF EXISTS (
      (SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=r.base_revision_id
       EXCEPT SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=r.output_revision_id)
      UNION ALL
      (SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=r.output_revision_id
       EXCEPT SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=r.base_revision_id)
    ) THEN RAISE EXCEPTION 'regeneration section graph mismatch'; END IF;
    IF EXISTS (
      (SELECT bs.key, bs."order", bq.key, bq."order", bq.type FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id
       EXCEPT SELECT os.key, os."order", oq.key, oq."order", oq.type FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id)
      UNION ALL
      (SELECT os.key, os."order", oq.key, oq."order", oq.type FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id
       EXCEPT SELECT bs.key, bs."order", bq.key, bq."order", bq.type FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id)
    ) THEN RAISE EXCEPTION 'regeneration question slot graph invalid'; END IF;
    IF EXISTS (
      (SELECT bs.key, bs."order", bq.key, bq."order", bq.prompt, bq.instructions, bq.difficulty, bq.score_units FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT os.key, os."order", oq.key, oq."order", oq.prompt, oq.instructions, oq.difficulty, oq.score_units FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
      UNION ALL
      (SELECT os.key, os."order", oq.key, oq."order", oq.prompt, oq.instructions, oq.difficulty, oq.score_units FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT bs.key, bs."order", bq.key, bq."order", bq.prompt, bq.instructions, bq.difficulty, bq.score_units FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
    ) THEN RAISE EXCEPTION 'regeneration unrelated question graph mismatch'; END IF;
    IF EXISTS (
      (SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", sq.prompt, sq.score_units FROM assessment_sub_questions sq JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", sq.prompt, sq.score_units FROM assessment_sub_questions sq JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
      UNION ALL
      (SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", sq.prompt, sq.score_units FROM assessment_sub_questions sq JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", sq.prompt, sq.score_units FROM assessment_sub_questions sq JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
    ) THEN RAISE EXCEPTION 'regeneration sub-question graph mismatch'; END IF;
    IF EXISTS (
      (SELECT bs.key, bs."order", bq.key, bq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_questions bq ON bq.id=a.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT os.key, os."order", oq.key, oq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_questions oq ON oq.id=a.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
      UNION ALL
      (SELECT os.key, os."order", oq.key, oq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_questions oq ON oq.id=a.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT bs.key, bs."order", bq.key, bq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_questions bq ON bq.id=a.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
    ) THEN RAISE EXCEPTION 'regeneration answer graph mismatch'; END IF;
    IF EXISTS (
      (SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
      UNION ALL
      (SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
    ) THEN RAISE EXCEPTION 'regeneration answer graph mismatch'; END IF;
    IF EXISTS (
      (SELECT bs.key, bs."order", bq.key, bq."order", rc.key, rc."order", rc.description, rc.score_units FROM rubric_criteria rc JOIN assessment_questions bq ON bq.id=rc.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT os.key, os."order", oq.key, oq."order", rc.key, rc."order", rc.description, rc.score_units FROM rubric_criteria rc JOIN assessment_questions oq ON oq.id=rc.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
      UNION ALL
      (SELECT os.key, os."order", oq.key, oq."order", rc.key, rc."order", rc.description, rc.score_units FROM rubric_criteria rc JOIN assessment_questions oq ON oq.id=rc.question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT bs.key, bs."order", bq.key, bq."order", rc.key, rc."order", rc.description, rc.score_units FROM rubric_criteria rc JOIN assessment_questions bq ON bq.id=rc.question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
    ) THEN RAISE EXCEPTION 'regeneration rubric graph mismatch'; END IF;
    IF EXISTS (
      (SELECT DISTINCT bs.key, bs."order", bq.key, bq."order", l.knowledge_item_id, l.source_version_id, l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, 'CARRIED_FORWARD'::"GenerationLineage" FROM question_source_links l JOIN assessment_questions bq ON bq.id=l.assessment_question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT DISTINCT os.key, os."order", oq.key, oq."order", l.knowledge_item_id, l.source_version_id, l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, l.lineage FROM question_source_links l JOIN assessment_questions oq ON oq.id=l.assessment_question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE l.generation_run_id=r.id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
      UNION ALL
      (SELECT DISTINCT os.key, os."order", oq.key, oq."order", l.knowledge_item_id, l.source_version_id, l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, l.lineage FROM question_source_links l JOIN assessment_questions oq ON oq.id=l.assessment_question_id JOIN assessment_sections os ON os.id=oq.section_id WHERE l.generation_run_id=r.id AND (os.key, os."order", oq.key, oq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order)
       EXCEPT SELECT DISTINCT bs.key, bs."order", bq.key, bq."order", l.knowledge_item_id, l.source_version_id, l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, 'CARRIED_FORWARD'::"GenerationLineage" FROM question_source_links l JOIN assessment_questions bq ON bq.id=l.assessment_question_id JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND (bs.key, bs."order", bq.key, bq."order") <> (target_section_key, target_section_order, target_question_key, target_question_order))
    ) THEN RAISE EXCEPTION 'regeneration unrelated source graph mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='GENERATED' AND l.prior_question_id IS DISTINCT FROM r.target_question_id) THEN RAISE EXCEPTION 'regeneration generated link targets wrong prior question'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND bq.id IS DISTINCT FROM r.target_question_id
      AND NOT EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='CARRIED_FORWARD' AND l.prior_question_id=bq.id)) THEN RAISE EXCEPTION 'regeneration missing carried-forward provenance'; END IF;
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='CARRIED_FORWARD' AND NOT EXISTS (SELECT 1 FROM question_source_links prior WHERE prior.assessment_question_id=l.prior_question_id AND prior.generation_run_id IS NOT NULL AND prior.knowledge_item_id=l.knowledge_item_id AND prior.source_version_id=l.source_version_id AND prior.locator=l.locator AND prior.text_hash=l.text_hash AND prior.curriculum_version_id=l.curriculum_version_id AND prior.curriculum_node_id=l.curriculum_node_id)) THEN RAISE EXCEPTION 'carried-forward source set mismatch'; END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM generation_runs WHERE state='SUCCEEDED' LOOP PERFORM phase40_validate_complete_output_graph(r.id); END LOOP;
END $$;

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
