-- Phase 50 Validation Engine.  This migration is deliberately forward-only.
CREATE TYPE "ValidationRunState" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ValidationRuleOutcome" AS ENUM ('PASS', 'FAIL');
CREATE TYPE "ValidationFindingKind" AS ENUM ('DETERMINISTIC', 'SEMANTIC');
CREATE TYPE "ValidationSeverity" AS ENUM ('BLOCKING', 'WARNING', 'INFO');
CREATE TYPE "SemanticEvaluationState" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "validation_rule_definitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "ruleset_version" VARCHAR(40) NOT NULL,
  "rule_id" VARCHAR(120) NOT NULL, "rule_version" VARCHAR(40) NOT NULL,
  "category" VARCHAR(120) NOT NULL, "default_severity" "ValidationSeverity" NOT NULL,
  "deterministic_order" INTEGER NOT NULL CHECK ("deterministic_order" > 0), "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("ruleset_version", "rule_id", "rule_version"), UNIQUE ("ruleset_version", "deterministic_order")
);

CREATE TABLE "validation_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "assessment_id" UUID NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT,
  "assessment_revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,
  "requesting_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "operation" VARCHAR(40) NOT NULL DEFAULT 'VALIDATE', "ruleset_version" VARCHAR(40) NOT NULL, "evaluator_version" VARCHAR(40) NOT NULL,
  "revision_sequence" INTEGER NOT NULL CHECK ("revision_sequence" > 0), "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL, "state" "ValidationRunState" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "failure_code" VARCHAR(80), "lease_expires_at" TIMESTAMPTZ, "processing_started_at" TIMESTAMPTZ, "completed_at" TIMESTAMPTZ,
  "deterministic_pass_count" INTEGER NOT NULL DEFAULT 0, "deterministic_fail_count" INTEGER NOT NULL DEFAULT 0, "semantic_finding_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "assessment_revision_id", "revision_sequence"), UNIQUE ("organization_id", "assessment_revision_id", "idempotency_key")
);
CREATE INDEX "validation_runs_revision_sequence_idx" ON "validation_runs" ("organization_id", "assessment_revision_id", "revision_sequence");
CREATE INDEX "validation_runs_lease_idx" ON "validation_runs" ("state", "lease_expires_at");

CREATE TABLE "validation_rule_executions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "validation_run_id" UUID NOT NULL REFERENCES "validation_runs"("id") ON DELETE RESTRICT,
  "rule_definition_id" UUID NOT NULL REFERENCES "validation_rule_definitions"("id") ON DELETE RESTRICT,
  "outcome" "ValidationRuleOutcome" NOT NULL, "evidence" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("validation_run_id", "rule_definition_id")
);
CREATE TABLE "semantic_evaluations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "validation_run_id" UUID NOT NULL UNIQUE REFERENCES "validation_runs"("id") ON DELETE RESTRICT,
  "evaluator_version" VARCHAR(40) NOT NULL, "prompt_version" VARCHAR(40) NOT NULL, "model_configuration_version" VARCHAR(40) NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL, "state" "SemanticEvaluationState" NOT NULL, "failure_code" VARCHAR(80), "latency_ms" INTEGER,
  "usage" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE "validation_findings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "validation_run_id" UUID NOT NULL REFERENCES "validation_runs"("id") ON DELETE RESTRICT,
  "assessment_revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,
  "execution_id" UUID UNIQUE REFERENCES "validation_rule_executions"("id") ON DELETE RESTRICT,
  "semantic_evaluation_id" UUID REFERENCES "semantic_evaluations"("id") ON DELETE RESTRICT,
  "kind" "ValidationFindingKind" NOT NULL, "code" VARCHAR(120) NOT NULL, "category" VARCHAR(120) NOT NULL, "severity" "ValidationSeverity" NOT NULL,
  "path" VARCHAR(500) NOT NULL, "message_key" VARCHAR(160) NOT NULL, "evidence" JSONB NOT NULL DEFAULT '{}', "confidence_basis_points" INTEGER,
  "rule_version" VARCHAR(40), "evaluator_version" VARCHAR(40), "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (("kind" = 'DETERMINISTIC' AND "execution_id" IS NOT NULL AND "semantic_evaluation_id" IS NULL AND "severity" = 'BLOCKING') OR ("kind" = 'SEMANTIC' AND "execution_id" IS NULL AND "semantic_evaluation_id" IS NOT NULL))
);
CREATE INDEX "validation_findings_run_idx" ON "validation_findings" ("organization_id", "validation_run_id", "created_at");
CREATE TABLE "validation_finding_acknowledgements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "finding_id" UUID NOT NULL REFERENCES "validation_findings"("id") ON DELETE RESTRICT, "actor_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" VARCHAR(255) NOT NULL, "reason" VARCHAR(1000) NOT NULL, "reason_hash" CHAR(64) NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "finding_id", "idempotency_key")
);

