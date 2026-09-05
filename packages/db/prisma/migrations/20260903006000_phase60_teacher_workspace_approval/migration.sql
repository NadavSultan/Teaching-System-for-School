-- Phase 60 teacher workspace foundation. Forward-only; Phase 10-50 migrations remain immutable.
ALTER TABLE "assessment_questions" ADD COLUMN "logical_id" UUID;
UPDATE "assessment_questions" SET "logical_id" = "id" WHERE "logical_id" IS NULL;
ALTER TABLE "assessment_questions" ALTER COLUMN "logical_id" SET NOT NULL;
ALTER TABLE "assessment_questions" ALTER COLUMN "logical_id" SET DEFAULT gen_random_uuid();

ALTER TABLE "assessment_revisions" ADD COLUMN "base_revision_id" UUID REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT;
CREATE INDEX "assessment_revisions_lineage_idx" ON "assessment_revisions" ("assessment_id", "base_revision_id", "revision_number");
CREATE INDEX "assessment_questions_logical_identity_idx" ON "assessment_questions" ("logical_id", "section_id");

CREATE TABLE "assessment_approvals" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "assessment_id" UUID NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT,
  "assessment_revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,
  "validation_run_id" UUID NOT NULL REFERENCES "validation_runs"("id") ON DELETE RESTRICT,
  "approving_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approval_sequence" INTEGER NOT NULL CHECK ("approval_sequence" > 0),
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "contract_version" VARCHAR(40) NOT NULL,
  "validation_ruleset_version" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("assessment_revision_id"),
  UNIQUE ("assessment_id", "approval_sequence"),
  UNIQUE ("organization_id", "approving_user_id", "idempotency_key")
);
CREATE INDEX "assessment_approvals_list_idx" ON "assessment_approvals" ("organization_id", "assessment_id", "created_at" DESC, "id" DESC);
CREATE INDEX "assessment_approvals_latest_idx" ON "assessment_approvals" ("assessment_id", "approval_sequence" DESC, "id" DESC);

CREATE OR REPLACE FUNCTION phase60_raise(code text, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '%', message USING ERRCODE = code; END; $$;

CREATE OR REPLACE FUNCTION phase60_question_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_assessment UUID;
BEGIN
  SELECT r.assessment_id INTO v_assessment FROM assessment_sections s JOIN assessment_revisions r ON r.id=s.revision_id WHERE s.id=NEW.section_id;
  IF v_assessment IS NULL THEN PERFORM phase60_raise('P6001','phase60 question section is invalid'); END IF;
  IF EXISTS (
    SELECT 1 FROM assessment_questions q
    JOIN assessment_sections s ON s.id=q.section_id
    JOIN assessment_revisions r ON r.id=s.revision_id
    WHERE q.logical_id=NEW.logical_id AND r.assessment_id<>v_assessment AND q.id<>COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN PERFORM phase60_raise('P6002','phase60 logical question identity cannot cross assessments'); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase60_question_identity_guard BEFORE INSERT OR UPDATE OF section_id, logical_id ON "assessment_questions" FOR EACH ROW EXECUTE FUNCTION phase60_question_guard();

CREATE OR REPLACE FUNCTION phase60_revision_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.assessment_id::text, 60));
  IF TG_OP='UPDATE' AND OLD.assessment_id IS DISTINCT FROM NEW.assessment_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.assessment_id::text, 60));
    PERFORM phase60_raise('P6004','phase60 revision assessment identity is immutable');
  END IF;
  IF NEW.base_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assessment_revisions b WHERE b.id=NEW.base_revision_id AND b.assessment_id=NEW.assessment_id AND b.state='FINALIZED'
  ) THEN PERFORM phase60_raise('P6003','phase60 base revision must be finalized and owned by the same assessment'); END IF;
  IF TG_OP='UPDATE' AND OLD.base_revision_id IS DISTINCT FROM NEW.base_revision_id THEN
    PERFORM phase60_raise('P6004','phase60 revision lineage is immutable');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase60_revision_lineage_guard BEFORE INSERT OR UPDATE OF base_revision_id, assessment_id ON "assessment_revisions" FOR EACH ROW EXECUTE FUNCTION phase60_revision_lineage_guard();

