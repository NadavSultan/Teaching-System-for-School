-- Phase 50 Validation Engine. This migration is deliberately forward-only.
CREATE TYPE "ValidationRunState" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ValidationRuleOutcome" AS ENUM ('PASS', 'FAIL');
CREATE TYPE "ValidationFindingKind" AS ENUM ('DETERMINISTIC', 'SEMANTIC');
CREATE TYPE "ValidationSeverity" AS ENUM ('BLOCKING', 'WARNING', 'INFO');
CREATE TYPE "SemanticEvaluationState" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "validation_rule_definitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "ruleset_version" VARCHAR(40) NOT NULL,
  "rule_id" VARCHAR(120) NOT NULL, "rule_version" VARCHAR(40) NOT NULL, "category" VARCHAR(120) NOT NULL,
  "default_severity" "ValidationSeverity" NOT NULL, "deterministic_order" INTEGER NOT NULL CHECK ("deterministic_order" > 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("ruleset_version", "rule_id", "rule_version"), UNIQUE ("ruleset_version", "deterministic_order")
);
CREATE TABLE "validation_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "assessment_id" UUID NOT NULL REFERENCES "assessments"("id") ON DELETE RESTRICT, "assessment_revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,
  "requesting_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, "operation" VARCHAR(40) NOT NULL DEFAULT 'VALIDATE',
  "ruleset_version" VARCHAR(40) NOT NULL, "evaluator_version" VARCHAR(40) NOT NULL, "revision_sequence" INTEGER NOT NULL CHECK ("revision_sequence" > 0),
  "idempotency_key" VARCHAR(255) NOT NULL, "request_fingerprint" CHAR(64) NOT NULL, "state" "ValidationRunState" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0), "failure_code" VARCHAR(80), "lease_expires_at" TIMESTAMPTZ,
  "processing_started_at" TIMESTAMPTZ, "completed_at" TIMESTAMPTZ, "deterministic_pass_count" INTEGER NOT NULL DEFAULT 0 CHECK ("deterministic_pass_count" >= 0),
  "deterministic_fail_count" INTEGER NOT NULL DEFAULT 0 CHECK ("deterministic_fail_count" >= 0), "semantic_finding_count" INTEGER NOT NULL DEFAULT 0 CHECK ("semantic_finding_count" >= 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "assessment_revision_id", "revision_sequence"), UNIQUE ("organization_id", "assessment_revision_id", "idempotency_key")
);
CREATE INDEX "validation_runs_revision_sequence_idx" ON "validation_runs" ("organization_id", "assessment_revision_id", "revision_sequence");
CREATE INDEX "validation_runs_lease_idx" ON "validation_runs" ("state", "lease_expires_at");
CREATE TABLE "validation_rule_executions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "validation_run_id" UUID NOT NULL REFERENCES "validation_runs"("id") ON DELETE RESTRICT,
  "rule_definition_id" UUID NOT NULL REFERENCES "validation_rule_definitions"("id") ON DELETE RESTRICT, "outcome" "ValidationRuleOutcome" NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE ("validation_run_id", "rule_definition_id")
);
CREATE TABLE "semantic_evaluations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "validation_run_id" UUID NOT NULL UNIQUE REFERENCES "validation_runs"("id") ON DELETE RESTRICT,
  "evaluator_version" VARCHAR(40) NOT NULL, "prompt_version" VARCHAR(40) NOT NULL, "model_configuration_version" VARCHAR(40) NOT NULL,
  "schema_version" VARCHAR(40) NOT NULL, "state" "SemanticEvaluationState" NOT NULL, "failure_code" VARCHAR(80),
  "latency_ms" INTEGER CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0), "usage" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE "validation_findings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "validation_run_id" UUID NOT NULL REFERENCES "validation_runs"("id") ON DELETE RESTRICT, "assessment_revision_id" UUID NOT NULL REFERENCES "assessment_revisions"("id") ON DELETE RESTRICT,
  "execution_id" UUID UNIQUE REFERENCES "validation_rule_executions"("id") ON DELETE RESTRICT, "semantic_evaluation_id" UUID REFERENCES "semantic_evaluations"("id") ON DELETE RESTRICT,
  "kind" "ValidationFindingKind" NOT NULL, "code" VARCHAR(120) NOT NULL, "category" VARCHAR(120) NOT NULL, "severity" "ValidationSeverity" NOT NULL,
  "path" VARCHAR(500) NOT NULL, "message_key" VARCHAR(160) NOT NULL, "evidence" JSONB NOT NULL DEFAULT '{}',
  "confidence_basis_points" INTEGER CHECK ("confidence_basis_points" IS NULL OR "confidence_basis_points" BETWEEN 0 AND 10000), "rule_version" VARCHAR(40), "evaluator_version" VARCHAR(40), "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (("kind" = 'DETERMINISTIC' AND "execution_id" IS NOT NULL AND "semantic_evaluation_id" IS NULL AND "severity" = 'BLOCKING' AND "rule_version" IS NOT NULL AND "evaluator_version" IS NULL) OR ("kind" = 'SEMANTIC' AND "execution_id" IS NULL AND "semantic_evaluation_id" IS NOT NULL AND "rule_version" IS NULL AND "evaluator_version" IS NOT NULL))
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