INSERT INTO "validation_rule_definitions" ("ruleset_version", "rule_id", "rule_version", "category", "default_severity", "deterministic_order") VALUES
('v1','REVISION_FINALIZED_AND_OWNED','1.0.0','REVISION','BLOCKING',1), ('v1','STRICT_REVISION_CONTRACT','1.0.0','CONTRACT','BLOCKING',2),
('v1','PLAN_COUNT_KEY_ORDER','1.0.0','PLAN','BLOCKING',3), ('v1','CURRICULUM_SCOPE_PUBLISHED','1.0.0','CURRICULUM','BLOCKING',4),
('v1','ANSWER_COMPLETENESS_AND_TARGETS','1.0.0','ANSWER','BLOCKING',5), ('v1','EXACT_SCORE_TREE','1.0.0','SCORING','BLOCKING',6),
('v1','STABLE_ID_AND_EXACT_DUPLICATE','1.0.0','IDENTITY','BLOCKING',7), ('v1','DETERMINISTIC_ANSWER_LEAKAGE','1.0.0','LEAKAGE','BLOCKING',8),
('v1','SOURCE_LINK_COMPLETENESS_AND_IDENTITY','1.0.0','SOURCE','BLOCKING',9), ('v1','CURRENT_SOURCE_ELIGIBILITY','1.0.0','SOURCE','BLOCKING',10),
('v1','GENERATION_REVISION_PROVENANCE','1.0.0','PROVENANCE','BLOCKING',11);

CREATE FUNCTION "phase50_reject_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phase50 immutable evidence' USING ERRCODE = 'P5001'; END; $$;
CREATE TRIGGER "phase50_rule_definitions_immutable" BEFORE UPDATE OR DELETE ON "validation_rule_definitions" FOR EACH ROW EXECUTE FUNCTION "phase50_reject_immutable"();
CREATE TRIGGER "phase50_executions_immutable" BEFORE UPDATE OR DELETE ON "validation_rule_executions" FOR EACH ROW EXECUTE FUNCTION "phase50_reject_immutable"();
CREATE TRIGGER "phase50_semantic_immutable" BEFORE UPDATE OR DELETE ON "semantic_evaluations" FOR EACH ROW EXECUTE FUNCTION "phase50_reject_immutable"();
CREATE TRIGGER "phase50_findings_immutable" BEFORE UPDATE OR DELETE ON "validation_findings" FOR EACH ROW EXECUTE FUNCTION "phase50_reject_immutable"();
CREATE TRIGGER "phase50_acknowledgements_immutable" BEFORE UPDATE OR DELETE ON "validation_finding_acknowledgements" FOR EACH ROW EXECUTE FUNCTION "phase50_reject_immutable"();

