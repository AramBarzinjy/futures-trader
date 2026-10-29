import { eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { emailHash, parseUnsubscribeToken } from "@/modules/compliance/suppression";
import { redirect } from "next/navigation";
import { systemActor } from "@/modules/auth/permissions";
import { Logo } from "@/components/brand";
import { Notice } from "@/components/ui";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/*
 * One-click unsubscribe. GET only shows a confirmation button, because email
 * security scanners pre-fetch links; the opt-out happens on POST.
 */
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const parsed = parseUnsubscribeToken(token);
  const org = parsed ? await systemDb().query.organizations.findFirst({ where: eq(schema.organizations.id, parsed.orgId), columns: { name: true } }) : null;

  async function confirm() {
    "use server";
    const p = parseUnsubscribeToken(token);
    if (!p) return;
    await withTenant(systemActor(p.orgId), async (tx) => {
      await tx.insert(schema.suppressions).values({ orgId: p.orgId, emailHash: p.hash, scope: p.scope, reason: "unsubscribe" }).onConflictDoNothing();
      // Withdraw marketing consent on the matching contact too, if we still hold it.
      if (p.scope === "marketing" || p.scope === "all") {
        const contacts = await tx.query.contacts.findMany({ columns: { id: true, emailNormalised: true } });
        for (const c of contacts) {
          if (c.emailNormalised && emailHash(c.emailNormalised) === p.hash) {
            await tx.update(schema.contacts).set({ marketingConsent: "withdrawn", consentSource: "Unsubscribe link", consentAt: new Date() }).where(eq(schema.contacts.id, c.id));
          }
        }
      }
    });
    redirect(`/u/${token}?done=1`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4">
      <Logo />
      <div className="mt-8 w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-ink-200">
        {!parsed || !org ? (
          <Notice tone="error">This link isn&apos;t valid. If you keep receiving emails you don&apos;t want, reply to one and ask to be removed.</Notice>
        ) : done ? (
          <Notice tone="success" title="You're unsubscribed">{org.name} won&apos;t send you {parsed.scope === "marketing" ? "marketing emails" : "further follow-up emails"}.</Notice>
        ) : (
          <>
            <h1 className="text-lg font-semibold">{parsed.scope === "marketing" ? `Stop marketing emails from ${org.name}?` : `Stop follow-up emails from ${org.name}?`}</h1>
            <form action={confirm} className="mt-6">
              <button className="h-10 w-full rounded-lg bg-brand-600 font-medium text-white hover:bg-brand-700">Yes, unsubscribe me</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
