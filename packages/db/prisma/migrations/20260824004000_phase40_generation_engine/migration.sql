CREATE TYPE "GenerationOperation" AS ENUM ('DRAFT', 'REGENERATE_QUESTION');
CREATE TYPE "GenerationRunState" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'INSUFFICIENT_CONTEXT', 'FAILED');
CREATE TYPE "GenerationLineage" AS ENUM ('GENERATED', 'CARRIED_FORWARD');

CREATE TABLE "generation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "requesting_user_id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "operation" "GenerationOperation" NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "frozen_specification" JSONB NOT NULL,
  "curriculum_version_id" UUID NOT NULL,
  "base_revision_id" UUID,
  "target_question_id" UUID,
  "state" "GenerationRunState" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "failure_code" VARCHAR(80),
  "prompt_template_version" VARCHAR(80) NOT NULL,
  "prompt_template_hash" CHAR(64) NOT NULL,
  "model_configuration_version" VARCHAR(80) NOT NULL,
  "model_configuration_hash" CHAR(64) NOT NULL,
  "response_schema_version" VARCHAR(40) NOT NULL,
  "response_schema_hash" CHAR(64) NOT NULL,
  "provider" VARCHAR(80),
  "model" VARCHAR(120),
  "output_revision_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ,
  CONSTRAINT "generation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_runs_attempts_ck" CHECK ("attempts" >= 0),
  CONSTRAINT "generation_runs_identity_key" UNIQUE ("organization_id", "assessment_id", "idempotency_key"),
  CONSTRAINT "generation_runs_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_runs_user_fkey" FOREIGN KEY ("requesting_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_runs_assessment_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_runs_curriculum_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_runs_base_revision_fkey" FOREIGN KEY ("base_revision_id") REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_runs_target_question_fkey" FOREIGN KEY ("target_question_id") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_runs_output_revision_fkey" FOREIGN KEY ("output_revision_id") REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "generation_runs_owner_state_idx" ON "generation_runs" ("organization_id", "state", "created_at");

CREATE TABLE "generation_context_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "generation_run_id" UUID NOT NULL,
  "selected_order" INTEGER NOT NULL,
  "knowledge_item_id" UUID NOT NULL,
  "source_version_id" UUID NOT NULL,
  "locator" VARCHAR(500) NOT NULL,
  "text_hash" CHAR(64) NOT NULL,
  "curriculum_version_id" UUID NOT NULL,
  "curriculum_node_id" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "character_count" INTEGER NOT NULL,
  "estimated_tokens" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generation_context_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_context_items_selected_ck" CHECK ("selected_order" >= 0),
  CONSTRAINT "generation_context_items_rank_ck" CHECK ("rank" > 0),
  CONSTRAINT "generation_context_items_budget_ck" CHECK ("character_count" > 0 AND "estimated_tokens" > 0),
  CONSTRAINT "generation_context_items_run_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_context_items_item_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_context_items_source_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_context_items_cv_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_context_items_node_fkey" FOREIGN KEY ("curriculum_node_id") REFERENCES "curriculum_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_context_items_order_key" UNIQUE ("generation_run_id", "selected_order"),
  CONSTRAINT "generation_context_items_item_key" UNIQUE ("generation_run_id", "knowledge_item_id")
);
CREATE INDEX "generation_context_items_item_idx" ON "generation_context_items" ("knowledge_item_id");

CREATE TABLE "generation_usages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "generation_run_id" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "request_id" VARCHAR(255) NOT NULL,
  "input_tokens" INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "total_tokens" INTEGER NOT NULL,
  "cost_micros" INTEGER NOT NULL,
  "finish_reason" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generation_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_usages_nonnegative_ck" CHECK ("attempt" > 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND "total_tokens" >= 0 AND "cost_micros" >= 0),
  CONSTRAINT "generation_usages_run_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "generation_usages_attempt_key" UNIQUE ("generation_run_id", "attempt")
);
CREATE INDEX "generation_usages_run_created_idx" ON "generation_usages" ("generation_run_id", "created_at");

CREATE TABLE "question_source_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessment_question_id" UUID NOT NULL,
  "generation_run_id" UUID NOT NULL,
  "knowledge_item_id" UUID NOT NULL,
  "source_version_id" UUID NOT NULL,
  "locator" VARCHAR(500) NOT NULL,
  "text_hash" CHAR(64) NOT NULL,
  "curriculum_version_id" UUID NOT NULL,
  "curriculum_node_id" UUID NOT NULL,
  "lineage" "GenerationLineage" NOT NULL,
  "prior_question_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_source_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "question_source_links_question_fkey" FOREIGN KEY ("assessment_question_id") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_run_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_item_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_source_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_cv_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_node_fkey" FOREIGN KEY ("curriculum_node_id") REFERENCES "curriculum_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_prior_fkey" FOREIGN KEY ("prior_question_id") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "question_source_links_identity_key" UNIQUE ("assessment_question_id", "generation_run_id", "knowledge_item_id")
);
CREATE INDEX "question_source_links_question_idx" ON "question_source_links" ("assessment_question_id");