CREATE FUNCTION "phase50_validation_run_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "assessment_revisions" r JOIN "assessments" a ON a.id=r."assessment_id" WHERE r.id=NEW."assessment_revision_id" AND r."assessment_id"=NEW."assessment_id" AND r.state='FINALIZED' AND a."organization_id"=NEW."organization_id") THEN RAISE EXCEPTION 'phase50 revision identity or finalized state rejected' USING ERRCODE='P5002'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "memberships" m JOIN "users" u ON u.id=m."user_id" WHERE m."organization_id"=NEW."organization_id" AND m."user_id"=NEW."requesting_user_id" AND m.status='ACTIVE' AND u.status='ACTIVE') THEN RAISE EXCEPTION 'phase50 persisted authority rejected' USING ERRCODE='P5003'; END IF;
  ELSE
    IF OLD."organization_id"<>NEW."organization_id" OR OLD."assessment_id"<>NEW."assessment_id" OR OLD."assessment_revision_id"<>NEW."assessment_revision_id" OR OLD."requesting_user_id"<>NEW."requesting_user_id" OR OLD."operation"<>NEW."operation" OR OLD."ruleset_version"<>NEW."ruleset_version" OR OLD."evaluator_version"<>NEW."evaluator_version" OR OLD."revision_sequence"<>NEW."revision_sequence" OR OLD."idempotency_key"<>NEW."idempotency_key" OR OLD."request_fingerprint"<>NEW."request_fingerprint" THEN RAISE EXCEPTION 'phase50 validation run immutable identity' USING ERRCODE='P5004'; END IF;
    IF NOT ((OLD.state='PENDING' AND NEW.state='PROCESSING') OR (OLD.state='PROCESSING' AND NEW.state IN ('PENDING','SUCCEEDED','FAILED')) OR OLD.state=NEW.state) THEN RAISE EXCEPTION 'phase50 invalid validation state transition' USING ERRCODE='P5005'; END IF;
    IF NEW.state='SUCCEEDED' AND ((SELECT count(*) FROM "validation_rule_executions" e JOIN "validation_rule_definitions" d ON d.id=e."rule_definition_id" WHERE e."validation_run_id"=NEW.id AND d."ruleset_version"=NEW."ruleset_version") <> 11 OR NOT EXISTS (SELECT 1 FROM "semantic_evaluations" s WHERE s."validation_run_id"=NEW.id AND s.state='SUCCEEDED')) THEN RAISE EXCEPTION 'phase50 validation completion evidence incomplete' USING ERRCODE='P5006'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "phase50_validation_run_guard" BEFORE INSERT OR UPDATE ON "validation_runs" FOR EACH ROW EXECUTE FUNCTION "phase50_validation_run_guard"();
CREATE FUNCTION "phase50_ack_guard"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "validation_findings" WHERE id=NEW."finding_id" AND "organization_id"=NEW."organization_id" AND kind='SEMANTIC' AND severity='WARNING') THEN RAISE EXCEPTION 'phase50 acknowledgement requires semantic warning' USING ERRCODE='P5007'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "phase50_ack_guard" BEFORE INSERT ON "validation_finding_acknowledgements" FOR EACH ROW EXECUTE FUNCTION "phase50_ack_guard"();

CREATE FUNCTION "assert_revision_approvable"(p_organization_id UUID, p_revision_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_run UUID; BEGIN
 SELECT id INTO v_run FROM "validation_runs" WHERE "organization_id"=p_organization_id AND "assessment_revision_id"=p_revision_id ORDER BY "revision_sequence" DESC LIMIT 1;
 IF v_run IS NULL OR NOT EXISTS (SELECT 1 FROM "validation_runs" WHERE id=v_run AND state='SUCCEEDED') OR EXISTS (SELECT 1 FROM "validation_findings" f WHERE f."validation_run_id"=v_run AND (f.severity='BLOCKING' OR (f.severity='WARNING' AND NOT EXISTS (SELECT 1 FROM "validation_finding_acknowledgements" a WHERE a."finding_id"=f.id)))) THEN RAISE EXCEPTION 'phase50 revision is not approvable' USING ERRCODE='P5008'; END IF; RETURN v_run; END; $$;
