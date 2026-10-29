import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { listApprovalQueue } from "@/modules/email/messages";
import { listEnquiries } from "@/modules/enquiries/service";
import { getOrganization, getStatuses } from "@/modules/orgs/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { formatInZone } from "@/lib/time";
import { approveAction, discardAction } from "../actions";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const { actor } = await requireApp();
  const queue = await listApprovalQueue(actor);
  const overdue = await listEnquiries(actor, { view: "overdue", sort: "follow_up", pageSize: 50 });
  const today = await listEnquiries(actor, { view: "due_today", sort: "follow_up", pageSize: 50 });
  const dueToday = today.rows.filter((r) => !overdue.rows.some((o) => o.id === r.id));
  const org = await getOrganization(actor);
  const statuses = await getStatuses(actor);
  const tz = org.timezone;

  return (
    <>
      <PageHeader title="Follow-ups" description="Messages waiting for your approval, and enquiries with a follow-up due." />
      {done && <div className="mb-4"><Notice tone="success">{done === "approved" ? "Approved and sent." : "Message discarded."}</Notice></div>}

      <Card className="mb-6">
        <CardHeader title="Waiting for approval" description={`${queue.length} message${queue.length === 1 ? "" : "s"}. Edit if you like, then approve to send.`} />
        {queue.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={20} />} title="All caught up" description="Automated messages that need a human check will appear here." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {queue.map((m) => (
              <li key={m.id} className="p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-ink-900">To {m.contactName ?? m.toEmail}</span>
                  {m.enquiryId && <Link href={`/app/enquiries/${m.enquiryId}`} className="text-brand-700">view enquiry</Link>}
                  {m.templateKey && <Badge>{m.templateKey.replace(/_/g, " ")}</Badge>}
                  {m.kind === "marketing" && <Badge tone="violet">Marketing</Badge>}
                  <span className="ml-auto text-xs text-ink-400">{formatInZone(m.createdAt, tz, "short")}</span>
                </div>
                {m.reviewFlags.length > 0 && (
                  <p className="mb-2 flex items-center gap-1 text-sm text-amber-700"><AlertTriangle size={14} aria-hidden /> Missing details: {m.reviewFlags.map((f) => f.split(":")[1]?.replace(/_/g, " ")).join(", ")}. Fill in the [placeholders] before approving.</p>
                )}
                <ActionForm action={approveAction} className="space-y-2">
                  <input type="hidden" name="messageId" value={m.id} />
                  <label htmlFor={`s-${m.id}`} className="sr-only">Subject</label>
                  <input id={`s-${m.id}`} name="subject" defaultValue={m.subject} className="block h-9 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-ink-300" />
                  <label htmlFor={`b-${m.id}`} className="sr-only">Message</label>
                  <textarea id={`b-${m.id}`} name="body" defaultValue={m.body} rows={6} className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300" />
                  <div className="flex gap-2">
                    <SubmitButton size="sm" pendingText="Sending…">Approve &amp; send</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={discardAction} className="mt-2">
                  <input type="hidden" name="messageId" value={m.id} />
                  <SubmitButton size="sm" variant="ghost">Discard</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {[
          { title: "Overdue", rows: overdue.rows, tone: "red" },
          { title: "Due today", rows: dueToday, tone: "amber" },
        ].map((col) => (
          <Card key={col.title}>
            <CardHeader title={col.title} description={`${col.rows.length}`} />
            {col.rows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-500">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {col.rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/app/enquiries/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-ink-50">
                      <span><span className="font-medium text-ink-900">{r.contactName}</span> · {r.subject}</span>
                      <span className="flex shrink-0 items-center gap-2"><StatusBadge statusKey={r.statusKey} statuses={statuses} /><Badge tone={col.tone}>{formatInZone(r.nextFollowUpAt!, tz, "short")}</Badge></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
