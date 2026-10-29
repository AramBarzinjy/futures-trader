import { desc, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { requireApp } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { getOrganization } from "@/modules/orgs/service";
import { listMembers } from "@/modules/team/service";
import { effectivePlan } from "@/modules/billing/entitlements";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Checkbox, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import { createAppointmentAction } from "../../actions";

export const metadata = { title: "New appointment" };

const REMINDERS = [
  [2880, "2 days before"],
  [1440, "1 day before"],
  [240, "4 hours before"],
  [120, "2 hours before"],
  [60, "1 hour before"],
] as const;

export default async function NewAppointment({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await requireApp();
  const org = await getOrganization(actor);
  const plan = effectivePlan(org);
  const team = await listMembers(actor);
  const contacts = await withTenant(actor, (tx) =>
    tx.select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email }).from(schema.contacts).where(isNull(schema.contacts.erasedAt)).orderBy(desc(schema.contacts.updatedAt)).limit(200),
  );
  const enquiries = sp.contactId
    ? await withTenant(actor, (tx) => tx.select({ id: schema.enquiries.id, subject: schema.enquiries.subject }).from(schema.enquiries).where(eq(schema.enquiries.contactId, sp.contactId!)))
    : [];
  const tomorrow = DateTime.now().setZone(org.timezone).plus({ days: 1 }).toISODate();

  return (
    <>
      <PageHeader title="New appointment" description="The customer gets a confirmation and reminders, if your appointment workflow is on." />
      <Card className="max-w-3xl p-6">
        {contacts.length === 0 ? (
          <Notice tone="info">Add an enquiry first — appointments are booked for a contact.</Notice>
        ) : (
          <ActionForm action={createAppointmentAction} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="contactId" label="Customer">
                <Select id="contactId" name="contactId" defaultValue={sp.contactId ?? contacts[0].id} required>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>)}
                </Select>
              </Field>
              <Field id="enquiryId" label="For enquiry" hint="(optional)">
                <Select id="enquiryId" name="enquiryId" defaultValue={sp.enquiryId ?? ""}>
                  <option value="">—</option>
                  {enquiries.map((e) => <option key={e.id} value={e.id}>{e.subject}</option>)}
                </Select>
              </Field>
              <div className="sm:col-span-2"><Field id="title" label="Title"><Input id="title" name="title" required defaultValue="Site visit" /></Field></div>
              <Field id="date" label="Date"><Input id="date" name="date" type="date" required defaultValue={tomorrow ?? ""} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="time" label="Time"><Input id="time" name="time" type="time" required defaultValue="10:00" /></Field>
                <Field id="durationMinutes" label="Minutes"><Input id="durationMinutes" name="durationMinutes" type="number" min={5} defaultValue={org.settings.defaultAppointmentMinutes} /></Field>
              </div>
              <Field id="timezone" label="Timezone"><Input id="timezone" name="timezone" defaultValue={org.timezone} required /></Field>
              <Field id="assignedUserId" label="Staff member">
                <Select id="assignedUserId" name="assignedUserId" defaultValue={actor.userId ?? ""}>
                  <option value="">—</option>
                  {team.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </Select>
              </Field>
              <Field id="location" label="Address / location"><Input id="location" name="location" /></Field>
              <Field id="meetingLink" label="Video link" hint="(optional)"><Input id="meetingLink" name="meetingLink" type="url" placeholder="https://" /></Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-800">Reminders <span className="font-normal text-ink-500">— your {plan.name} plan allows {plan.limits.reminderOffsets}</span></legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {REMINDERS.map(([m, label]) => <Checkbox key={m} id={`r${m}`} name="reminders" value={String(m)} label={label} defaultChecked={m === 1440} />)}
              </div>
            </fieldset>
            <Checkbox id="notifyCustomer" name="notifyCustomer" defaultChecked label="Send the customer a confirmation now" />
            <SubmitButton>Book appointment</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