CREATE OR REPLACE FUNCTION phase50_raise(code text, message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%', message USING ERRCODE = code; END; $$;
CREATE OR REPLACE FUNCTION phase50_reject_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phase50 immutable evidence' USING ERRCODE = 'P5001'; END; $$;
CREATE TRIGGER phase50_rule_definitions_immutable BEFORE UPDATE OR DELETE ON validation_rule_definitions FOR EACH ROW EXECUTE FUNCTION phase50_reject_immutable();
CREATE TRIGGER phase50_executions_immutable BEFORE UPDATE OR DELETE ON validation_rule_executions FOR EACH ROW EXECUTE FUNCTION phase50_reject_immutable();
CREATE TRIGGER phase50_semantic_immutable BEFORE UPDATE OR DELETE ON semantic_evaluations FOR EACH ROW EXECUTE FUNCTION phase50_reject_immutable();
CREATE TRIGGER phase50_findings_immutable BEFORE UPDATE OR DELETE ON validation_findings FOR EACH ROW EXECUTE FUNCTION phase50_reject_immutable();

CREATE OR REPLACE FUNCTION phase50_validation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text; v_rules integer; v_semantic integer; v_bad integer; v_total integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM assessments a WHERE a.id=NEW.assessment_id AND a.organization_id=NEW.organization_id) THEN PERFORM phase50_raise('P5010','phase50 assessment owner does not match organization'); END IF;
    IF NOT EXISTS (SELECT 1 FROM assessment_revisions r WHERE r.id=NEW.assessment_revision_id AND r.assessment_id=NEW.assessment_id) THEN PERFORM phase50_raise('P5011','phase50 revision does not belong to assessment'); END IF;
    SELECT r.state::text INTO v_state FROM assessment_revisions r WHERE r.id=NEW.assessment_revision_id;
    IF v_state IS DISTINCT FROM 'FINALIZED' THEN PERFORM phase50_raise('P5012','phase50 revision must be FINALIZED'); END IF;
    IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND o.status='ACTIVE') THEN PERFORM phase50_raise('P5013','phase50 organization is inactive'); END IF;
    IF NOT EXISTS (SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=NEW.requesting_user_id AND u.status='ACTIVE' AND m.organization_id=NEW.organization_id AND m.status='ACTIVE') THEN PERFORM phase50_raise('P5014','phase50 requester lacks active organization authority'); END IF;
    IF NEW.operation<>'VALIDATE' OR NEW.ruleset_version<>'v1' OR NEW.evaluator_version<>'local-disabled-v1' THEN PERFORM phase50_raise('P5015','phase50 ruleset or evaluator configuration is not registered'); END IF;
    RETURN NEW;
  END IF;
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.assessment_id IS DISTINCT FROM NEW.assessment_id OR OLD.assessment_revision_id IS DISTINCT FROM NEW.assessment_revision_id OR OLD.requesting_user_id IS DISTINCT FROM NEW.requesting_user_id OR OLD.operation IS DISTINCT FROM NEW.operation OR OLD.ruleset_version IS DISTINCT FROM NEW.ruleset_version OR OLD.evaluator_version IS DISTINCT FROM NEW.evaluator_version OR OLD.revision_sequence IS DISTINCT FROM NEW.revision_sequence OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint THEN PERFORM phase50_raise('P5016','phase50 validation run identity is immutable'); END IF;
  IF OLD.state=NEW.state THEN PERFORM phase50_raise('P5017','phase50 same-state validation update is forbidden'); END IF;
  IF NOT ((OLD.state='PENDING' AND NEW.state='PROCESSING') OR (OLD.state='PROCESSING' AND NEW.state IN ('PENDING','SUCCEEDED','FAILED'))) THEN PERFORM phase50_raise('P5018','phase50 validation lifecycle transition is forbidden'); END IF;
  IF OLD.state='PENDING' AND NEW.state='PROCESSING' AND (NEW.attempts<>OLD.attempts+1 OR NEW.processing_started_at IS NULL OR NEW.lease_expires_at IS NULL OR NEW.completed_at IS NOT NULL OR NEW.failure_code IS NOT NULL) THEN PERFORM phase50_raise('P5019','phase50 processing claim shape is invalid'); END IF;
  IF OLD.state='PROCESSING' AND NEW.state='PENDING' AND (OLD.lease_expires_at IS NULL OR OLD.lease_expires_at>now() OR NEW.completed_at IS NOT NULL OR NEW.failure_code IS NOT NULL) THEN PERFORM phase50_raise('P5020','phase50 retry requires an expired processing lease'); END IF;
  IF NEW.state='FAILED' AND (NEW.failure_code IS NULL OR NEW.completed_at IS NULL OR NEW.lease_expires_at IS NOT NULL) THEN PERFORM phase50_raise('P5021','phase50 failure terminal shape is invalid'); END IF;
  IF NEW.state='SUCCEEDED' THEN
    SELECT count(*) INTO v_rules FROM validation_rule_executions e JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.validation_run_id=NEW.id AND d.ruleset_version='v1' AND d.rule_version='1.0.0' AND d.deterministic_order BETWEEN 1 AND 11;
    SELECT count(*) INTO v_total FROM validation_rule_executions WHERE validation_run_id=NEW.id;
    SELECT count(*) INTO v_semantic FROM semantic_evaluations s WHERE s.validation_run_id=NEW.id AND s.state='SUCCEEDED' AND s.evaluator_version='local-disabled-v1' AND s.prompt_version='validation-prompt-v1' AND s.model_configuration_version='local-none-v1' AND s.schema_version='1.0.0';
    SELECT count(*) INTO v_bad FROM validation_rule_executions e JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.validation_run_id=NEW.id AND (d.ruleset_version<>'v1' OR d.rule_version<>'1.0.0' OR d.deterministic_order NOT BETWEEN 1 AND 11);
    IF v_rules<>11 OR v_total<>11 OR v_semantic<>1 OR v_bad<>0 OR NEW.deterministic_pass_count+NEW.deterministic_fail_count<>11 OR NEW.deterministic_fail_count<>(SELECT count(*) FROM validation_rule_executions WHERE validation_run_id=NEW.id AND outcome='FAIL') OR NEW.semantic_finding_count<>(SELECT count(*) FROM validation_findings WHERE validation_run_id=NEW.id AND kind='SEMANTIC') OR NEW.completed_at IS NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.failure_code IS NOT NULL THEN PERFORM phase50_raise('P5022','phase50 success requires the complete pinned evidence shape'); END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase50_validation_run_guard BEFORE INSERT OR UPDATE ON validation_runs FOR EACH ROW EXECUTE FUNCTION phase50_validation_run_guard();

