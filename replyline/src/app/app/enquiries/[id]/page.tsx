import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Copy, Mail, Phone } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnquiry } from "@/modules/enquiries/service";
import { getOrganization, getStatuses } from "@/modules/orgs/service";
import { listMembers } from "@/modules/team/service";
import { listTemplates } from "@/modules/templates/service";
import { isSuppressed } from "@/modules/compliance/suppression";
import { getAiProvider } from "@/modules/ai/provider";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, ButtonLink, Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { MessageStatusBadge, PriorityBadge, StatusBadge } from "@/components/status";
import { formatInZone } from "@/lib/time";
import { DateTime } from "luxon";
import { addNoteAction, logReplyAction, resolveDuplicateAction, updateEnquiryAction } from "../../actions";
import { Composer } from "./composer";

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  let data;
  try {
    data = await getEnquiry(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { enquiry, contact, notes, messages, activities, appointments, runs } = data;
  const [org, statuses, team, templates] = [await getOrganization(actor), await getStatuses(actor), await listMembers(actor), await listTemplates(actor)];
  const tz = org.timezone;
  const suppressed = contact.email ? await withTenant(actor, (tx) => isSuppressed(tx, contact.email!, "transactional")) : false;
  const blockedReason = !contact.email ? "This contact has no email address — add one on their contact page to reply by email." : suppressed ? "This address has opted out of emails from you." : contact.erasedAt ? "This contact's data has been erased." : null;
  const followUpLocal = enquiry.nextFollowUpAt ? DateTime.fromJSDate(enquiry.nextFollowUpAt, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm") : "";

  // One merged timeline, newest first.
  const timeline = [
    ...messages.filter((m) => m.status !== "draft").map((m) => ({ at: m.createdAt, kind: "message" as const, m })),
    ...activities.filter((a) => !a.type.startsWith("email.")).map((a) => ({ at: a.createdAt, kind: "activity" as const, a })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
  const drafts = messages.filter((m) => m.status === "draft");

  return (
    <>
      <div className="mb-6">
        <Link href="/app/enquiries" className="text-sm text-ink-500 hover:text-ink-800">← Enquiries</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950">{enquiry.subject}</h1>
          <StatusBadge statusKey={enquiry.statusKey} statuses={statuses} />
          <PriorityBadge priority={enquiry.priority} />
        </div>
        <p className="mt-1 text-sm text-ink-500">From {contact.name} via {enquiry.source} · received {formatInZone(enquiry.createdAt, tz)}</p>
      </div>

      {enquiry.possibleDuplicateOfId && (
        <div className="mb-6">
          <Notice tone="warn" title="Possible duplicate">
            This customer has another open enquiry from the last two weeks: <Link className="underline" href={`/app/enquiries/${enquiry.possibleDuplicateOfId}`}>view it</Link>. Nothing has been merged.
            <ActionForm action={resolveDuplicateAction} className="mt-2 flex gap-2">
              <input type="hidden" name="id" value={enquiry.id} />
              <SubmitButton size="sm" variant="secondary" name="resolution" value="not_duplicate">Not a duplicate</SubmitButton>
              <SubmitButton size="sm" variant="secondary" name="resolution" value="close_as_duplicate">Close this one as duplicate</SubmitButton>
            </ActionForm>
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Customer's message" />
            <div className="whitespace-pre-wrap px-5 py-4 text-sm leading-6 text-ink-800">{enquiry.message || <span className="text-ink-400">No message text.</span>}</div>
          </Card>

          <Card>
            <CardHeader title="Reply" description="Nothing is sent until you press Send." />
            <div className="p-5">
              <Composer
                enquiryId={enquiry.id}
                templates={templates.map((t) => ({ key: t.key, name: t.name, subject: t.subject, body: t.body, kind: t.kind }))}
                canSend={!blockedReason}
                blockedReason={blockedReason}
                aiExternal={getAiProvider().external}
              />
              {drafts.length > 0 && (
                <div className="mt-4 border-t border-ink-100 pt-3 text-sm">
                  <div className="font-medium text-ink-700">Saved drafts</div>
                  <ul className="mt-1 space-y-1">{drafts.map((d) => <li key={d.id} className="text-ink-600">{d.subject} <Link className="text-brand-700" href="/app/follow-ups">— open in Follow-ups</Link></li>)}</ul>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" description={`${timeline.length} events`} />
            <ol className="divide-y divide-ink-100">
              {timeline.map((t) =>
                t.kind === "message" ? (
                  <li key={`m-${t.m.id}`} className={`px-5 py-4 ${t.m.direction === "inbound" ? "bg-violet-50/40" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Mail size={14} className="text-ink-400" aria-hidden />
                      <span className="font-medium text-ink-900">{t.m.direction === "inbound" ? `${contact.name} replied` : "Email to customer"}</span>
                      <MessageStatusBadge status={t.m.status} />
                      {t.m.aiGenerated && <Badge tone="violet">AI-assisted</Badge>}
                      {t.m.workflowRunId && <Badge>Automated</Badge>}
                      <time className="ml-auto text-xs text-ink-400">{formatInZone(t.m.sentAt ?? t.m.createdAt, tz, "short")}</time>
                    </div>
                    <div className="mt-1 text-sm font-medium text-ink-800">{t.m.subject}</div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-ink-500">Show message</summary>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{t.m.body}</div>
                    </details>
                    {t.m.error && <p className="mt-1 text-xs text-red-600">{t.m.error}</p>}
                  </li>
                ) : (
                  <li key={`a-${t.a.id}`} className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm">
                    <span className="text-ink-600">{t.a.summary}</span>
                    <time className="shrink-0 text-xs text-ink-400">{formatInZone(t.a.createdAt, tz, "short")}</time>
                  </li>
                ),
              )}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <ActionForm action={updateEnquiryAction} className="space-y-4 p-5">
              <input type="hidden" name="id" value={enquiry.id} />
              <Field id="statusKey" label="Status">
                <Select id="statusKey" name="statusKey" defaultValue={enquiry.statusKey}>
                  {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="priority" label="Priority">
                  <Select id="priority" name="priority" defaultValue={enquiry.priority}>
                    {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                  </Select>
                </Field>
                <Field id="category" label="Category">
                  <Select id="category" name="category" defaultValue={enquiry.category ?? ""}>
                    <option value="">—</option>
                    {org.settings.categories.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>
              <Field id="assignedUserId" label="Assigned to">
                <Select id="assignedUserId" name="assignedUserId" defaultValue={enquiry.assignedUserId ?? ""}>
                  <option value="">Unassigned</option>
                  {team.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </Select>
              </Field>
              <Field id="nextFollowUpAt" label="Next follow-up" hint={`(${tz})`}>
                <Input id="nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" defaultValue={followUpLocal} />
              </Field>
              <SubmitButton size="sm">Save</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Customer" action={<Link href={`/app/contacts/${contact.id}`} className="text-sm text-brand-700">Open</Link>} />
            <div className="space-y-1.5 px-5 py-4 text-sm">
              <div className="font-medium text-ink-900">{contact.name}</div>
              {contact.company && <div className="text-ink-600">{contact.company}</div>}
              {contact.email && <div className="flex items-center gap-2 text-ink-600"><Mail size={14} aria-hidden /> {contact.email}</div>}
              {contact.phone && <div className="flex items-center gap-2 text-ink-600"><Phone size={14} aria-hidden /> <a href={`tel:${contact.phone}`}>{contact.phone}</a></div>}
              <div className="pt-1">
                <Badge tone={contact.marketingConsent === "granted" ? "green" : contact.marketingConsent === "withdrawn" ? "red" : "slate"}>Marketing: {contact.marketingConsent}</Badge>
                {suppressed && <Badge tone="red" className="ml-1">Opted out</Badge>}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Appointments" action={<ButtonLink size="sm" variant="secondary" href={`/app/appointments/new?enquiryId=${enquiry.id}&contactId=${contact.id}`}><CalendarPlus size={14} aria-hidden /> Book</ButtonLink>} />
            {appointments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {appointments.map((a) => (
                  <li key={a.id}><Link href={`/app/appointments/${a.id}`} className="block px-5 py-3 text-sm hover:bg-ink-50"><div className="font-medium">{a.title}</div><div className="text-ink-500">{formatInZone(a.startsAt, a.timezone)} · {a.status}</div></Link></li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Automations" />
            {runs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">No workflows have run for this enquiry.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {runs.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2"><span className="text-ink-800">{r.name}</span><Badge tone={r.status === "running" ? "blue" : r.status === "completed" ? "green" : r.status === "failed" ? "red" : "slate"}>{r.status}</Badge></div>
                    {r.stopReason && <div className="text-xs text-ink-500">{r.stopReason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Log a customer reply" description="Got a reply by phone or in your inbox? Log it here to stop follow-ups." />
            <ActionForm action={logReplyAction} className="space-y-3 p-5" resetOnSuccess>
              <input type="hidden" name="id" value={enquiry.id} />
              <label htmlFor="reply-body" className="sr-only">Reply</label>
              <Textarea id="reply-body" name="body" rows={3} placeholder="Paste or summarise what they said" required />
              <SubmitButton size="sm" variant="secondary">Log reply</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Internal notes" description="Never sent to the customer." />
            <ActionForm action={addNoteAction} className="space-y-3 px-5 pt-4" resetOnSuccess showSuccess={false}>
              <input type="hidden" name="id" value={enquiry.id} />
              <label htmlFor="note-body" className="sr-only">Note</label>
              <Textarea id="note-body" name="body" rows={2} placeholder="Add a note" required />
              <SubmitButton size="sm" variant="secondary">Add note</SubmitButton>
            </ActionForm>
            <ul className="divide-y divide-ink-100 px-5 pb-2 pt-3">
              {notes.map((n) => (
                <li key={n.id} className="py-2 text-sm">
                  <div className="whitespace-pre-wrap text-ink-800">{n.body}</div>
                  <div className="text-xs text-ink-400">{n.authorName ?? "Someone"} · {formatInZone(n.createdAt, tz, "short")}</div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="flex items-center gap-1 text-xs text-ink-400"><Copy size={12} aria-hidden /> ID {enquiry.id}</p>
        </div>
      </div>
    </>
  );
}