CREATE OR REPLACE FUNCTION phase60_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_run UUID; v_existing assessment_approvals%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.assessment_id::text, 60));
  IF NOT EXISTS (SELECT 1 FROM assessments a WHERE a.id=NEW.assessment_id AND a.organization_id=NEW.organization_id) THEN
    PERFORM phase60_raise('P6010','phase60 approval assessment owner does not match organization');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM assessment_revisions r WHERE r.id=NEW.assessment_revision_id AND r.assessment_id=NEW.assessment_id AND r.state='FINALIZED') THEN
    PERFORM phase60_raise('P6011','phase60 approval revision is not a finalized revision of assessment');
  END IF;
  IF NEW.assessment_revision_id IS DISTINCT FROM (SELECT r.id FROM assessment_revisions r WHERE r.assessment_id=NEW.assessment_id ORDER BY r.revision_number DESC, r.id DESC LIMIT 1) THEN
    PERFORM phase60_raise('P6012','phase60 approval requires the latest revision');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id
    JOIN organizations o ON o.id=m.organization_id
    WHERE u.id=NEW.approving_user_id AND u.status='ACTIVE' AND u.platform_admin=FALSE
      AND m.organization_id=NEW.organization_id AND m.status='ACTIVE' AND o.status='ACTIVE'
      AND m.role IN ('TEACHER','COORDINATOR','SCHOOL_ADMIN')
  ) THEN PERFORM phase60_raise('P6013','phase60 approval requires an active non-platform teacher authority'); END IF;
  SELECT assert_revision_approvable(NEW.organization_id, NEW.assessment_revision_id) INTO v_run;
  IF NEW.validation_run_id IS DISTINCT FROM v_run THEN PERFORM phase60_raise('P6014','phase60 approval validation identity is not approvable'); END IF;
  IF NEW.contract_version<>'1.0.0' OR NEW.validation_ruleset_version<>'v1' THEN PERFORM phase60_raise('P6015','phase60 approval contract or validation version is invalid'); END IF;
  SELECT * INTO v_existing FROM assessment_approvals a WHERE a.organization_id=NEW.organization_id AND a.approving_user_id=NEW.approving_user_id AND a.idempotency_key=NEW.idempotency_key;
  IF FOUND AND (v_existing.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint OR v_existing.assessment_id IS DISTINCT FROM NEW.assessment_id OR v_existing.assessment_revision_id IS DISTINCT FROM NEW.assessment_revision_id) THEN
    PERFORM phase60_raise('P6016','phase60 approval idempotency key conflicts with prior request');
  END IF;
  IF NEW.approval_sequence IS DISTINCT FROM COALESCE((SELECT max(a.approval_sequence)+1 FROM assessment_approvals a WHERE a.assessment_id=NEW.assessment_id),1) THEN
    PERFORM phase60_raise('P6017','phase60 approval sequence is invalid');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase60_approval_guard BEFORE INSERT ON "assessment_approvals" FOR EACH ROW EXECUTE FUNCTION phase60_approval_guard();

CREATE OR REPLACE FUNCTION phase60_reject_approval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM phase60_raise('P6018','phase60 approvals are append-only'); RETURN NULL; END; $$;
CREATE TRIGGER phase60_approvals_immutable BEFORE UPDATE OR DELETE ON "assessment_approvals" FOR EACH ROW EXECUTE FUNCTION phase60_reject_approval_mutation();

-- Editor revisions preserve source evidence by an explicit immutable copy edge. Generated
-- links continue to use, and be checked by, the frozen Phase 40 generation-run boundary.
ALTER TABLE "question_source_links" ALTER COLUMN "generation_run_id" DROP NOT NULL;
ALTER TABLE "question_source_links" ADD COLUMN "copied_from_question_source_link_id" UUID REFERENCES "question_source_links"("id") ON DELETE RESTRICT;
ALTER TABLE "question_source_links" ADD CONSTRAINT "question_source_links_origin_ck"
  CHECK (("generation_run_id" IS NOT NULL) <> ("copied_from_question_source_link_id" IS NOT NULL));
CREATE UNIQUE INDEX "question_source_links_editor_copy_key"
  ON "question_source_links" ("assessment_question_id", "copied_from_question_source_link_id")
  WHERE "copied_from_question_source_link_id" IS NOT NULL;

DROP TRIGGER IF EXISTS question_source_identity ON question_source_links;
CREATE TRIGGER question_source_identity BEFORE INSERT ON question_source_links
  FOR EACH ROW WHEN (NEW.generation_run_id IS NOT NULL) EXECUTE FUNCTION phase40_question_source_identity();