CREATE OR REPLACE FUNCTION phase50_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM validation_runs r JOIN validation_rule_definitions d ON d.id=NEW.rule_definition_id WHERE r.id=NEW.validation_run_id AND r.ruleset_version='v1' AND d.ruleset_version='v1' AND d.rule_version='1.0.0' AND d.deterministic_order BETWEEN 1 AND 11) THEN PERFORM phase50_raise('P5023','phase50 execution rule is unknown or wrong version'); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase50_execution_guard BEFORE INSERT ON validation_rule_executions FOR EACH ROW EXECUTE FUNCTION phase50_execution_guard();
CREATE OR REPLACE FUNCTION phase50_semantic_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM validation_runs r WHERE r.id=NEW.validation_run_id AND r.ruleset_version='v1' AND r.evaluator_version='local-disabled-v1') OR NEW.evaluator_version<>'local-disabled-v1' OR NEW.prompt_version<>'validation-prompt-v1' OR NEW.model_configuration_version<>'local-none-v1' OR NEW.schema_version<>'1.0.0' OR (NEW.state='FAILED' AND NEW.failure_code IS NULL) OR (NEW.state='SUCCEEDED' AND NEW.failure_code IS NOT NULL) THEN PERFORM phase50_raise('P5024','phase50 semantic evaluation configuration or terminal shape is invalid'); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase50_semantic_guard BEFORE INSERT ON semantic_evaluations FOR EACH ROW EXECUTE FUNCTION phase50_semantic_guard();
CREATE OR REPLACE FUNCTION phase50_finding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='DETERMINISTIC' AND NOT EXISTS (SELECT 1 FROM validation_rule_executions e JOIN validation_runs r ON r.id=e.validation_run_id JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.id=NEW.execution_id AND e.validation_run_id=NEW.validation_run_id AND r.organization_id=NEW.organization_id AND r.assessment_revision_id=NEW.assessment_revision_id AND d.rule_version=NEW.rule_version AND NEW.severity='BLOCKING') THEN PERFORM phase50_raise('P5025','phase50 deterministic finding identity does not match execution'); END IF;
  IF NEW.kind='SEMANTIC' AND NOT EXISTS (SELECT 1 FROM semantic_evaluations s JOIN validation_runs r ON r.id=s.validation_run_id WHERE s.id=NEW.semantic_evaluation_id AND s.validation_run_id=NEW.validation_run_id AND r.organization_id=NEW.organization_id AND r.assessment_revision_id=NEW.assessment_revision_id AND s.evaluator_version=NEW.evaluator_version AND NEW.severity IN ('BLOCKING','WARNING','INFO')) THEN PERFORM phase50_raise('P5026','phase50 semantic finding identity does not match evaluation'); END IF;
  IF NEW.kind='SEMANTIC' AND NEW.category NOT IN ('HEBREW_CORRECTNESS','AMBIGUITY','ANSWER_VALIDITY','DIFFICULTY_FIT','CURRICULUM_FIT','DUPLICATION','ANSWER_LEAKAGE') THEN PERFORM phase50_raise('P5027','phase50 semantic finding category is not registered'); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase50_finding_guard BEFORE INSERT ON validation_findings FOR EACH ROW EXECUTE FUNCTION phase50_finding_guard();
