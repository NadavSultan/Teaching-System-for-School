CREATE TYPE "CurriculumLifecycle" AS ENUM ('ACTIVE','DEPRECATED');
CREATE TYPE "CurriculumVersionStatus" AS ENUM ('DRAFT','PUBLISHED','DEPRECATED');
CREATE TYPE "CurriculumNodeType" AS ENUM ('GRADE','DOMAIN','TOPIC','SUBTOPIC','SKILL');
CREATE TYPE "DifficultyBand" AS ENUM ('LOW','MEDIUM','HIGH');
CREATE TYPE "AssessmentType" AS ENUM ('WORKSHEET','TEST');
CREATE TYPE "ScoringMode" AS ENUM ('NONE','POINTS');
CREATE TABLE "curricula" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"code" VARCHAR(64) NOT NULL UNIQUE,"education_system_code" VARCHAR(64) NOT NULL,"subject_code" VARCHAR(64) NOT NULL,"display_name" VARCHAR(200) NOT NULL,"lifecycle" "CurriculumLifecycle" NOT NULL DEFAULT 'ACTIVE',"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "curriculum_versions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"curriculum_id" UUID NOT NULL REFERENCES "curricula"("id") ON DELETE RESTRICT,"version_number" INTEGER NOT NULL,"human_label" VARCHAR(200),"status" "CurriculumVersionStatus" NOT NULL DEFAULT 'DRAFT',"published_at" TIMESTAMPTZ,"deprecated_at" TIMESTAMPTZ,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("curriculum_id","version_number"));
CREATE TABLE "curriculum_nodes" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"version_id" UUID NOT NULL REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT,"parent_id" UUID REFERENCES "curriculum_nodes"("id") ON DELETE RESTRICT,"type" "CurriculumNodeType" NOT NULL,"code" VARCHAR(64) NOT NULL,"label" VARCHAR(200) NOT NULL,"description" VARCHAR(2000),"sort_order" INTEGER NOT NULL,UNIQUE("version_id","code"),UNIQUE("version_id","parent_id","sort_order"));
CREATE TABLE "curriculum_skill_difficulties" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"node_id" UUID NOT NULL REFERENCES "curriculum_nodes"("id") ON DELETE RESTRICT,"band" "DifficultyBand" NOT NULL,UNIQUE("node_id","band"));
CREATE TABLE "assessments" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,"type" "AssessmentType" NOT NULL,"title" VARCHAR(200) NOT NULL,"created_by_user_id" UUID,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "assessment_revisions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"assessment_id" UUID NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT,"revision_number" INTEGER NOT NULL,"idempotency_key" VARCHAR(255) NOT NULL,"curriculum_version_id" UUID NOT NULL REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT,"scoring_mode" "ScoringMode" NOT NULL,"total_score_units" INTEGER,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("assessment_id","revision_number"),UNIQUE("assessment_id","idempotency_key"));
CREATE TABLE "assessment_revision_node_links" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,"curriculum_node_id" UUID NOT NULL REFERENCES "curriculum_nodes"("id") ON DELETE RESTRICT,"role" VARCHAR(64),UNIQUE("revision_id","curriculum_node_id"));
CREATE TABLE "assessment_sections" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,"key" VARCHAR(100) NOT NULL,"title" VARCHAR(200) NOT NULL,"instructions" VARCHAR(5000),"order" INTEGER NOT NULL,"score_units" INTEGER,UNIQUE("revision_id","key"),UNIQUE("revision_id","order"));
CREATE TABLE "assessment_questions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"section_id" UUID NOT NULL REFERENCES "assessment_sections"("id") ON DELETE RESTRICT,"key" VARCHAR(100) NOT NULL,"type" VARCHAR(64) NOT NULL,"prompt" VARCHAR(20000) NOT NULL,"instructions" VARCHAR(5000),"order" INTEGER NOT NULL,"difficulty" "DifficultyBand","score_units" INTEGER,UNIQUE("section_id","key"),UNIQUE("section_id","order"));
CREATE TABLE "assessment_sub_questions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"question_id" UUID NOT NULL REFERENCES "assessment_questions"("id") ON DELETE RESTRICT,"key" VARCHAR(100) NOT NULL,"prompt" VARCHAR(10000) NOT NULL,"order" INTEGER NOT NULL,"score_units" INTEGER,UNIQUE("question_id","key"),UNIQUE("question_id","order"));
CREATE TABLE "answers" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"question_id" UUID REFERENCES "assessment_questions"("id") ON DELETE RESTRICT,"sub_question_id" UUID REFERENCES "assessment_sub_questions"("id") ON DELETE RESTRICT,"answer_data" JSONB NOT NULL,"explanation" VARCHAR(10000),CHECK ((question_id IS NOT NULL) <> (sub_question_id IS NOT NULL)));
CREATE TABLE "rubric_criteria" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"question_id" UUID REFERENCES "assessment_questions"("id") ON DELETE RESTRICT,"sub_question_id" UUID REFERENCES "assessment_sub_questions"("id") ON DELETE RESTRICT,"key" VARCHAR(100) NOT NULL,"description" VARCHAR(2000) NOT NULL,"order" INTEGER NOT NULL,"score_units" INTEGER,CHECK ((question_id IS NOT NULL) <> (sub_question_id IS NOT NULL)));
CREATE INDEX "assessments_organization_id_idx" ON "assessments"("organization_id");

