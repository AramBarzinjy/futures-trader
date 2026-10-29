import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/brand";
import { requireApp } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { env } from "@/lib/env";
import { effectivePlan } from "@/modules/billing/entitlements";
import { trialDaysLeft } from "@/modules/orgs/service";
import { signOutAction, switchOrgAction } from "../(auth)/actions";
import { AppNav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireApp();
  const { org, followUps, failed } = await withTenant(ctx.actor, async (tx) => {
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, ctx.actor.orgId) }))!;
    const [{ n: followUps }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.messages).where(eq(schema.messages.status, "pending_approval"));
    const [{ n: failed }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.jobs).where(eq(schema.jobs.status, "dead"));
    return { org, followUps, failed };
  });
  const plan = effectivePlan(org);
  const days = org.subscriptionStatus === "trialing" ? trialDaysLeft(org.trialEndsAt) : null;
  const e = env();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="hidden flex-col bg-ink-950 px-3 py-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div className="px-2 pb-5"><Logo href="/app" inverted /></div>
        <div className="flex-1 overflow-y-auto">
          <AppNav badges={{ followUps, failed }} showOutbox={e.EMAIL_PROVIDER === "simulated"} />
        </div>
        <div className="mt-4 border-t border-white/10 px-2 pt-4 text-sm">
          {ctx.orgs.length > 1 ? (
            <form action={switchOrgAction}>
              <label htmlFor="org-switch" className="sr-only">Workspace</label>
              <select id="org-switch" name="orgId" defaultValue={ctx.actor.orgId} className="w-full rounded-md bg-white/10 px-2 py-1.5 text-white">
                {ctx.orgs.map((o) => <option key={o.orgId} value={o.orgId} className="text-ink-900">{o.name}</option>)}
              </select>
              <button className="mt-1 text-xs text-ink-400 hover:text-white">Switch workspace</button>
            </form>
          ) : (
            <div className="truncate font-medium text-white">{ctx.orgName}</div>
          )}
          <div className="mt-1 truncate text-xs text-ink-400">{ctx.user.name} · {ctx.role}</div>
          <form action={signOutAction} className="mt-3">
            <button className="flex items-center gap-2 text-xs text-ink-400 hover:text-white"><LogOut size={14} aria-hidden /> Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
          <AppNav badges={{ followUps, failed }} showOutbox={e.EMAIL_PROVIDER === "simulated"} />
          <Logo href="/app" />
          <form action={signOutAction}><button className="p-2 text-ink-500" aria-label="Sign out"><LogOut size={18} /></button></form>
        </header>
        {(days !== null || e.EMAIL_PROVIDER === "simulated" || plan.key !== org.planKey) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ink-200 bg-white px-4 py-2 text-xs text-ink-600 sm:px-8">
            {days !== null && (
              <span>Growth trial · <strong>{days} day{days === 1 ? "" : "s"} left</strong> · <Link className="text-brand-700 underline" href="/app/billing">Choose a plan</Link></span>
            )}
            {plan.key !== org.planKey && (
              <span className="text-amber-700">Your subscription isn&apos;t active, so Starter limits apply. <Link className="underline" href="/app/billing">Fix billing</Link></span>
            )}
            {e.EMAIL_PROVIDER === "simulated" && (
              <span>Email is in <strong>simulated mode</strong> — nothing reaches real customers. <Link className="text-brand-700 underline" href="/app/outbox">View outbox</Link></span>
            )}
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
