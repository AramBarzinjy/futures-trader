import { requireApp } from "@/lib/auth/session";
import { getOrganization } from "@/modules/orgs/service";
import { listMembers } from "@/modules/team/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { createEnquiryAction } from "../../actions";

export const metadata = { title: "New enquiry" };

export default async function NewEnquiry() {
  const { actor } = await requireApp();
  const org = await getOrganization(actor);
  const team = await listMembers(actor);
  return (
    <>
      <PageHeader title="New enquiry" description="If this customer is already in your contacts, they'll be matched by email or phone. Their saved details won't be overwritten." />
      <Card className="max-w-3xl p-6">
        <ActionForm action={createEnquiryAction} className="space-y-6">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-ink-900">Customer</legend>
            <Field id="name" label="Name"><Input id="name" name="name" required autoComplete="off" /></Field>
            <Field id="company" label="Company" hint="(optional)"><Input id="company" name="company" /></Field>
            <Field id="email" label="Email"><Input id="email" name="email" type="email" /></Field>
            <Field id="phone" label="Phone"><Input id="phone" name="phone" type="tel" /></Field>
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="mb-3 text-sm font-semibold text-ink-900">Enquiry</legend>
            <Field id="subject" label="What do they need?"><Input id="subject" name="subject" required placeholder="e.g. Replace kitchen tap" /></Field>
            <Field id="message" label="Details"><Textarea id="message" name="message" rows={5} /></Field>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field id="source" label="Source">
                <Select id="source" name="source" defaultValue={org.settings.enquirySources[0]}>
                  {org.settings.enquirySources.map((s) => <option key={s}>{s}</option>)}
                  <option value="manual">Other</option>
                </Select>
              </Field>
              <Field id="category" label="Category">
                <Select id="category" name="category" defaultValue="">
                  <option value="">—</option>
                  {org.settings.categories.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
              <Field id="priority" label="Priority">
                <Select id="priority" name="priority" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </Field>
              <Field id="assignedUserId" label="Assign to">
                <Select id="assignedUserId" name="assignedUserId" defaultValue={actor.userId ?? ""}>
                  <option value="">Unassigned</option>
                  {team.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </Select>
              </Field>
            </div>
          </fieldset>
          <div className="space-y-3 rounded-lg bg-ink-50 p-4">
            <Checkbox id="marketingConsent" name="marketingConsent" label="Customer agreed to receive marketing emails" description="Only tick this if they actually said yes. It's recorded with today's date." />
            <Checkbox id="skipAutomation" name="skipAutomation" label="Don't start automatic workflows for this enquiry" description="Use for enquiries you've already dealt with." />
          </div>
          <SubmitButton pendingText="Saving…">Create enquiry</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