CREATE TYPE "AssessmentRevisionState" AS ENUM ('BUILDING','FINALIZED');
ALTER TABLE "assessment_revisions" ADD COLUMN "request_fingerprint" CHAR(64) NOT NULL DEFAULT repeat('0',64);
ALTER TABLE "assessment_revisions" ADD COLUMN "state" "AssessmentRevisionState" NOT NULL DEFAULT 'BUILDING';
ALTER TABLE "assessment_revisions" ADD CONSTRAINT "assessment_revision_fingerprint_key" UNIQUE ("assessment_id", "idempotency_key", "request_fingerprint");
ALTER TABLE "answers" ADD COLUMN "key" VARCHAR(100) NOT NULL DEFAULT 'legacy';
ALTER TABLE "answers" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "answers" ADD COLUMN "text" VARCHAR(10000) NOT NULL DEFAULT '';
ALTER TABLE "assessment_sections" ADD CONSTRAINT "assessment_sections_score_range" CHECK ("score_units" IS NULL OR "score_units" BETWEEN 0 AND 1000000);
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_score_range" CHECK ("score_units" IS NULL OR "score_units" BETWEEN 0 AND 1000000);
ALTER TABLE "assessment_sub_questions" ADD CONSTRAINT "assessment_sub_questions_score_range" CHECK ("score_units" IS NULL OR "score_units" BETWEEN 0 AND 1000000);
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_score_range" CHECK ("score_units" IS NULL OR "score_units" BETWEEN 0 AND 1000000);
ALTER TABLE "assessment_revisions" ADD CONSTRAINT "assessment_revisions_score_range" CHECK ("total_score_units" IS NULL OR "total_score_units" BETWEEN 0 AND 1000000);

CREATE OR REPLACE FUNCTION phase20_reject_building_revision() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assessment_revisions WHERE id = NEW.id AND state = 'BUILDING') THEN RAISE EXCEPTION 'assessment revision cannot commit while BUILDING'; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "assessment_revision_must_finalize"
AFTER INSERT OR UPDATE OF state ON "assessment_revisions" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase20_reject_building_revision();

CREATE OR REPLACE FUNCTION phase20_revision_state_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.state <> 'BUILDING' THEN RAISE EXCEPTION 'assessment revisions must be created as BUILDING'; END IF;
  IF TG_OP='UPDATE' AND (OLD.state <> 'BUILDING' OR NEW.state <> 'FINALIZED') THEN RAISE EXCEPTION 'assessment revision state transition must be BUILDING to FINALIZED'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "assessment_revision_state_guard" BEFORE INSERT OR UPDATE OF state ON "assessment_revisions" FOR EACH ROW EXECUTE FUNCTION phase20_revision_state_guard();

CREATE OR REPLACE FUNCTION phase20_curriculum_node_guard() RETURNS trigger AS $$
DECLARE p curriculum_nodes%ROWTYPE; state "CurriculumVersionStatus"; old_state "CurriculumVersionStatus";
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT status INTO state FROM curriculum_versions WHERE id = OLD.version_id;
    IF state <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum content is immutable after publication'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    SELECT status INTO old_state FROM curriculum_versions WHERE id=OLD.version_id;
    IF old_state <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum content is immutable after publication'; END IF;
  END IF;
  SELECT status INTO state FROM curriculum_versions WHERE id = NEW.version_id;
  IF state <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum content is immutable after publication'; END IF;
  IF NEW.type = 'GRADE' AND NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'GRADE must be root'; END IF;
  IF NEW.type <> 'GRADE' AND NEW.parent_id IS NULL THEN RAISE EXCEPTION 'only GRADE may be root'; END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO p FROM curriculum_nodes WHERE id = NEW.parent_id;
    IF p.version_id <> NEW.version_id THEN RAISE EXCEPTION 'curriculum parent must use same version'; END IF;
    IF (NEW.type = 'DOMAIN' AND p.type <> 'GRADE') OR (NEW.type = 'TOPIC' AND p.type <> 'DOMAIN') OR (NEW.type = 'SUBTOPIC' AND p.type <> 'TOPIC') OR (NEW.type = 'SKILL' AND p.type <> 'SUBTOPIC') THEN RAISE EXCEPTION 'invalid curriculum parent type'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "curriculum_node_guard" BEFORE INSERT OR UPDATE OR DELETE ON "curriculum_nodes" FOR EACH ROW EXECUTE FUNCTION phase20_curriculum_node_guard();

