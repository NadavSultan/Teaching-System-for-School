-- Phase 40 complete-output graph closure. 04000-04300 are immutable history.

CREATE OR REPLACE FUNCTION phase40_validate_complete_output_graph(run_id UUID) RETURNS void AS $$
DECLARE r RECORD; output_question_count INTEGER; base_question_count INTEGER; link_count INTEGER;
BEGIN
  SELECT * INTO r FROM generation_runs WHERE id = run_id;
  IF r.id IS NULL OR r.state <> 'SUCCEEDED' THEN RETURN; END IF;
  IF r.output_revision_id IS NULL THEN RAISE EXCEPTION 'successful generation requires output revision'; END IF;
  SELECT count(*) INTO output_question_count FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.output_revision_id;
  SELECT count(*) INTO link_count FROM question_source_links l WHERE l.generation_run_id=r.id;
  IF output_question_count=0 OR link_count=0 OR link_count <> output_question_count THEN RAISE EXCEPTION 'successful generation requires complete source graph'; END IF;
  IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id GROUP BY l.assessment_question_id HAVING count(*) <> 1) THEN RAISE EXCEPTION 'each output question requires exactly one source link'; END IF;
  IF NOT EXISTS (SELECT 1 FROM assessment_revisions ar JOIN assessments a ON a.id=ar.assessment_id WHERE ar.id=r.output_revision_id AND ar.assessment_id=r.assessment_id AND a.organization_id=r.organization_id AND ar.state='FINALIZED' AND ar.idempotency_key='generation:' || r.id) THEN RAISE EXCEPTION 'successful generation output identity invalid'; END IF;
  IF EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.output_revision_id AND NOT EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.assessment_question_id=q.id)) THEN RAISE EXCEPTION 'output question has no source link'; END IF;
  IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND NOT EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.output_revision_id AND q.id=l.assessment_question_id)) THEN RAISE EXCEPTION 'source link points outside output revision'; END IF;
  IF r.operation='DRAFT' THEN
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND (l.lineage <> 'GENERATED' OR l.prior_question_id IS NOT NULL)) THEN RAISE EXCEPTION 'draft source graph contains carried lineage'; END IF;
  ELSE
    SELECT count(*) INTO base_question_count FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id WHERE s.revision_id=r.base_revision_id;
    IF output_question_count <> base_question_count THEN RAISE EXCEPTION 'regeneration changed question cardinality'; END IF;
    IF EXISTS (
      SELECT 1 FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
      WHERE os.revision_id=r.output_revision_id AND NOT EXISTS (
        SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
        WHERE bs.revision_id=r.base_revision_id AND bs.key=os.key AND bs."order"=os."order" AND bq.key=oq.key AND bq."order"=oq."order"
      )
    ) THEN RAISE EXCEPTION 'regeneration output has extra question slot'; END IF;
    IF EXISTS (
      SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
      WHERE bs.revision_id=r.base_revision_id AND NOT EXISTS (
        SELECT 1 FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
        WHERE os.revision_id=r.output_revision_id AND os.key=bs.key AND os."order"=bs."order" AND oq.key=bq.key AND oq."order"=bq."order"
      )
    ) THEN RAISE EXCEPTION 'regeneration output is missing base question slot'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM question_source_links l JOIN assessment_questions oq ON oq.id=l.assessment_question_id JOIN assessment_sections os ON os.id=oq.section_id
      WHERE l.generation_run_id=r.id AND l.lineage='GENERATED' AND l.prior_question_id=r.target_question_id
        AND os.key=(SELECT ts.key FROM assessment_questions tq JOIN assessment_sections ts ON ts.id=tq.section_id WHERE tq.id=r.target_question_id)
        AND os."order"=(SELECT ts."order" FROM assessment_questions tq JOIN assessment_sections ts ON ts.id=tq.section_id WHERE tq.id=r.target_question_id)
        AND oq.key=(SELECT tq.key FROM assessment_questions tq WHERE tq.id=r.target_question_id)
        AND oq."order"=(SELECT tq."order" FROM assessment_questions tq WHERE tq.id=r.target_question_id)
    ) THEN RAISE EXCEPTION 'regeneration target has no exact replacement link'; END IF;
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='GENERATED' AND l.prior_question_id IS DISTINCT FROM r.target_question_id) THEN RAISE EXCEPTION 'regeneration generated link targets wrong prior question'; END IF;
    IF EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='CARRIED_FORWARD' AND (l.prior_question_id IS NULL OR l.prior_question_id=r.target_question_id)) THEN RAISE EXCEPTION 'regeneration carried link prior mapping invalid'; END IF;
    IF EXISTS (
      SELECT 1 FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
      WHERE os.revision_id=r.output_revision_id
        AND NOT EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.assessment_question_id=oq.id AND l.lineage='CARRIED_FORWARD')
        AND NOT EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.assessment_question_id=oq.id AND l.lineage='GENERATED' AND l.prior_question_id=r.target_question_id)
    ) THEN RAISE EXCEPTION 'regeneration non-target question is not carried forward'; END IF;
    IF EXISTS (
      SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
      WHERE bs.revision_id=r.base_revision_id AND bq.id IS DISTINCT FROM r.target_question_id
        AND NOT EXISTS (SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='CARRIED_FORWARD' AND l.prior_question_id=bq.id)
    ) THEN RAISE EXCEPTION 'regeneration missing carried-forward question provenance'; END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_complete_output_run_guard() RETURNS trigger AS $$
BEGIN
  PERFORM phase40_validate_complete_output_graph(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION phase40_complete_output_link_guard() RETURNS trigger AS $$
BEGIN
  PERFORM phase40_validate_complete_output_graph(NEW.generation_run_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generation_complete_output_graph ON generation_runs;
CREATE CONSTRAINT TRIGGER generation_complete_output_graph AFTER INSERT OR UPDATE OF state, output_revision_id ON generation_runs
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase40_complete_output_run_guard();
DROP TRIGGER IF EXISTS question_source_complete_output_graph ON question_source_links;
CREATE CONSTRAINT TRIGGER question_source_complete_output_graph AFTER INSERT ON question_source_links
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase40_complete_output_link_guard();

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM generation_runs WHERE state='SUCCEEDED' LOOP
    PERFORM phase40_validate_complete_output_graph(r.id);
  END LOOP;
END $$;
