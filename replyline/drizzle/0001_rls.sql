-- Row-level security. The application role (replyline_app) can only ever see
-- rows whose org_id equals the app.org_id setting of its current transaction.
-- The role must exist before this runs (see docs/SETUP.md); it must NOT be the
-- table owner and must NOT have BYPASSRLS, or these policies do nothing.

CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO replyline_app;
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitations" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "pipeline_statuses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pipeline_statuses" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pipeline_statuses" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_field_definitions" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field_definitions" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contacts" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "contacts" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "enquiries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "enquiries" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "enquiries" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notes" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notes" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "activities" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "activities" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "email_templates" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_templates" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "messages" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "suppressions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "suppressions" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "suppressions" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appointments" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointments" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflows" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "workflows" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflow_runs" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_runs" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "jobs" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "jobs" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reports" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "reports" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "usage_counters" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_counters" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_logs" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_logs" TO replyline_app;
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integrations" FOR ALL TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "integrations" TO replyline_app;
--> statement-breakpoint
-- Memberships: visible to the current org, plus the signed-in user's own rows
-- (needed to list the workspaces a user belongs to before one is chosen).
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_read ON "memberships" FOR SELECT TO replyline_app
  USING (org_id = app_org_id() OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY membership_write ON "memberships" FOR INSERT TO replyline_app WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
CREATE POLICY membership_update ON "memberships" FOR UPDATE TO replyline_app
  USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
CREATE POLICY membership_delete ON "memberships" FOR DELETE TO replyline_app USING (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO replyline_app;
--> statement-breakpoint
-- Organizations: read your current org and any you belong to; write only the current one.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_read ON "organizations" FOR SELECT TO replyline_app
  USING (id = app_org_id() OR id IN (SELECT org_id FROM memberships WHERE user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY org_insert ON "organizations" FOR INSERT TO replyline_app WITH CHECK (id = app_org_id());
--> statement-breakpoint
CREATE POLICY org_update ON "organizations" FOR UPDATE TO replyline_app
  USING (id = app_org_id()) WITH CHECK (id = app_org_id());
--> statement-breakpoint
CREATE POLICY org_delete ON "organizations" FOR DELETE TO replyline_app USING (id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organizations" TO replyline_app;
--> statement-breakpoint
-- Users: the app role may read names/emails of the current user and of members of
-- the current org. It cannot read password hashes at all (column-level grant).
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_read ON "users" FOR SELECT TO replyline_app
  USING (id = app_user_id() OR id IN (SELECT user_id FROM memberships WHERE org_id = app_org_id()));
--> statement-breakpoint
GRANT SELECT (id, email, name, created_at) ON "users" TO replyline_app;
--> statement-breakpoint
-- sessions, rate_limits, billing_events: no grants. Only the owner role touches them.