CREATE OR REPLACE FUNCTION phase50_ack_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM validation_findings f JOIN validation_runs r ON r.id=f.validation_run_id JOIN users u ON u.id=NEW.actor_user_id JOIN memberships m ON m.user_id=u.id WHERE f.id=NEW.finding_id AND f.organization_id=NEW.organization_id AND f.kind='SEMANTIC' AND f.severity='WARNING' AND r.organization_id=NEW.organization_id AND u.status='ACTIVE' AND m.organization_id=NEW.organization_id AND m.status='ACTIVE') THEN PERFORM phase50_raise('P5028','phase50 acknowledgement requires an owned semantic warning and active actor'); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER phase50_ack_guard BEFORE INSERT ON validation_finding_acknowledgements FOR EACH ROW EXECUTE FUNCTION phase50_ack_guard();
CREATE TRIGGER phase50_acknowledgements_immutable BEFORE UPDATE OR DELETE ON validation_finding_acknowledgements FOR EACH ROW EXECUTE FUNCTION phase50_reject_immutable();

CREATE OR REPLACE FUNCTION assert_revision_approvable(p_organization_id UUID, p_revision_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_run UUID;
BEGIN
  SELECT r.id INTO v_run FROM validation_runs r WHERE r.organization_id=p_organization_id AND r.assessment_revision_id=p_revision_id ORDER BY r.revision_sequence DESC LIMIT 1;
  IF v_run IS NULL OR NOT EXISTS (
    SELECT 1
    FROM validation_runs r
    JOIN assessments a ON a.id=r.assessment_id
    JOIN assessment_revisions ar ON ar.id=r.assessment_revision_id
    WHERE r.id=v_run
      AND r.state='SUCCEEDED'
      AND r.ruleset_version='v1'
      AND r.evaluator_version='local-disabled-v1'
      AND a.organization_id=p_organization_id
      AND ar.assessment_id=r.assessment_id
      AND ar.state='FINALIZED'
      AND r.deterministic_pass_count+r.deterministic_fail_count=11
      AND (SELECT count(*) FROM validation_rule_definitions d WHERE d.ruleset_version='v1' AND d.rule_version='1.0.0' AND d.deterministic_order BETWEEN 1 AND 11)=11
      AND (SELECT count(*) FROM validation_rule_executions e WHERE e.validation_run_id=r.id)=11
      AND (SELECT count(*) FROM validation_rule_executions e JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.validation_run_id=r.id AND d.ruleset_version='v1' AND d.rule_version='1.0.0' AND d.deterministic_order BETWEEN 1 AND 11)=11
      AND (SELECT count(DISTINCT d.rule_id) FROM validation_rule_executions e JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.validation_run_id=r.id AND d.ruleset_version='v1' AND d.rule_version='1.0.0' AND d.deterministic_order BETWEEN 1 AND 11)=11
      AND NOT EXISTS (SELECT 1 FROM validation_rule_definitions d WHERE d.ruleset_version='v1' AND d.rule_version='1.0.0' AND d.deterministic_order BETWEEN 1 AND 11 AND NOT EXISTS (SELECT 1 FROM validation_rule_executions e WHERE e.validation_run_id=r.id AND e.rule_definition_id=d.id))
      AND r.deterministic_pass_count=(SELECT count(*) FROM validation_rule_executions e WHERE e.validation_run_id=r.id AND e.outcome='PASS')
      AND r.deterministic_fail_count=(SELECT count(*) FROM validation_rule_executions e WHERE e.validation_run_id=r.id AND e.outcome='FAIL')
      AND (SELECT count(*) FROM semantic_evaluations s WHERE s.validation_run_id=r.id)=1
      AND (SELECT count(*) FROM semantic_evaluations s WHERE s.validation_run_id=r.id AND s.state='SUCCEEDED' AND s.evaluator_version='local-disabled-v1' AND s.prompt_version='validation-prompt-v1' AND s.model_configuration_version='local-none-v1' AND s.schema_version='1.0.0')=1
      AND r.semantic_finding_count=(SELECT count(*) FROM validation_findings f WHERE f.validation_run_id=r.id AND f.kind='SEMANTIC')
      AND NOT EXISTS (SELECT 1 FROM validation_findings f WHERE f.validation_run_id=r.id AND ((f.kind='DETERMINISTIC' AND NOT EXISTS (SELECT 1 FROM validation_rule_executions e JOIN validation_rule_definitions d ON d.id=e.rule_definition_id WHERE e.id=f.execution_id AND e.validation_run_id=r.id AND r.organization_id=f.organization_id AND r.assessment_revision_id=f.assessment_revision_id AND d.ruleset_version='v1' AND d.rule_version='1.0.0' AND f.rule_version=d.rule_version AND f.code=d.rule_id AND f.category=d.category AND f.severity='BLOCKING' AND NULLIF(f.message_key,'') IS NOT NULL)) OR (f.kind='SEMANTIC' AND NOT EXISTS (SELECT 1 FROM semantic_evaluations s WHERE s.id=f.semantic_evaluation_id AND s.validation_run_id=r.id AND r.organization_id=f.organization_id AND r.assessment_revision_id=f.assessment_revision_id AND s.evaluator_version=f.evaluator_version AND f.category IN ('HEBREW_CORRECTNESS','AMBIGUITY','ANSWER_VALIDITY','DIFFICULTY_FIT','CURRICULUM_FIT','DUPLICATION','ANSWER_LEAKAGE') AND f.severity IN ('BLOCKING','WARNING','INFO') AND NULLIF(f.code,'') IS NOT NULL AND NULLIF(f.message_key,'') IS NOT NULL))))
  ) OR EXISTS (SELECT 1 FROM validation_findings f WHERE f.validation_run_id=v_run AND (f.severity='BLOCKING' OR (f.severity='WARNING' AND NOT EXISTS (SELECT 1 FROM validation_finding_acknowledgements a JOIN users u ON u.id=a.actor_user_id JOIN memberships m ON m.user_id=u.id WHERE a.finding_id=f.id AND a.organization_id=f.organization_id AND u.status='ACTIVE' AND m.organization_id=f.organization_id AND m.status='ACTIVE')))) THEN RAISE EXCEPTION 'phase50 revision is not approvable' USING ERRCODE='P5029'; END IF;
  IF EXISTS (
    SELECT 1
    FROM assessment_sections sec
    JOIN assessment_questions q ON q.section_id=sec.id
    JOIN question_source_links qsl ON qsl.assessment_question_id=q.id
    JOIN knowledge_items ki ON ki.id=qsl.knowledge_item_id
    JOIN source_versions sv ON sv.id=qsl.source_version_id
    JOIN knowledge_sources ks ON ks.id=sv.source_id
    LEFT JOIN LATERAL (SELECT pr.decision FROM pedagogical_reviews pr WHERE pr.source_version_id=sv.id ORDER BY pr.created_at DESC, pr.id DESC LIMIT 1) review ON true
    LEFT JOIN LATERAL (SELECT up.decision, up.valid_until FROM usage_permissions up WHERE up.source_version_id=sv.id ORDER BY up.created_at DESC, up.id DESC LIMIT 1) permission ON true
    WHERE sec.revision_id=p_revision_id
      AND NOT (
        sv.lifecycle='ACTIVE'
        AND COALESCE((SELECT sle.to_status FROM source_lifecycle_events sle WHERE sle.source_id=ks.id ORDER BY sle.created_at DESC, sle.id DESC LIMIT 1), sv.lifecycle)='ACTIVE'
        AND ki.status='ACTIVE'
        AND review.decision='APPROVED'
        AND permission.decision='ALLOWED' AND (permission.valid_until IS NULL OR permission.valid_until>now())
        AND (ks.visibility='PLATFORM_SHARED' OR ks.organization_id=p_organization_id)
        AND (ki.visibility='PLATFORM_SHARED' OR ki.organization_id=p_organization_id)
        AND qsl.curriculum_version_id=(SELECT curriculum_version_id FROM assessment_revisions WHERE id=p_revision_id)
        AND EXISTS (SELECT 1 FROM curriculum_versions cv WHERE cv.id=qsl.curriculum_version_id AND cv.status='PUBLISHED')
        AND EXISTS (SELECT 1 FROM assessment_revision_node_links arnl WHERE arnl.revision_id=p_revision_id AND arnl.curriculum_node_id=qsl.curriculum_node_id)
      )
  ) THEN RAISE EXCEPTION 'phase50 current source eligibility is revoked' USING ERRCODE='P5030'; END IF;
  RETURN v_run;
END; $$;
