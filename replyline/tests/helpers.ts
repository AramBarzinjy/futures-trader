import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, systemDb } from "@/lib/db";
import { signUp } from "@/modules/auth/service";
import { createOrganization } from "@/modules/orgs/service";
import type { Actor } from "@/modules/auth/permissions";
import type { PlanKey } from "@/config/plans";
import { runDueJobs } from "@/worker/process";

/** A fresh user + workspace. Unique emails so tests don't collide. */
export async function makeWorkspace(opts: { name?: string; plan?: PlanKey; industry?: "trades" | "property" } = {}) {
  const email = `owner-${randomUUID().slice(0, 8)}@example.test`;
  const { userId } = await signUp({ name: "Test Owner", email, password: "correct horse battery" }, `ip-${randomUUID()}`);
  const orgId = await createOrganization(userId, { name: opts.name ?? "Test Plumbing", industry: opts.industry ?? "trades", timezone: "Europe/London" });
  if (opts.plan) await setPlan(orgId, opts.plan);
  // Make every day a working day so delayed steps are predictable in tests.
  const allDay = { open: "00:00", close: "23:59" };
  await systemDb()
    .update(schema.organizations)
    .set({ email: "office@example.test", phone: "01632 960001", bookingLink: "https://example.test/book", businessHours: { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay } })
    .where(eq(schema.organizations.id, orgId));
  const actor: Actor = { orgId, userId, role: "owner" };
  return { orgId, userId, email, actor };
}

export async function setPlan(orgId: string, plan: PlanKey, status = "active") {
  await systemDb().update(schema.organizations).set({ planKey: plan, subscriptionStatus: status }).where(eq(schema.organizations.id, orgId));
}

/** Pretend time has passed: make every queued job due now, then run the worker. */
export async function fastForward(rounds = 3) {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    await systemDb().execute(sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`);
    const r = await runDueJobs(500);
    total += r.processed;
    if (!r.processed) break;
  }
  return total;
}

/** Run only jobs that are already due (no time travel). */
export const runNow = () => runDueJobs(500);

export async function messagesFor(orgId: string) {
  return systemDb().select().from(schema.messages).where(eq(schema.messages.orgId, orgId));
}

export async function setWorkflow(orgId: string, templateKey: string, values: Partial<typeof schema.workflows.$inferInsert>) {
  await systemDb()
    .update(schema.workflows)
    .set(values)
    .where(sql`${schema.workflows.orgId} = ${orgId} and ${schema.workflows.templateKey} = ${templateKey}`);
}
