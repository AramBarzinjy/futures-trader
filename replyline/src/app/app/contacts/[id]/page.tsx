import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getContact } from "@/modules/contacts/service";
import { getOrganization, getStatuses } from "@/modules/orgs/service";
import { can } from "@/modules/auth/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, ButtonLink, Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { formatInZone } from "@/lib/time";
import { consentAction, eraseContactAction, updateContactAction } from "../../actions";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  let data;
  try {
    data = await getContact(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { contact, enquiries } = data;
  const org = await getOrganization(actor);
  const statuses = await getStatuses(actor);
  return (
    <>
      <Link href="/app/contacts" className="text-sm text-ink-500 hover:text-ink-800">← Contacts</Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{contact.name}</h1>
      {contact.erasedAt && <div className="mt-4"><Notice tone="warn">This contact&apos;s personal data was erased on {formatInZone(contact.erasedAt, org.timezone, "date")}.</Notice></div>}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Enquiries" action={<ButtonLink size="sm" variant="secondary" href={`/app/appointments/new?contactId=${contact.id}`}>Book appointment</ButtonLink>} />
            <ul className="divide-y divide-ink-100">
              {enquiries.map((e) => (
                <li key={e.id}>
                  <Link href={`/app/enquiries/${e.id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-ink-50">
                    <span><span className="font-medium text-ink-900">{e.subject}</span> <span className="text-ink-500">· {formatInZone(e.createdAt, org.timezone, "short")}</span></span>
                    <StatusBadge statusKey={e.statusKey} statuses={statuses} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {!contact.erasedAt && (
            <Card>
              <CardHeader title="Details" description="Editing here is the only way stored details change — imports and forms never overwrite them." />
              <ActionForm action={updateContactAction} className="grid gap-4 p-5 sm:grid-cols-2">
                <input type="hidden" name="id" value={contact.id} />
                <Field id="name" label="Name"><Input id="name" name="name" defaultValue={contact.name} required /></Field>
                <Field id="company" label="Company"><Input id="company" name="company" defaultValue={contact.company ?? ""} /></Field>
                <Field id="email" label="Email"><Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} /></Field>
                <Field id="phone" label="Phone"><Input id="phone" name="phone" defaultValue={contact.phone ?? ""} /></Field>
                <div className="sm:col-span-2"><Field id="notes" label="Notes"><Textarea id="notes" name="notes" defaultValue={contact.notes ?? ""} /></Field></div>
                <div><SubmitButton size="sm">Save contact</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Marketing consent" />
            <div className="space-y-3 p-5 text-sm">
              <div>
                <Badge tone={contact.marketingConsent === "granted" ? "green" : contact.marketingConsent === "withdrawn" ? "red" : "slate"}>{contact.marketingConsent}</Badge>
                {contact.consentAt && <p className="mt-1 text-xs text-ink-500">{contact.consentSource} · {formatInZone(contact.consentAt, org.timezone, "short")}</p>}
              </div>
              <p className="text-ink-500">Needed only for marketing (e.g. re-engaging old prospects). Replies about their own enquiry don&apos;t need it.</p>
              {!contact.erasedAt && (
                <ActionForm action={consentAction} className="space-y-2">
                  <input type="hidden" name="id" value={contact.id} />
                  <Field id="consent" label="Change to">
                    <Select id="consent" name="consent" defaultValue="granted"><option value="granted">Granted</option><option value="withdrawn">Withdrawn</option></Select>
                  </Field>
                  <Field id="source" label="How was this given?"><Input id="source" name="source" placeholder="e.g. Ticked box on quote form" required /></Field>
                  <SubmitButton size="sm" variant="secondary">Record</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
          {can(actor.role, "data.erase_contact") && !contact.erasedAt && (
            <Card>
              <CardHeader title="Data requests" description="UK GDPR subject access and erasure." />
              <div className="space-y-4 p-5 text-sm">
                <ButtonLink size="sm" variant="secondary" href={`/api/export/contact/${contact.id}`} prefetch={false}>Download their data (JSON)</ButtonLink>
                <ActionForm action={eraseContactAction} className="space-y-2 border-t border-ink-100 pt-4">
                  <input type="hidden" name="id" value={contact.id} />
                  <p className="text-ink-600">Erase removes their name, contact details, messages and notes. Their address stays on your suppression list so they aren&apos;t contacted again. This cannot be undone.</p>
                  <Field id="confirm" label="Type ERASE to confirm"><Input id="confirm" name="confirm" autoComplete="off" /></Field>
                  <SubmitButton size="sm" variant="danger">Erase personal data</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
