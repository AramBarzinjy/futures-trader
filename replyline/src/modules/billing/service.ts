import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, systemDb, withTenant } from "@/lib/db";
import { env, isDevLike } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { PLANS, PLAN_ORDER, type BillingInterval, type PlanKey } from "@/config/plans";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { audit } from "@/modules/audit/service";
import { effectivePlan, getUsage } from "./entitlements";

/*
 * Subscription billing.
 * - dev:    plan changes apply instantly with no payment. Refused in production.
 * - stripe: Stripe Checkout + Customer Portal + signed webhooks. Implemented
 *           against Stripe's documented API and unit-tested with signed test
 *           payloads; NOT yet verified against a live Stripe account.
 *
 * The plan a workspace is on only ever changes server-side: from the dev
 * provider, or from a verified Stripe webhook. Never from the browser.
 */

export async function billingOverview(actor: Actor) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) }))!;
    const usage = await getUsage(tx, actor.orgId);
    const [{ seats }] = await tx.select({ seats: sql<number>`count(*)::int` }).from(schema.memberships).where(eq(schema.memberships.orgId, actor.orgId));
    return { org, plan: effectivePlan(org), selected: PLANS[org.planKey as PlanKey], usage, seats, provider: env().BILLING_PROVIDER };
  });
}

export const checkoutSchema = z.object({ plan: z.enum(PLAN_ORDER as [PlanKey, ...PlanKey[]]), interval: z.enum(["monthly", "annual"]) });

/** Start a plan change. Returns a URL to redirect to (Stripe Checkout, or back to the app in dev). */
export async function startCheckout(actor: Actor, input: z.input<typeof checkoutSchema>): Promise<string> {
  assertCan(actor, "billing.manage");
  const { plan, interval } = checkoutSchema.parse(input);
  const e = env();
  if (e.BILLING_PROVIDER === "dev") {
    if (!isDevLike() && e.APP_ENV !== "staging") throw new AppError("Development billing is disabled here.");
    await withTenant(actor, async (tx) => {
      await tx
        .update(schema.organizations)
        .set({ planKey: plan, billingInterval: interval, subscriptionStatus: "active", currentPeriodEnd: new Date(Date.now() + (interval === "annual" ? 365 : 30) * 86_400_000) })
        .where(eq(schema.organizations.id, actor.orgId));
      await audit(tx, actor, "billing.plan_changed_dev", undefined, { plan, interval });
    });
    return "/app/billing?changed=1";
  }
  const price = priceId(plan, interval);
  const org = await withTenant(actor, async (tx) => (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) }))!);
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${e.APP_URL}/app/billing?checkout=success`,
    cancel_url: `${e.APP_URL}/app/billing?checkout=cancelled`,
    client_reference_id: actor.orgId,
    "subscription_data[metadata][org_id]": actor.orgId,
    "metadata[org_id]": actor.orgId,
  });
  if (org.stripeCustomerId) params.set("customer", org.stripeCustomerId);
  const session = await stripeRequest<{ url: string }>("/v1/checkout/sessions", params);
  return session.url;
}

export async function openBillingPortal(actor: Actor): Promise<string> {
  assertCan(actor, "billing.manage");
  const e = env();
  if (e.BILLING_PROVIDER === "dev") return "/app/billing";
  const org = await withTenant(actor, async (tx) => (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) }))!);
  if (!org.stripeCustomerId) throw new AppError("No billing account yet — choose a plan first.");
  const s = await stripeRequest<{ url: string }>("/v1/billing_portal/sessions", new URLSearchParams({ customer: org.stripeCustomerId, return_url: `${e.APP_URL}/app/billing` }));
  return s.url;
}

/** Dev-only: simulate cancellation / payment failure, to exercise the downgrade paths. */
export async function devSetStatus(actor: Actor, status: "active" | "past_due" | "canceled") {
  assertCan(actor, "billing.manage");
  if (env().BILLING_PROVIDER !== "dev") throw new AppError("Only available with development billing.");
  await withTenant(actor, async (tx) => {
    await tx.update(schema.organizations).set({ subscriptionStatus: status }).where(eq(schema.organizations.id, actor.orgId));
    await audit(tx, actor, "billing.status_changed_dev", undefined, { status });
  });
}

function priceId(plan: PlanKey, interval: BillingInterval): string {
  const id = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`];
  if (!id) throw new AppError("This plan isn't set up for payment yet.");
  return id;
}

function planFromPrice(price: string): { plan: PlanKey; interval: BillingInterval } | null {
  for (const plan of PLAN_ORDER) for (const interval of ["monthly", "annual"] as const) {
    if (process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`] === price) return { plan, interval };
  }
  return null;
}

async function stripeRequest<T>(path: string, body: URLSearchParams): Promise<T> {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new AppError("Stripe isn't configured.");
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new AppError(`Payment provider error (HTTP ${res.status}). Please try again.`);
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------ webhooks

const TOLERANCE_SECONDS = 300;

/** Verify a Stripe-Signature header (HMAC-SHA256 over "t.payload", timestamp tolerance). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => Buffer.from(kv.slice(3), "hex"));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const STATUS_MAP: Record<string, string> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "past_due",
  incomplete_expired: "canceled",
};

/**
 * Apply a verified webhook. Idempotent: each event id is recorded and a
 * repeat delivery is acknowledged without being applied twice.
 */
export async function handleStripeWebhook(payload: string, signature: string | null): Promise<{ status: number; body: string }> {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return { status: 500, body: "Webhook secret not configured" };
  if (!verifyStripeSignature(payload, signature, secret)) return { status: 400, body: "Invalid signature" };
  const event = JSON.parse(payload) as StripeEvent;
  const obj = event.data.object;

  return systemDb().transaction(async (tx) => {
    const [fresh] = await tx.insert(schema.billingEvents).values({ providerEventId: event.id, type: event.type }).onConflictDoNothing().returning();
    if (!fresh) return { status: 200, body: "Already processed" };

    if (event.type === "checkout.session.completed") {
      const orgId = (obj.metadata as Record<string, string> | undefined)?.org_id ?? (obj.client_reference_id as string | undefined);
      if (orgId) {
        await tx.update(schema.organizations).set({ stripeCustomerId: String(obj.customer), stripeSubscriptionId: String(obj.subscription) }).where(eq(schema.organizations.id, orgId));
        await tx.update(schema.billingEvents).set({ orgId }).where(eq(schema.billingEvents.providerEventId, event.id));
      }
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const orgId = (obj.metadata as Record<string, string> | undefined)?.org_id;
      const items = (obj.items as { data: { price: { id: string } }[] } | undefined)?.data ?? [];
      const mapped = items[0] ? planFromPrice(items[0].price.id) : null;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : STATUS_MAP[String(obj.status)] ?? "past_due";
      const periodEnd = typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000) : null;
      const where = orgId ? eq(schema.organizations.id, orgId) : eq(schema.organizations.stripeCustomerId, String(obj.customer));
      await tx
        .update(schema.organizations)
        .set({
          subscriptionStatus: status,
          stripeSubscriptionId: String(obj.id),
          ...(mapped ? { planKey: mapped.plan, billingInterval: mapped.interval } : {}),
          ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
        })
        .where(where);
    }

    if (event.type === "invoice.payment_failed") {
      await tx.update(schema.organizations).set({ subscriptionStatus: "past_due" }).where(eq(schema.organizations.stripeCustomerId, String(obj.customer)));
    }
    return { status: 200, body: "ok" };
  });
}
