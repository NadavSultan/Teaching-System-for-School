-- Phase 40 final graph correction. 04400 remains immutable.
CREATE OR REPLACE FUNCTION phase40_validate_complete_output_graph(run_id UUID) RETURNS void AS $$
DECLARE r RECORD; output_question_count INTEGER; link_count INTEGER; base_question_count INTEGER;
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
  IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id GROUP BY l.assessment_question_id, l.knowledge_item_id, l.curriculum_version_id, l.curriculum_node_id, l.lineage, l.prior_question_id HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'duplicate source citation'; END IF;
  IF r.operation='DRAFT' THEN
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND (l.lineage <> 'GENERATED' OR l.prior_question_id IS NOT NULL)) THEN RAISE EXCEPTION 'draft source graph contains carried lineage'; END IF;
  ELSE
    SELECT count(*) INTO base_question_count FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.base_revision_id;
    IF output_question_count <> base_question_count THEN RAISE EXCEPTION 'regeneration changed question cardinality'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id
      AND NOT EXISTS (SELECT 1 FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id AND os.key=bs.key AND os."order"=bs."order" AND oq.key=bq.key AND oq."order"=bq."order"))
      OR EXISTS (SELECT 1 FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id WHERE os.revision_id=r.output_revision_id
      AND NOT EXISTS (SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id WHERE bs.revision_id=r.base_revision_id AND os.key=bs.key AND os."order"=bs."order" AND oq.key=bq.key AND oq."order"=bq."order"))
      THEN RAISE EXCEPTION 'regeneration output slot graph invalid'; END IF;
    IF NOT EXISTS (SELECT 1 FROM question_source_links l JOIN assessment_questions oq ON oq.id=l.assessment_question_id JOIN assessment_sections os ON os.id=oq.section_id
      WHERE l.generation_run_id=r.id AND l.lineage='GENERATED' AND l.prior_question_id=r.target_question_id
      AND os.key=(SELECT ts.key FROM assessment_questions tq JOIN assessment_sections ts ON ts.id=tq.section_id WHERE tq.id=r.target_question_id)
      AND os."order"=(SELECT ts."order" FROM assessment_questions tq JOIN assessment_sections ts ON ts.id=tq.section_id WHERE tq.id=r.target_question_id)
      AND oq.key=(SELECT tq.key FROM assessment_questions tq WHERE tq.id=r.target_question_id)
      AND oq."order"=(SELECT tq."order" FROM assessment_questions tq WHERE tq.id=r.target_question_id))
      THEN RAISE EXCEPTION 'regeneration target has no exact replacement link'; END IF;
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