CREATE OR REPLACE FUNCTION phase40_generation_run_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'generation run is immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.requesting_user_id IS DISTINCT FROM OLD.requesting_user_id OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.operation IS DISTINCT FROM OLD.operation OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR NEW.frozen_specification IS DISTINCT FROM OLD.frozen_specification OR NEW.curriculum_version_id IS DISTINCT FROM OLD.curriculum_version_id OR NEW.base_revision_id IS DISTINCT FROM OLD.base_revision_id OR NEW.target_question_id IS DISTINCT FROM OLD.target_question_id OR NEW.prompt_template_version IS DISTINCT FROM OLD.prompt_template_version OR NEW.prompt_template_hash IS DISTINCT FROM OLD.prompt_template_hash OR NEW.model_configuration_version IS DISTINCT FROM OLD.model_configuration_version OR NEW.model_configuration_hash IS DISTINCT FROM OLD.model_configuration_hash OR NEW.response_schema_version IS DISTINCT FROM OLD.response_schema_version OR NEW.response_schema_hash IS DISTINCT FROM OLD.response_schema_hash THEN
      RAISE EXCEPTION 'generation run identity is immutable';
    END IF;
    IF NOT ((OLD.state = 'PENDING' AND NEW.state = 'PROCESSING') OR (OLD.state = 'PROCESSING' AND NEW.state IN ('PENDING','SUCCEEDED','INSUFFICIENT_CONTEXT','FAILED'))) THEN
      RAISE EXCEPTION 'invalid generation run transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER generation_run_guard BEFORE UPDATE OR DELETE ON generation_runs FOR EACH ROW EXECUTE FUNCTION phase40_generation_run_guard();

CREATE OR REPLACE FUNCTION phase40_generation_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'generation evidence is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER generation_context_append_only BEFORE UPDATE OR DELETE ON generation_context_items FOR EACH ROW EXECUTE FUNCTION phase40_generation_append_only();
CREATE TRIGGER generation_usage_append_only BEFORE UPDATE OR DELETE ON generation_usages FOR EACH ROW EXECUTE FUNCTION phase40_generation_append_only();
CREATE TRIGGER question_source_link_append_only BEFORE UPDATE OR DELETE ON question_source_links FOR EACH ROW EXECUTE FUNCTION phase40_generation_append_only();

CREATE OR REPLACE FUNCTION phase40_generation_context_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; item_row RECORD; source_row RECORD; node_version UUID;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id = NEW.generation_run_id;
  SELECT ki.source_version_id, ki.organization_id, ki.visibility INTO item_row FROM knowledge_items ki WHERE ki.id = NEW.knowledge_item_id;
  SELECT sv.source_id, ks.organization_id INTO source_row FROM source_versions sv JOIN knowledge_sources ks ON ks.id = sv.source_id WHERE sv.id = NEW.source_version_id;
  SELECT version_id INTO node_version FROM curriculum_nodes WHERE id = NEW.curriculum_node_id;
  IF run_row.id IS NULL OR item_row.source_version_id IS NULL OR source_row.source_id IS NULL OR node_version IS DISTINCT FROM NEW.curriculum_version_id OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR item_row.organization_id IS DISTINCT FROM run_row.organization_id AND item_row.visibility = 'ORGANIZATION_PRIVATE' OR source_row.organization_id IS DISTINCT FROM run_row.organization_id AND source_row.organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'generation context identity is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER generation_context_identity BEFORE INSERT ON generation_context_items FOR EACH ROW EXECUTE FUNCTION phase40_generation_context_identity();

CREATE OR REPLACE FUNCTION phase40_question_source_identity() RETURNS trigger AS $$
DECLARE run_row RECORD; question_row RECORD; item_row RECORD; node_version UUID;
BEGIN
  SELECT * INTO run_row FROM generation_runs WHERE id = NEW.generation_run_id;
  SELECT aq.id, ar.assessment_id INTO question_row FROM assessment_questions aq JOIN assessment_sections s ON s.id = aq.section_id JOIN assessment_revisions ar ON ar.id = s.revision_id WHERE aq.id = NEW.assessment_question_id;
  SELECT source_version_id INTO item_row FROM knowledge_items WHERE id = NEW.knowledge_item_id;
  SELECT version_id INTO node_version FROM curriculum_nodes WHERE id = NEW.curriculum_node_id;
  IF run_row.id IS NULL OR question_row.id IS NULL OR question_row.assessment_id IS DISTINCT FROM run_row.assessment_id OR item_row.source_version_id IS DISTINCT FROM NEW.source_version_id OR node_version IS DISTINCT FROM NEW.curriculum_version_id THEN
    RAISE EXCEPTION 'question source identity is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER question_source_identity BEFORE INSERT ON question_source_links FOR EACH ROW EXECUTE FUNCTION phase40_question_source_identity();
