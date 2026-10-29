import { Check } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { billingOverview } from "@/modules/billing/service";
import { METRIC_LABELS } from "@/modules/billing/entitlements";
import { can } from "@/modules/auth/permissions";
import { PLANS, PLAN_ORDER, formatPence, type UsageMetric } from "@/config/plans";
import { trialDaysLeft } from "@/modules/orgs/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { formatInZone } from "@/lib/time";
import { checkoutAction, devBillingStatusAction, portalAction } from "../actions";

export const metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await requireApp();
  const { org, plan, selected, usage, seats, provider } = await billingOverview(actor);
  const owner = can(actor.role, "billing.manage");
  const status = org.subscriptionStatus;
  return (
    <>
      <PageHeader title="Subscription and billing" description="Prices exclude VAT." />
      {sp.changed && <div className="mb-4"><Notice tone="success">Plan updated.</Notice></div>}
      {sp.checkout === "success" && <div className="mb-4"><Notice tone="success">Thanks — your subscription will update as soon as the payment provider confirms it.</Notice></div>}
      {provider === "dev" && <div className="mb-4"><Notice tone="warn" title="Test billing">Real payments aren&apos;t connected. Choosing a plan applies it immediately without charging anything.</Notice></div>}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Current plan" />
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="text-xl font-semibold">{selected?.name ?? plan.name}</span>
            <Badge tone={status === "active" ? "green" : status === "trialing" ? "blue" : "red"}>{status.replace("_", " ")}</Badge>
            {status === "trialing" && <span className="text-sm text-ink-500">{trialDaysLeft(org.trialEndsAt)} days left in trial</span>}
            {org.currentPeriodEnd && status === "active" && <span className="text-sm text-ink-500">Renews {formatInZone(org.currentPeriodEnd, org.timezone, "date")} · {org.billingInterval}</span>}
          </div>
          {plan.key !== org.planKey && <div className="px-5 pb-4"><Notice tone="warn">Your {selected?.name} subscription isn&apos;t active, so {plan.name} limits apply. Your data is kept.</Notice></div>}
          {owner && provider === "stripe" && org.stripeCustomerId && (
            <ActionForm action={portalAction} className="px-5 pb-4"><SubmitButton variant="secondary" size="sm">Manage payment method, invoices and cancellation</SubmitButton></ActionForm>
          )}
        </Card>
        <Card>
          <CardHeader title="This month's usage" />
          <ul className="space-y-2 px-5 py-4 text-sm">
            <li className="flex justify-between"><span>Users</span><span className="tabular-nums">{seats} / {plan.limits.users}</span></li>
            {(Object.keys(usage) as UsageMetric[]).map((m) => <li key={m} className="flex justify-between"><span className="capitalize">{METRIC_LABELS[m]}s</span><span className="tabular-nums">{usage[m]} / {plan.limits.monthly[m]}</span></li>)}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          const current = org.planKey === k && status === "active";
          return (
            <Card key={k} className={`flex flex-col p-6 ${current ? "ring-2 ring-brand-600" : ""}`}>
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="text-2xl font-semibold">{formatPence(p.pricePence.monthly)}<span className="text-sm font-normal text-ink-500">/mo</span></p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-700">
                {p.highlights.map((h) => <li key={h} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />{h}</li>)}
              </ul>
              {owner ? (
                current ? <Badge tone="green" className="mt-6 justify-center py-2">Current plan</Badge> : (
                  <div className="mt-6 grid grid-cols-2 gap-2">
                    {(["monthly", "annual"] as const).map((interval) => (
                      <ActionForm key={interval} action={checkoutAction}>
                        <input type="hidden" name="plan" value={k} />
                        <input type="hidden" name="interval" value={interval} />
                        <SubmitButton size="sm" variant={interval === "monthly" ? "primary" : "secondary"} className="w-full">{interval === "monthly" ? "Monthly" : `Annual ${formatPence(p.pricePence.annual)}`}</SubmitButton>
                      </ActionForm>
                    ))}
                  </div>
                )
              ) : <p className="mt-6 text-xs text-ink-500">Only the owner can change plans.</p>}
            </Card>
          );
        })}
      </div>

      {owner && provider === "dev" && (
        <Card className="mt-6 p-5">
          <div className="text-sm font-semibold">Simulate billing events (development only)</div>
          <p className="mt-1 text-sm text-ink-500">Check what customers see when a payment fails or they cancel.</p>
          <ActionForm action={devBillingStatusAction} className="mt-3 flex flex-wrap gap-2">
            <SubmitButton size="sm" variant="secondary" name="status" value="past_due">Payment failed</SubmitButton>
            <SubmitButton size="sm" variant="secondary" name="status" value="canceled">Cancelled</SubmitButton>
            <SubmitButton size="sm" variant="secondary" name="status" value="active">Active again</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