DROP TRIGGER IF EXISTS question_source_commit_guard ON question_source_links;
CREATE CONSTRAINT TRIGGER question_source_commit_guard AFTER INSERT ON question_source_links
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.generation_run_id IS NOT NULL)
  EXECUTE FUNCTION phase40_question_source_commit_guard();
DROP TRIGGER IF EXISTS question_source_complete_output_graph ON question_source_links;
CREATE CONSTRAINT TRIGGER question_source_complete_output_graph AFTER INSERT ON question_source_links
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.generation_run_id IS NOT NULL)
  EXECUTE FUNCTION phase40_complete_output_link_guard();

CREATE OR REPLACE FUNCTION phase60_editor_source_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row RECORD; target_row RECORD;
BEGIN
  SELECT l.*, q.logical_id, r.id AS revision_id, r.assessment_id
    INTO source_row
    FROM question_source_links l
    JOIN assessment_questions q ON q.id=l.assessment_question_id
    JOIN assessment_sections s ON s.id=q.section_id
    JOIN assessment_revisions r ON r.id=s.revision_id
    WHERE l.id=NEW.copied_from_question_source_link_id;
  SELECT q.logical_id, r.id AS revision_id, r.assessment_id, r.base_revision_id, r.state
    INTO target_row
    FROM assessment_questions q
    JOIN assessment_sections s ON s.id=q.section_id
    JOIN assessment_revisions r ON r.id=s.revision_id
    WHERE q.id=NEW.assessment_question_id;
  IF NEW.generation_run_id IS NOT NULL OR source_row.id IS NULL OR target_row.revision_id IS NULL
     OR target_row.state <> 'BUILDING' OR target_row.base_revision_id IS DISTINCT FROM source_row.revision_id
     OR target_row.assessment_id IS DISTINCT FROM source_row.assessment_id
     OR target_row.logical_id IS DISTINCT FROM source_row.logical_id
     OR NEW.knowledge_item_id IS DISTINCT FROM source_row.knowledge_item_id
     OR NEW.source_version_id IS DISTINCT FROM source_row.source_version_id
     OR NEW.locator IS DISTINCT FROM source_row.locator
     OR NEW.text_hash IS DISTINCT FROM source_row.text_hash
     OR NEW.curriculum_version_id IS DISTINCT FROM source_row.curriculum_version_id
     OR NEW.curriculum_node_id IS DISTINCT FROM source_row.curriculum_node_id
     OR NEW.lineage IS DISTINCT FROM source_row.lineage
     OR NEW.prior_question_id IS DISTINCT FROM source_row.prior_question_id THEN
    PERFORM phase60_raise('P6005','phase60 editor source link copy is invalid');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase60_editor_source_link_guard BEFORE INSERT ON question_source_links
  FOR EACH ROW WHEN (NEW.copied_from_question_source_link_id IS NOT NULL)
  EXECUTE FUNCTION phase60_editor_source_link_guard();

