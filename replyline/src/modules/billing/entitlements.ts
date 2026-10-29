import { and, eq, sql } from "drizzle-orm";
import { schema, type TenantTx } from "@/lib/db";
import { PLANS, LAPSED_PLAN, planOrDefault, type Feature, type PlanDefinition, type UsageMetric } from "@/config/plans";
import { PlanLimitError } from "@/lib/errors";
import { usagePeriod } from "@/lib/time";

/*
 * Server-side entitlement enforcement. Every check reads the organisation's
 * plan from the database inside the caller's transaction — the browser never
 * tells us what plan it is on.
 */

type OrgRow = typeof schema.organizations.$inferSelect;

/** The plan actually in force, accounting for trial expiry and payment state. */
export function effectivePlan(org: Pick<OrgRow, "planKey" | "subscriptionStatus" | "trialEndsAt">, now = new Date()): PlanDefinition {
  const plan = planOrDefault(org.planKey);
  if (org.subscriptionStatus === "active") return plan;
  if (org.subscriptionStatus === "trialing" && org.trialEndsAt && org.trialEndsAt > now) return plan;
  // Trial ended without paying, payment failed, or cancelled: keep data, drop to the lapsed plan.
  return PLANS[LAPSED_PLAN];
}

export async function loadPlan(tx: TenantTx, orgId: string) {
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org) throw new Error("Organisation not found");
  return { org, plan: effectivePlan(org) };
}

export async function assertFeature(tx: TenantTx, orgId: string, feature: Feature, label: string) {
  const { plan } = await loadPlan(tx, orgId);
  if (!plan.features[feature]) {
    throw new PlanLimitError(`${label} is not included in the ${plan.name} plan. Upgrade to use it.`);
  }
}

export async function hasFeature(tx: TenantTx, orgId: string, feature: Feature) {
  const { plan } = await loadPlan(tx, orgId);
  return plan.features[feature];
}

/**
 * Atomically consume `amount` of a monthly allowance. The increment and the
 * check happen in one statement, so concurrent requests cannot overshoot.
 */
export async function consumeUsage(tx: TenantTx, orgId: string, metric: UsageMetric, amount = 1) {
  const { plan } = await loadPlan(tx, orgId);
  const limit = plan.limits.monthly[metric];
  const period = usagePeriod();
  const result = await tx.execute<{ count: number }>(sql`
    insert into usage_counters (org_id, period, metric, count) values (${orgId}, ${period}, ${metric}, ${amount})
    on conflict (org_id, period, metric) do update set count = usage_counters.count + ${amount}
      where usage_counters.count + ${amount} <= ${limit}
    returning count`);
  if (result.rows.length === 0 || amount > limit) {
    throw new PlanLimitError(`Monthly ${METRIC_LABELS[metric]} limit reached (${limit} on ${plan.name}). It resets on the 1st, or upgrade for more.`);
  }
}

export const METRIC_LABELS: Record<UsageMetric, string> = {
  ai_requests: "AI request",
  automation_runs: "automation run",
  emails_sent: "email",
};

export async function getUsage(tx: TenantTx, orgId: string) {
  const rows = await tx
    .select()
    .from(schema.usageCounters)
    .where(and(eq(schema.usageCounters.orgId, orgId), eq(schema.usageCounters.period, usagePeriod())));
  const out: Record<UsageMetric, number> = { ai_requests: 0, automation_runs: 0, emails_sent: 0 };
  for (const r of rows) out[r.metric as UsageMetric] = r.count;
  return out;
}

export async function assertSeatAvailable(tx: TenantTx, orgId: string, pendingInvites = 0) {
  const { plan } = await loadPlan(tx, orgId);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(eq(schema.memberships.orgId, orgId));
  if (n + pendingInvites >= plan.limits.users) {
    throw new PlanLimitError(`The ${plan.name} plan includes ${plan.limits.users} user${plan.limits.users === 1 ? "" : "s"}. Upgrade to add more.`);
  }
}
