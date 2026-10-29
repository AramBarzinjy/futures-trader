import { CalendarDays, Code2, CreditCard, Mail, Sparkles, Webhook } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getOrganization } from "@/modules/orgs/service";
import { effectivePlan } from "@/modules/billing/entitlements";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";

export const metadata = { title: "Integrations" };

/*
 * Honest status page. Each integration says what it does today, and only
 * "Working" ones are claimed to work. Setup steps live in docs/INTEGRATIONS.md.
 */
export default async function IntegrationsPage() {
  const { actor } = await requireApp();
  const org = await getOrganization(actor);
  const plan = effectivePlan(org);
  const e = env();
  const formUrl = `${e.APP_URL}/f/${org.formKey}`;
  const embed = `<iframe src="${formUrl}" title="Enquiry form" style="width:100%;min-height:640px;border:0"></iframe>`;

  const rows = [
    { icon: Mail, name: "Email sending", status: e.EMAIL_PROVIDER === "simulated" ? ["Simulated", "amber"] : ["Resend — configured", "green"], body: e.EMAIL_PROVIDER === "simulated" ? "Emails are recorded in the Outbox and not delivered. To send for real, your administrator connects a Resend account (docs/INTEGRATIONS.md)." : "Emails are delivered via Resend from your verified domain, with replies going to your reply-to address." },
    { icon: Webhook, name: "Inbound email forwarding", status: plan.features.automatedCapture ? ["Available", "green"] : ["Growth plan", "slate"], body: "Customer replies and new enquiries can be posted to the inbound webhook by an email provider (e.g. Postmark or Resend inbound). Replies are threaded and stop follow-ups. Requires setup by your administrator." },
    { icon: Mail, name: "Gmail / Microsoft 365 mailbox", status: ["Planned", "slate"], body: "Sending from and reading your own mailbox needs OAuth app approval from Google and Microsoft. Not built yet — see the roadmap." },
    { icon: CalendarDays, name: "Google / Outlook Calendar sync", status: ["Planned", "slate"], body: "Not built yet. Today every appointment has an \"Add to calendar\" (.ics) download that works with any calendar." },
    { icon: Sparkles, name: "AI drafting", status: e.AI_PROVIDER === "mock" ? ["Demo mode", "amber"] : ["Claude — configured", "green"], body: e.AI_PROVIDER === "mock" ? "Drafts are produced by a simple local generator so you can try the workflow. No data leaves the server." : "Drafts are written by Claude (Anthropic) when you click a draft button. Enquiry text is sent only for that request." },
    { icon: CreditCard, name: "Payments", status: e.BILLING_PROVIDER === "dev" ? ["Test mode", "amber"] : ["Stripe — configured", "green"], body: e.BILLING_PROVIDER === "dev" ? "Plan changes apply instantly with no payment taken." : "Subscriptions are billed through Stripe Checkout." },
  ] as const;

  return (
    <>
      <PageHeader title="Integrations" description="What's connected, and what each connection actually does today." />
      <Card className="mb-6">
        <CardHeader title={<span className="flex items-center gap-2"><Code2 size={16} aria-hidden /> Website enquiry form</span>} description="Working. Submissions become enquiries and start your workflows. Spam protection and rate limits are built in." />
        <div className="space-y-4 p-5 text-sm">
          <div>
            <div className="mb-1 font-medium">Direct link</div>
            <code className="block overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs">{formUrl}</code>
          </div>
          <div>
            <div className="mb-1 font-medium">Embed on your website</div>
            <code className="block overflow-x-auto whitespace-pre rounded-lg bg-ink-50 p-3 text-xs">{embed}</code>
          </div>
          <div>
            <div className="mb-1 font-medium">Or post from your own form</div>
            <code className="block overflow-x-auto whitespace-pre rounded-lg bg-ink-50 p-3 text-xs">{`POST ${e.APP_URL}/api/public/enquiries/${org.formKey}
Content-Type: application/json
{"name":"…","email":"…","phone":"…","message":"…","marketingConsent":false}`}</code>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.name} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold"><r.icon size={18} className="text-ink-500" aria-hidden /> {r.name}</div>
              <Badge tone={r.status[1]}>{r.status[0]}</Badge>
            </div>
            <p className="mt-2 text-sm text-ink-600">{r.body}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