-- A queued regeneration may be rebased only across an uninterrupted chain of
-- finalized generation revisions. Resolve its target by the stable logical
-- identity introduced above, while retaining the immutable run request.
CREATE OR REPLACE FUNCTION phase60_regeneration_effective_target(
  p_run_id UUID,
  p_output_revision_id UUID
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  run_row RECORD;
  output_row RECORD;
  effective_base_row RECORD;
  original_logical_id UUID;
  effective_target_id UUID;
  effective_target_count INTEGER;
  lineage_count INTEGER;
  lineage_valid BOOLEAN;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id=p_run_id;
  IF run_row.id IS NULL OR run_row.operation<>'REGENERATE_QUESTION'
     OR run_row.base_revision_id IS NULL OR run_row.target_question_id IS NULL THEN
    PERFORM phase60_raise('P6006','phase60 regeneration request identity is invalid');
  END IF;

  SELECT * INTO output_row FROM assessment_revisions WHERE id=p_output_revision_id;
  IF output_row.id IS NULL OR output_row.assessment_id IS DISTINCT FROM run_row.assessment_id
     OR output_row.base_revision_id IS NULL THEN
    PERFORM phase60_raise('P6006','phase60 regeneration output lineage is invalid');
  END IF;
  SELECT * INTO effective_base_row FROM assessment_revisions WHERE id=output_row.base_revision_id;
  IF effective_base_row.id IS NULL
     OR effective_base_row.assessment_id IS DISTINCT FROM run_row.assessment_id
     OR effective_base_row.state<>'FINALIZED' THEN
    PERFORM phase60_raise('P6006','phase60 regeneration effective base is invalid');
  END IF;

  SELECT q.logical_id INTO original_logical_id
    FROM assessment_questions q
    JOIN assessment_sections s ON s.id=q.section_id
    WHERE q.id=run_row.target_question_id AND s.revision_id=run_row.base_revision_id;
  IF original_logical_id IS NULL THEN
    PERFORM phase60_raise('P6006','phase60 regeneration original target identity is invalid');
  END IF;

  WITH RECURSIVE lineage AS (
    SELECT r.id, r.base_revision_id, r.assessment_id, r.revision_number, r.state, r.idempotency_key
      FROM assessment_revisions r WHERE r.id=effective_base_row.id
    UNION ALL
    SELECT p.id, p.base_revision_id, p.assessment_id, p.revision_number, p.state, p.idempotency_key
      FROM lineage c
      JOIN assessment_revisions p ON p.id=c.base_revision_id
      WHERE c.id<>run_row.base_revision_id
  )
  SELECT count(*),
         bool_and(assessment_id=run_row.assessment_id AND state='FINALIZED')
         AND bool_and(id=run_row.base_revision_id OR idempotency_key LIKE 'generation:%')
    INTO lineage_count, lineage_valid
    FROM lineage;
  IF effective_base_row.revision_number < (SELECT revision_number FROM assessment_revisions WHERE id=run_row.base_revision_id)
     OR lineage_count <> effective_base_row.revision_number - (SELECT revision_number FROM assessment_revisions WHERE id=run_row.base_revision_id) + 1
     OR NOT COALESCE(lineage_valid,FALSE)
     OR NOT EXISTS (
       WITH RECURSIVE lineage AS (
         SELECT r.id, r.base_revision_id FROM assessment_revisions r WHERE r.id=effective_base_row.id
         UNION ALL
         SELECT p.id, p.base_revision_id FROM lineage c JOIN assessment_revisions p ON p.id=c.base_revision_id
           WHERE c.id<>run_row.base_revision_id
       ) SELECT 1 FROM lineage WHERE id=run_row.base_revision_id
     ) THEN
    PERFORM phase60_raise('P6006','phase60 regeneration rebase is not a generation-only lineage');
  END IF;

  SELECT count(*), (array_agg(q.id))[1]
    INTO effective_target_count, effective_target_id
    FROM assessment_questions q
    JOIN assessment_sections s ON s.id=q.section_id
    WHERE s.revision_id=effective_base_row.id AND q.logical_id=original_logical_id;
  IF effective_target_count<>1 THEN
    PERFORM phase60_raise('P6006','phase60 regeneration effective target identity is ambiguous or missing');
  END IF;
  RETURN effective_target_id;
END; $$;

CREATE OR REPLACE FUNCTION phase40_question_source_identity() RETURNS trigger AS $$
DECLARE
  run_row RECORD;
  question_row RECORD;
  item_row RECORD;
  effective_target_id UUID;
  effective_base_id UUID;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id=NEW.generation_run_id FOR SHARE;
  SELECT aq.id, aq.logical_id, ar.assessment_id, ar.id AS revision_id, ar.base_revision_id
    INTO question_row
    FROM assessment_questions aq
    JOIN assessment_sections s ON s.id=aq.section_id
    JOIN assessment_revisions ar ON ar.id=s.revision_id
    WHERE aq.id=NEW.assessment_question_id FOR SHARE;
  IF run_row.id IS NULL OR question_row.id IS NULL OR question_row.assessment_id IS DISTINCT FROM run_row.assessment_id THEN
    RAISE EXCEPTION 'question source assessment identity invalid';
  END IF;
  SELECT ki.source_version_id, ki.locator, ki.text_hash, ki.organization_id, ki.visibility
    INTO item_row FROM knowledge_items ki WHERE ki.id=NEW.knowledge_item_id FOR SHARE;
  IF item_row.source_version_id IS DISTINCT FROM NEW.source_version_id
     OR item_row.locator IS DISTINCT FROM NEW.locator
     OR item_row.text_hash IS DISTINCT FROM NEW.text_hash THEN
    RAISE EXCEPTION 'question source identity invalid';
  END IF;
  IF run_row.operation='REGENERATE_QUESTION' THEN
    effective_target_id := phase60_regeneration_effective_target(run_row.id, question_row.revision_id);
    effective_base_id := question_row.base_revision_id;
    IF run_row.output_revision_id IS NOT NULL AND question_row.revision_id IS DISTINCT FROM run_row.output_revision_id THEN
      RAISE EXCEPTION 'question source output revision invalid';
    END IF;
  END IF;
  IF NEW.curriculum_version_id IS DISTINCT FROM run_row.curriculum_version_id OR NOT EXISTS (
    SELECT 1 FROM generation_context_items c
    WHERE c.generation_run_id=NEW.generation_run_id AND c.knowledge_item_id=NEW.knowledge_item_id
      AND c.curriculum_version_id=NEW.curriculum_version_id AND c.curriculum_node_id=NEW.curriculum_node_id
  ) THEN RAISE EXCEPTION 'question source context lineage invalid'; END IF;
  IF NEW.lineage='GENERATED' AND run_row.operation='DRAFT' AND NEW.prior_question_id IS NOT NULL THEN
    RAISE EXCEPTION 'draft generated link prior invalid';
  END IF;
  IF NEW.lineage='GENERATED' AND run_row.operation='REGENERATE_QUESTION'
     AND NEW.prior_question_id IS DISTINCT FROM effective_target_id THEN
    RAISE EXCEPTION 'regenerated link prior invalid';
  END IF;
  IF NEW.lineage='CARRIED_FORWARD' AND NEW.prior_question_id IS NULL THEN
    RAISE EXCEPTION 'carried link prior question required';
  END IF;
  IF NEW.prior_question_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assessment_questions q
    JOIN assessment_sections s ON s.id=q.section_id
    WHERE q.id=NEW.prior_question_id
      AND s.revision_id=CASE WHEN run_row.operation='REGENERATE_QUESTION' THEN effective_base_id ELSE run_row.base_revision_id END
      AND q.logical_id=question_row.logical_id
      AND q.id IS DISTINCT FROM NEW.assessment_question_id
  ) THEN RAISE EXCEPTION 'prior question lineage invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_expected_citation_append_only() RETURNS trigger AS $$