CREATE OR REPLACE FUNCTION phase20_curriculum_difficulty_guard() RETURNS trigger AS $$
DECLARE node_type "CurriculumNodeType"; state "CurriculumVersionStatus"; old_state "CurriculumVersionStatus";
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT v.status INTO state FROM curriculum_nodes n JOIN curriculum_versions v ON v.id=n.version_id WHERE n.id=OLD.node_id;
    IF state <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum content is immutable after publication'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    SELECT v.status INTO old_state FROM curriculum_nodes n JOIN curriculum_versions v ON v.id=n.version_id WHERE n.id=OLD.node_id;
    IF old_state <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum content is immutable after publication'; END IF;
  END IF;
  SELECT n.type, v.status INTO node_type, state FROM curriculum_nodes n JOIN curriculum_versions v ON v.id=n.version_id WHERE n.id=NEW.node_id;
  IF node_type <> 'SKILL' THEN RAISE EXCEPTION 'difficulty applies only to SKILL'; END IF;
  IF state <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum content is immutable after publication'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "curriculum_difficulty_guard" BEFORE INSERT OR UPDATE OR DELETE ON "curriculum_skill_difficulties" FOR EACH ROW EXECUTE FUNCTION phase20_curriculum_difficulty_guard();

CREATE OR REPLACE FUNCTION phase20_curriculum_version_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status='DRAFT' AND NEW.status='PUBLISHED' THEN
    IF NOT EXISTS (SELECT 1 FROM curriculum_nodes WHERE version_id=NEW.id AND type='GRADE')
      OR EXISTS (SELECT 1 FROM curriculum_nodes n LEFT JOIN curriculum_nodes p ON p.id=n.parent_id WHERE n.version_id=NEW.id AND ((n.type='GRADE' AND n.parent_id IS NOT NULL) OR (n.type='DOMAIN' AND p.type <> 'GRADE') OR (n.type='TOPIC' AND p.type <> 'DOMAIN') OR (n.type='SUBTOPIC' AND p.type <> 'TOPIC') OR (n.type='SKILL' AND p.type <> 'SUBTOPIC')))
      OR EXISTS (SELECT 1 FROM curriculum_nodes n WHERE n.version_id=NEW.id AND n.type='SKILL' AND NOT EXISTS (SELECT 1 FROM curriculum_skill_difficulties d WHERE d.node_id=n.id))
    THEN RAISE EXCEPTION 'cannot publish incomplete curriculum hierarchy'; END IF;
    NEW.published_at := COALESCE(NEW.published_at, NOW());
  ELSIF OLD.status='PUBLISHED' AND NEW.status='DEPRECATED' THEN
    IF NEW.curriculum_id <> OLD.curriculum_id OR NEW.version_number <> OLD.version_number OR NEW.human_label IS DISTINCT FROM OLD.human_label OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.created_at <> OLD.created_at THEN RAISE EXCEPTION 'published curriculum version is immutable'; END IF;
    NEW.deprecated_at := COALESCE(NEW.deprecated_at, NOW());
  ELSIF OLD.status IN ('PUBLISHED','DEPRECATED') THEN RAISE EXCEPTION 'published curriculum version is immutable';
  ELSIF OLD.status <> NEW.status THEN RAISE EXCEPTION 'invalid curriculum lifecycle transition';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION phase20_curriculum_version_insert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'curriculum versions must be created as DRAFT'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "curriculum_version_insert_guard" BEFORE INSERT ON "curriculum_versions" FOR EACH ROW EXECUTE FUNCTION phase20_curriculum_version_insert_guard();
CREATE TRIGGER "curriculum_version_guard" BEFORE UPDATE ON "curriculum_versions" FOR EACH ROW EXECUTE FUNCTION phase20_curriculum_version_guard();

