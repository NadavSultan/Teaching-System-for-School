-- Phase 10 corrective migration: exact personal-workspace cardinality and outbox leases.
DROP TRIGGER IF EXISTS "personal_workspace_single_active_member" ON "memberships";
DROP FUNCTION IF EXISTS enforce_personal_workspace_single_active_member();

CREATE OR REPLACE FUNCTION enforce_personal_workspace_exactly_one_member() RETURNS trigger AS $$
DECLARE
  affected_organization UUID;
  active_members INTEGER;
  teacher_members INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    affected_organization := COALESCE(NEW."id", OLD."id");
  ELSE
    affected_organization := COALESCE(NEW."organization_id", OLD."organization_id");
  END IF;
  IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = affected_organization AND "workspace_type" = 'PERSONAL' AND "status" = 'ACTIVE') THEN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE "role" = 'TEACHER') INTO active_members, teacher_members
    FROM "memberships" WHERE "organization_id" = affected_organization AND "status" = 'ACTIVE';
    IF active_members <> 1 OR teacher_members <> 1 THEN
      RAISE EXCEPTION 'active personal workspace requires exactly one active TEACHER membership';
    END IF;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "personal_workspace_membership_cardinality"
AFTER INSERT OR UPDATE OR DELETE ON "memberships"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_personal_workspace_exactly_one_member();
CREATE CONSTRAINT TRIGGER "personal_workspace_organization_cardinality"
AFTER INSERT OR UPDATE ON "organizations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_personal_workspace_exactly_one_member();

ALTER TABLE "outbox_events" ADD COLUMN "locked_at" TIMESTAMPTZ;
ALTER TABLE "outbox_events" ADD COLUMN "lease_expires_at" TIMESTAMPTZ;
CREATE INDEX "outbox_events_lease_expires_at_idx" ON "outbox_events"("lease_expires_at");