DECLARE
  run_row RECORD;
  question_row RECORD;
  context_ok BOOLEAN;
  effective_target_id UUID;
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
    IF question_row.id IS NULL OR question_row.assessment_id <> run_row.assessment_id
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
    IF NOT context_ok THEN RAISE EXCEPTION 'generation expected citation context identity is invalid'; END IF;
    IF run_row.operation = 'DRAFT' AND (NEW.lineage <> 'GENERATED' OR NEW.prior_question_id IS NOT NULL) THEN
      RAISE EXCEPTION 'generation expected citation lineage is invalid';
    END IF;
    IF run_row.operation = 'REGENERATE_QUESTION' THEN
      effective_target_id := phase60_regeneration_effective_target(run_row.id, question_row.revision_id);
      IF (NEW.lineage = 'GENERATED' AND NEW.prior_question_id IS DISTINCT FROM effective_target_id)
         OR (NEW.lineage = 'CARRIED_FORWARD' AND NEW.prior_question_id IS NULL) THEN
        RAISE EXCEPTION 'generation expected citation lineage is invalid';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'generation expected citation is append-only'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_question_source_commit_guard() RETURNS trigger AS $$
DECLARE
  r RECORD;
  q_revision UUID;
  q_logical_id UUID;
  prior_revision UUID;
  prior_logical_id UUID;
  effective_base_id UUID;
  effective_target_id UUID;