CREATE UNIQUE INDEX "curriculum_root_code_unique" ON "curriculum_nodes"("version_id", "code") WHERE "parent_id" IS NULL;
CREATE UNIQUE INDEX "curriculum_root_order_unique" ON "curriculum_nodes"("version_id", "sort_order") WHERE "parent_id" IS NULL;

CREATE OR REPLACE FUNCTION phase20_revision_reference_guard() RETURNS trigger AS $$
DECLARE revision_version UUID; revision_state "AssessmentRevisionState"; node_version UUID; version_status "CurriculumVersionStatus";
BEGIN
  SELECT curriculum_version_id, state INTO revision_version, revision_state FROM assessment_revisions WHERE id=NEW.revision_id;
  SELECT n.version_id, v.status INTO node_version, version_status FROM curriculum_nodes n JOIN curriculum_versions v ON v.id=n.version_id WHERE n.id=NEW.curriculum_node_id;
  IF revision_state <> 'BUILDING' OR node_version <> revision_version OR version_status <> 'PUBLISHED' THEN RAISE EXCEPTION 'invalid assessment curriculum node reference'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "assessment_revision_node_reference_guard" BEFORE INSERT OR UPDATE ON "assessment_revision_node_links" FOR EACH ROW EXECUTE FUNCTION phase20_revision_reference_guard();
CREATE OR REPLACE FUNCTION phase20_finalized_link_delete_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assessment_revisions WHERE id=OLD.revision_id AND state='FINALIZED') THEN RAISE EXCEPTION 'finalized revision content is immutable'; END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "finalized_link_immutable" BEFORE DELETE ON "assessment_revision_node_links" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_link_delete_guard();

CREATE OR REPLACE FUNCTION phase20_finalized_revision_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.state='FINALIZED' THEN RAISE EXCEPTION 'finalized revision is immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "finalized_revision_immutable" BEFORE UPDATE OR DELETE ON "assessment_revisions" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_revision_guard();

CREATE OR REPLACE FUNCTION phase20_finalized_section_guard() RETURNS trigger AS $$
DECLARE revision_id UUID;
BEGIN
  revision_id := CASE WHEN TG_OP='DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  IF EXISTS (SELECT 1 FROM assessment_revisions WHERE id=revision_id AND state='FINALIZED') THEN RAISE EXCEPTION 'finalized revision content is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "finalized_section_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_sections" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_section_guard();

CREATE OR REPLACE FUNCTION phase20_finalized_question_guard() RETURNS trigger AS $$
DECLARE section_id UUID;
BEGIN
  section_id := CASE WHEN TG_OP='DELETE' THEN OLD.section_id ELSE NEW.section_id END;
  IF EXISTS (SELECT 1 FROM assessment_sections s JOIN assessment_revisions r ON r.id=s.revision_id WHERE s.id=section_id AND r.state='FINALIZED') THEN RAISE EXCEPTION 'finalized revision content is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "finalized_question_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_questions" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_question_guard();

CREATE OR REPLACE FUNCTION phase20_finalized_descendant_guard() RETURNS trigger AS $$
DECLARE resolved_question_id UUID; resolved_sub_question_id UUID;
BEGIN
  IF TG_TABLE_NAME='assessment_sub_questions' THEN resolved_question_id := CASE WHEN TG_OP='DELETE' THEN OLD.question_id ELSE NEW.question_id END;
  ELSE
    resolved_question_id := CASE WHEN TG_OP='DELETE' THEN OLD.question_id ELSE NEW.question_id END;
    resolved_sub_question_id := CASE WHEN TG_OP='DELETE' THEN OLD.sub_question_id ELSE NEW.sub_question_id END;
    IF resolved_question_id IS NULL AND resolved_sub_question_id IS NOT NULL THEN SELECT sq.question_id INTO resolved_question_id FROM assessment_sub_questions sq WHERE sq.id=resolved_sub_question_id; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_sections s ON s.id=q.section_id JOIN assessment_revisions r ON r.id=s.revision_id WHERE q.id=resolved_question_id AND r.state='FINALIZED') THEN RAISE EXCEPTION 'finalized revision content is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "finalized_sub_question_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "assessment_sub_questions" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_descendant_guard();
CREATE TRIGGER "finalized_answer_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "answers" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_descendant_guard();
CREATE TRIGGER "finalized_rubric_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "rubric_criteria" FOR EACH ROW EXECUTE FUNCTION phase20_finalized_descendant_guard();

