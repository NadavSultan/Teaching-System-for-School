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