BEGIN
  SELECT * INTO r FROM generation_runs WHERE id=NEW.generation_run_id;
  SELECT ar.id, ar.base_revision_id, aq.logical_id
    INTO q_revision, effective_base_id, q_logical_id
    FROM assessment_questions aq
    JOIN assessment_sections s ON s.id=aq.section_id
    JOIN assessment_revisions ar ON ar.id=s.revision_id
    WHERE aq.id=NEW.assessment_question_id;
  IF r.id IS NULL OR r.state<>'SUCCEEDED' OR r.output_revision_id IS NULL
     OR q_revision IS DISTINCT FROM r.output_revision_id
     OR NOT EXISTS (
       SELECT 1 FROM assessment_revisions ar JOIN assessments a ON a.id=ar.assessment_id
       WHERE ar.id=r.output_revision_id AND ar.assessment_id=r.assessment_id
         AND a.organization_id=r.organization_id AND ar.state='FINALIZED'
         AND ar.idempotency_key='generation:' || r.id
     )
     OR NOT EXISTS (
       SELECT 1 FROM generation_context_items c
       WHERE c.generation_run_id=r.id AND c.knowledge_item_id=NEW.knowledge_item_id
         AND c.lineage @> jsonb_build_array(jsonb_build_object(
           'curriculumVersionId',NEW.curriculum_version_id,
           'curriculumNodeId',NEW.curriculum_node_id
         ))
     )
     OR NEW.curriculum_version_id IS DISTINCT FROM r.curriculum_version_id THEN
    RAISE EXCEPTION 'deferred question source final identity invalid';
  END IF;
  IF NEW.lineage='GENERATED' AND NEW.prior_question_id IS NOT NULL AND r.operation='DRAFT' THEN
    RAISE EXCEPTION 'draft generated prior invalid';
  END IF;
  IF r.operation='REGENERATE_QUESTION' THEN
    effective_target_id := phase60_regeneration_effective_target(r.id,r.output_revision_id);
  END IF;
  IF NEW.lineage='GENERATED' AND r.operation='REGENERATE_QUESTION'
     AND NEW.prior_question_id IS DISTINCT FROM effective_target_id THEN
    RAISE EXCEPTION 'regeneration prior invalid';
  END IF;
  IF NEW.lineage='CARRIED_FORWARD' THEN
    IF NEW.prior_question_id IS NULL OR r.operation<>'REGENERATE_QUESTION' THEN
      RAISE EXCEPTION 'carried forward prior invalid';
    END IF;
    SELECT ar.id, aq.logical_id INTO prior_revision, prior_logical_id
      FROM assessment_questions aq
      JOIN assessment_sections s ON s.id=aq.section_id
      JOIN assessment_revisions ar ON ar.id=s.revision_id
      WHERE aq.id=NEW.prior_question_id;
    IF prior_revision IS DISTINCT FROM effective_base_id
       OR NEW.prior_question_id=effective_target_id
       OR q_logical_id IS DISTINCT FROM prior_logical_id THEN
      RAISE EXCEPTION 'carried forward mapping invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase40_validate_complete_output_graph(run_id UUID) RETURNS void AS $$
DECLARE
  r RECORD;
  output_question_count INTEGER;
  link_count INTEGER;
  base_question_count INTEGER;
  effective_base_revision_id UUID;
  effective_target_question_id UUID;
  target_section_key TEXT;
  target_section_order INTEGER;
  target_question_key TEXT;
  target_question_order INTEGER;