CREATE OR REPLACE FUNCTION phase20_score_finalization_guard() RETURNS trigger AS $$
DECLARE section_total INTEGER; assessment_type "AssessmentType";
BEGIN
  IF NEW.state <> 'FINALIZED' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id=NEW.curriculum_version_id AND v.status='PUBLISHED') THEN RAISE EXCEPTION 'assessment revisions require a published curriculum version'; END IF;
  SELECT type INTO assessment_type FROM assessments WHERE id=NEW.assessment_id;
  IF assessment_type='TEST' AND NEW.scoring_mode <> 'POINTS' THEN RAISE EXCEPTION 'tests require POINTS scoring'; END IF;
  IF NEW.scoring_mode='NONE' THEN
    IF NEW.total_score_units IS NOT NULL OR EXISTS (SELECT 1 FROM assessment_sections s LEFT JOIN assessment_questions q ON q.section_id=s.id LEFT JOIN assessment_sub_questions sq ON sq.question_id=q.id LEFT JOIN rubric_criteria r ON r.question_id=q.id OR r.sub_question_id=sq.id WHERE s.revision_id=NEW.id AND (s.score_units IS NOT NULL OR q.score_units IS NOT NULL OR sq.score_units IS NOT NULL OR r.score_units IS NOT NULL)) THEN RAISE EXCEPTION 'NONE scoring requires null scores'; END IF;
  ELSE
    SELECT COALESCE(SUM(score_units),-1) INTO section_total FROM assessment_sections WHERE revision_id=NEW.id;
    IF NEW.total_score_units IS NULL OR section_total <> NEW.total_score_units THEN RAISE EXCEPTION 'revision score total mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_sections s WHERE s.revision_id=NEW.id AND s.score_units <> (SELECT COALESCE(SUM(q.score_units),-1) FROM assessment_questions q WHERE q.section_id=s.id)) THEN RAISE EXCEPTION 'section score total mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_questions q WHERE EXISTS (SELECT 1 FROM assessment_sub_questions sq WHERE sq.question_id=q.id) AND q.score_units <> (SELECT COALESCE(SUM(sq.score_units),-1) FROM assessment_sub_questions sq WHERE sq.question_id=q.id)) THEN RAISE EXCEPTION 'question score total mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_questions q WHERE EXISTS (SELECT 1 FROM rubric_criteria r WHERE r.question_id=q.id AND r.score_units IS NOT NULL) AND (EXISTS (SELECT 1 FROM rubric_criteria r WHERE r.question_id=q.id AND r.score_units IS NULL) OR q.score_units <> (SELECT COALESCE(SUM(r.score_units),-1) FROM rubric_criteria r WHERE r.question_id=q.id))) THEN RAISE EXCEPTION 'question rubric score total mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_sub_questions sq WHERE EXISTS (SELECT 1 FROM rubric_criteria r WHERE r.sub_question_id=sq.id AND r.score_units IS NOT NULL) AND (EXISTS (SELECT 1 FROM rubric_criteria r WHERE r.sub_question_id=sq.id AND r.score_units IS NULL) OR sq.score_units <> (SELECT COALESCE(SUM(r.score_units),-1) FROM rubric_criteria r WHERE r.sub_question_id=sq.id))) THEN RAISE EXCEPTION 'subquestion rubric score total mismatch'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "assessment_score_finalization_guard" BEFORE UPDATE OF state ON "assessment_revisions" FOR EACH ROW EXECUTE FUNCTION phase20_score_finalization_guard();

CREATE UNIQUE INDEX "answers_question_key_unique" ON "answers"("question_id", "key") WHERE "question_id" IS NOT NULL;
CREATE UNIQUE INDEX "answers_question_order_unique" ON "answers"("question_id", "order") WHERE "question_id" IS NOT NULL;
CREATE UNIQUE INDEX "answers_sub_question_key_unique" ON "answers"("sub_question_id", "key") WHERE "sub_question_id" IS NOT NULL;
CREATE UNIQUE INDEX "answers_sub_question_order_unique" ON "answers"("sub_question_id", "order") WHERE "sub_question_id" IS NOT NULL;
CREATE UNIQUE INDEX "rubrics_question_key_unique" ON "rubric_criteria"("question_id", "key") WHERE "question_id" IS NOT NULL;
CREATE UNIQUE INDEX "rubrics_question_order_unique" ON "rubric_criteria"("question_id", "order") WHERE "question_id" IS NOT NULL;
CREATE UNIQUE INDEX "rubrics_sub_question_key_unique" ON "rubric_criteria"("sub_question_id", "key") WHERE "sub_question_id" IS NOT NULL;
CREATE UNIQUE INDEX "rubrics_sub_question_order_unique" ON "rubric_criteria"("sub_question_id", "order") WHERE "sub_question_id" IS NOT NULL;
