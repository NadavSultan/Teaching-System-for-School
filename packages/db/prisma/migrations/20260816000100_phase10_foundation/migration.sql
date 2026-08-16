CREATE TYPE "LifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'SCHOOL');
CREATE TYPE "MembershipRole" AS ENUM ('TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN');
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "normalized_email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(200), "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "platform_admin" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_normalized_email_key" UNIQUE ("normalized_email")
);
CREATE TABLE "identity_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "provider" VARCHAR(80) NOT NULL, "provider_subject" VARCHAR(255) NOT NULL,
  "user_id" UUID NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_mappings_pkey" PRIMARY KEY ("id"), CONSTRAINT "identity_mappings_provider_provider_subject_key" UNIQUE ("provider", "provider_subject"),
  CONSTRAINT "identity_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(200) NOT NULL, "workspace_type" "WorkspaceType" NOT NULL,
  "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "organization_id" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL, "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"), CONSTRAINT "memberships_user_id_organization_id_key" UNIQUE ("user_id", "organization_id"),
  CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT
);
CREATE INDEX "memberships_organization_id_status_idx" ON "memberships"("organization_id", "status");
CREATE OR REPLACE FUNCTION enforce_personal_workspace_single_active_member() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' AND EXISTS (SELECT 1 FROM "organizations" WHERE "id" = NEW."organization_id" AND "workspace_type" = 'PERSONAL')
     AND EXISTS (SELECT 1 FROM "memberships" WHERE "organization_id" = NEW."organization_id" AND "status" = 'ACTIVE' AND "id" <> NEW."id") THEN
    RAISE EXCEPTION 'personal workspace may have only one active member';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "personal_workspace_single_active_member" BEFORE INSERT OR UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION enforce_personal_workspace_single_active_member();

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "actor_user_id" UUID, "organization_id" UUID, "event_type" VARCHAR(120) NOT NULL,
  "target_type" VARCHAR(120) NOT NULL, "target_id" VARCHAR(255) NOT NULL, "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
);
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_events are append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "audit_events_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID, "event_type" VARCHAR(120) NOT NULL, "payload" JSONB NOT NULL,
  "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING', "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "published_at" TIMESTAMPTZ, "idempotency_key" VARCHAR(255) NOT NULL,
  "last_error" VARCHAR(500), "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"), CONSTRAINT "outbox_events_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT
);
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");