BEGIN
  SELECT * INTO r FROM generation_runs WHERE id=run_id;
  IF r.id IS NULL OR r.state<>'SUCCEEDED' THEN RETURN; END IF;
  IF r.output_revision_id IS NULL THEN RAISE EXCEPTION 'successful generation requires output revision'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM assessment_revisions ar JOIN assessments a ON a.id=ar.assessment_id
    WHERE ar.id=r.output_revision_id AND ar.assessment_id=r.assessment_id
      AND a.organization_id=r.organization_id AND ar.state='FINALIZED'
      AND ar.idempotency_key='generation:' || r.id
  ) THEN RAISE EXCEPTION 'successful generation output identity invalid'; END IF;

  SELECT count(*) INTO output_question_count
    FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id
    WHERE s.revision_id=r.output_revision_id;
  SELECT count(*) INTO link_count FROM question_source_links l WHERE l.generation_run_id=r.id;
  IF output_question_count=0 OR link_count<output_question_count THEN
    RAISE EXCEPTION 'successful generation requires complete source graph';
  END IF;
  IF EXISTS (
    SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id
    WHERE s.revision_id=r.output_revision_id AND NOT EXISTS (
      SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.assessment_question_id=q.id
    )
  ) THEN RAISE EXCEPTION 'output question has no source link'; END IF;
  IF EXISTS (
    SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND NOT EXISTS (
      SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id
      WHERE s.revision_id=r.output_revision_id AND q.id=l.assessment_question_id
    )
  ) THEN RAISE EXCEPTION 'source link points outside output revision'; END IF;
  IF EXISTS (
    SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id
    GROUP BY l.assessment_question_id, l.knowledge_item_id, l.source_version_id, l.locator,
      l.text_hash, l.curriculum_version_id, l.curriculum_node_id, l.lineage, l.prior_question_id
    HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'duplicate source citation'; END IF;
  IF EXISTS (
    (SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash,
            curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM question_source_links WHERE generation_run_id=r.id
     EXCEPT
     SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash,
            curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM generation_expected_question_citations WHERE generation_run_id=r.id)
    UNION ALL
    (SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash,
            curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM generation_expected_question_citations WHERE generation_run_id=r.id
     EXCEPT
     SELECT assessment_question_id, knowledge_item_id, source_version_id, locator, text_hash,
            curriculum_version_id, curriculum_node_id, lineage, prior_question_id
       FROM question_source_links WHERE generation_run_id=r.id)
  ) THEN RAISE EXCEPTION 'generation expected citation set mismatch'; END IF;

  IF r.operation='DRAFT' THEN
    IF EXISTS (
      SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id
      AND (l.lineage<>'GENERATED' OR l.prior_question_id IS NOT NULL)
    ) THEN RAISE EXCEPTION 'draft source graph contains carried lineage'; END IF;
    RETURN;
  END IF;

  SELECT ar.base_revision_id INTO effective_base_revision_id
    FROM assessment_revisions ar WHERE ar.id=r.output_revision_id;
  effective_target_question_id := phase60_regeneration_effective_target(r.id, r.output_revision_id);
  SELECT count(*) INTO base_question_count
    FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id
    WHERE s.revision_id=effective_base_revision_id;
  IF output_question_count<>base_question_count THEN RAISE EXCEPTION 'regeneration changed question cardinality'; END IF;
  SELECT s.key, s."order", q.key, q."order"
    INTO target_section_key, target_section_order, target_question_key, target_question_order
    FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id
    WHERE q.id=effective_target_question_id AND s.revision_id=effective_base_revision_id;
  IF target_question_key IS NULL THEN RAISE EXCEPTION 'regeneration target identity invalid'; END IF;

  IF EXISTS (
    (SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=effective_base_revision_id
     EXCEPT SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=r.output_revision_id)
    UNION ALL
    (SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=r.output_revision_id
     EXCEPT SELECT key, "order", title, instructions, score_units FROM assessment_sections WHERE revision_id=effective_base_revision_id)
  ) THEN RAISE EXCEPTION 'regeneration section graph mismatch'; END IF;
  IF EXISTS (
    (SELECT bs.key, bs."order", bq.key, bq."order", bq.type
       FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
     EXCEPT
     SELECT os.key, os."order", oq.key, oq."order", oq.type
       FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id)
    UNION ALL
    (SELECT os.key, os."order", oq.key, oq."order", oq.type
       FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
     EXCEPT
     SELECT bs.key, bs."order", bq.key, bq."order", bq.type
       FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id)
  ) THEN RAISE EXCEPTION 'regeneration question slot graph invalid'; END IF;

  IF EXISTS (
    (SELECT bs.key, bs."order", bq.key, bq."order", bq.prompt, bq.instructions, bq.difficulty, bq.score_units
       FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT os.key, os."order", oq.key, oq."order", oq.prompt, oq.instructions, oq.difficulty, oq.score_units
       FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
    UNION ALL
    (SELECT os.key, os."order", oq.key, oq."order", oq.prompt, oq.instructions, oq.difficulty, oq.score_units
       FROM assessment_questions oq JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT bs.key, bs."order", bq.key, bq."order", bq.prompt, bq.instructions, bq.difficulty, bq.score_units
       FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
  ) THEN RAISE EXCEPTION 'regeneration unrelated question graph mismatch'; END IF;

  IF EXISTS (
    (SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", sq.prompt, sq.score_units
       FROM assessment_sub_questions sq JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", sq.prompt, sq.score_units
       FROM assessment_sub_questions sq JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
    UNION ALL
    (SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", sq.prompt, sq.score_units
       FROM assessment_sub_questions sq JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", sq.prompt, sq.score_units
       FROM assessment_sub_questions sq JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
  ) THEN RAISE EXCEPTION 'regeneration sub-question graph mismatch'; END IF;

  IF EXISTS (
    (SELECT bs.key, bs."order", bq.key, bq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_questions bq ON bq.id=a.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT os.key, os."order", oq.key, oq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_questions oq ON oq.id=a.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
    UNION ALL
    (SELECT os.key, os."order", oq.key, oq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_questions oq ON oq.id=a.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT bs.key, bs."order", bq.key, bq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_questions bq ON bq.id=a.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
  ) THEN RAISE EXCEPTION 'regeneration answer graph mismatch'; END IF;

  IF EXISTS (
    (SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
    UNION ALL
    (SELECT os.key, os."order", oq.key, oq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions oq ON oq.id=sq.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT bs.key, bs."order", bq.key, bq."order", sq.key, sq."order", a.key, a."order", a.text, a.explanation, a.answer_data
       FROM answers a JOIN assessment_sub_questions sq ON sq.id=a.sub_question_id JOIN assessment_questions bq ON bq.id=sq.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
  ) THEN RAISE EXCEPTION 'regeneration answer graph mismatch'; END IF;

  IF EXISTS (
    (SELECT bs.key, bs."order", bq.key, bq."order", rc.key, rc."order", rc.description, rc.score_units
       FROM rubric_criteria rc JOIN assessment_questions bq ON bq.id=rc.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT os.key, os."order", oq.key, oq."order", rc.key, rc."order", rc.description, rc.score_units
       FROM rubric_criteria rc JOIN assessment_questions oq ON oq.id=rc.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
    UNION ALL
    (SELECT os.key, os."order", oq.key, oq."order", rc.key, rc."order", rc.description, rc.score_units
       FROM rubric_criteria rc JOIN assessment_questions oq ON oq.id=rc.question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE os.revision_id=r.output_revision_id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT bs.key, bs."order", bq.key, bq."order", rc.key, rc."order", rc.description, rc.score_units
       FROM rubric_criteria rc JOIN assessment_questions bq ON bq.id=rc.question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
  ) THEN RAISE EXCEPTION 'regeneration rubric graph mismatch'; END IF;

  IF EXISTS (
    (SELECT DISTINCT bs.key, bs."order", bq.key, bq."order", l.knowledge_item_id, l.source_version_id,
            l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, 'CARRIED_FORWARD'::"GenerationLineage"
       FROM question_source_links l JOIN assessment_questions bq ON bq.id=l.assessment_question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT DISTINCT os.key, os."order", oq.key, oq."order", l.knowledge_item_id, l.source_version_id,
            l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, l.lineage
       FROM question_source_links l JOIN assessment_questions oq ON oq.id=l.assessment_question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE l.generation_run_id=r.id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
    UNION ALL
    (SELECT DISTINCT os.key, os."order", oq.key, oq."order", l.knowledge_item_id, l.source_version_id,
            l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, l.lineage
       FROM question_source_links l JOIN assessment_questions oq ON oq.id=l.assessment_question_id JOIN assessment_sections os ON os.id=oq.section_id
       WHERE l.generation_run_id=r.id
         AND (os.key,os."order",oq.key,oq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order)
     EXCEPT
     SELECT DISTINCT bs.key, bs."order", bq.key, bq."order", l.knowledge_item_id, l.source_version_id,
            l.locator, l.text_hash, l.curriculum_version_id, l.curriculum_node_id, 'CARRIED_FORWARD'::"GenerationLineage"
       FROM question_source_links l JOIN assessment_questions bq ON bq.id=l.assessment_question_id JOIN assessment_sections bs ON bs.id=bq.section_id
       WHERE bs.revision_id=effective_base_revision_id
         AND (bs.key,bs."order",bq.key,bq."order")<>(target_section_key,target_section_order,target_question_key,target_question_order))
  ) THEN RAISE EXCEPTION 'regeneration unrelated source graph mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id
      AND l.lineage='GENERATED' AND l.prior_question_id IS DISTINCT FROM effective_target_question_id
  ) THEN RAISE EXCEPTION 'regeneration generated link targets wrong prior question'; END IF;
  IF EXISTS (
    SELECT 1 FROM assessment_questions bq JOIN assessment_sections bs ON bs.id=bq.section_id
    WHERE bs.revision_id=effective_base_revision_id AND bq.id IS DISTINCT FROM effective_target_question_id
      AND NOT EXISTS (
        SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id
          AND l.lineage='CARRIED_FORWARD' AND l.prior_question_id=bq.id
      )
  ) THEN RAISE EXCEPTION 'regeneration missing carried-forward provenance'; END IF;
  IF EXISTS (
    SELECT 1 FROM question_source_links l WHERE l.generation_run_id=r.id AND l.lineage='CARRIED_FORWARD'
      AND NOT EXISTS (
        SELECT 1 FROM question_source_links prior
        WHERE prior.assessment_question_id=l.prior_question_id AND prior.generation_run_id IS NOT NULL
          AND prior.knowledge_item_id=l.knowledge_item_id AND prior.source_version_id=l.source_version_id
          AND prior.locator=l.locator AND prior.text_hash=l.text_hash
          AND prior.curriculum_version_id=l.curriculum_version_id
          AND prior.curriculum_node_id=l.curriculum_node_id
      )
  ) THEN RAISE EXCEPTION 'carried-forward source set mismatch'; END IF;
END;
$$ LANGUAGE plpgsql;
