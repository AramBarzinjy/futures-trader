import { requireApp } from "@/lib/auth/session";
import { getOrganization, getStatuses } from "@/modules/orgs/service";
import { listAuditLog } from "@/modules/audit/service";
import { can } from "@/modules/auth/permissions";
import { getAiProvider } from "@/modules/ai/provider";
import { INDUSTRIES, INDUSTRY_KEYS } from "@/config/industries";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ButtonLink, Card, CardHeader, Checkbox, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { formatInZone } from "@/lib/time";
import { deleteWorkspaceAction, savePreferencesAction, savePrivacyAction, saveProfileAction, saveStatusesAction } from "../actions";

export const metadata = { title: "Settings" };

const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]] as const;
const COLORS = ["slate", "blue", "amber", "violet", "orange", "teal", "green", "red"];

export default async function SettingsPage() {
  const { actor } = await requireApp();
  const org = await getOrganization(actor);
  const statuses = await getStatuses(actor);
  const canWrite = can(actor.role, "settings.write");
  const audit = can(actor.role, "audit.read") ? await listAuditLog(actor, 50) : [];
  const s = org.settings;
  const slots = [...statuses, { key: "", label: "", isClosed: false, outcome: null, stopsFollowUps: false, color: "slate" }];

  return (
    <>
      <PageHeader title="Settings" />
      {!canWrite && <div className="mb-4"><Notice tone="info">Only owners and admins can change settings.</Notice></div>}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Business profile" description="Used in templates and AI drafts. The AI never adds facts you haven't given here." />
          <ActionForm action={saveProfileAction} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="name" label="Business name"><Input id="name" name="name" defaultValue={org.name} required /></Field>
              <Field id="industry" label="Industry"><Select id="industry" name="industry" defaultValue={org.industry}>{INDUSTRY_KEYS.map((k) => <option key={k} value={k}>{INDUSTRIES[k].label}</option>)}</Select></Field>
              <Field id="timezone" label="Timezone"><Input id="timezone" name="timezone" defaultValue={org.timezone} required /></Field>
              <Field id="phone" label="Phone"><Input id="phone" name="phone" defaultValue={org.phone ?? ""} /></Field>
              <Field id="email" label="Reply-to email"><Input id="email" name="email" type="email" defaultValue={org.email ?? ""} /></Field>
              <Field id="tone" label="Tone"><Select id="tone" name="tone" defaultValue={org.tone}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="warm">Warm</option><option value="concise">Concise</option></Select></Field>
              <Field id="website" label="Website"><Input id="website" name="website" type="url" defaultValue={org.website ?? ""} /></Field>
              <Field id="bookingLink" label="Booking link"><Input id="bookingLink" name="bookingLink" type="url" defaultValue={org.bookingLink ?? ""} /></Field>
            </div>
            <Field id="signature" label="Email signature"><Textarea id="signature" name="signature" rows={3} defaultValue={org.emailSignature ?? ""} /></Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Opening hours</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {DAYS.map(([k, label]) => {
                  const h = org.businessHours[k];
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <div className="w-20"><Checkbox id={`${k}_open`} name={`${k}_open`} label={label} defaultChecked={!!h} /></div>
                      <Input aria-label={`${label} opens`} name={`${k}_from`} type="time" defaultValue={h?.open ?? "09:00"} className="w-28" />
                      <span className="text-ink-400">–</span>
                      <Input aria-label={`${label} closes`} name={`${k}_to`} type="time" defaultValue={h?.close ?? "17:00"} className="w-28" />
                    </div>
                  );
                })}
              </div>
            </fieldset>
            {canWrite && <SubmitButton>Save profile</SubmitButton>}
          </ActionForm>
        </Card>

        <Card>
          <CardHeader title="Enquiries and reports" />
          <ActionForm action={savePreferencesAction} className="grid gap-4 p-5 sm:grid-cols-2">
            <Field id="sources" label="Enquiry sources" hint="(one per line)"><Textarea id="sources" name="sources" rows={5} defaultValue={s.enquirySources.join("\n")} /></Field>
            <Field id="categories" label="Categories" hint="(one per line)"><Textarea id="categories" name="categories" rows={5} defaultValue={s.categories.join("\n")} /></Field>
            <Field id="appointmentMinutes" label="Default appointment length (min)"><Input id="appointmentMinutes" name="appointmentMinutes" type="number" min={5} defaultValue={s.defaultAppointmentMinutes} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="reportWeekday" label="Report day"><Select id="reportWeekday" name="reportWeekday" defaultValue={String(s.report.weekday)}>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select></Field>
              <Field id="reportHour" label="Hour"><Input id="reportHour" name="reportHour" type="number" min={0} max={23} defaultValue={s.report.hour} /></Field>
            </div>
            <Field id="reportRecipients" label="Email the report to" hint="(one per line)"><Textarea id="reportRecipients" name="reportRecipients" rows={2} defaultValue={s.report.recipients.join("\n")} /></Field>
            <div className="pt-7"><Checkbox id="reportEmail" name="reportEmail" defaultChecked={s.report.emailEnabled} label="Email the weekly report" /></div>
            {canWrite && <div><SubmitButton>Save</SubmitButton></div>}
          </ActionForm>
        </Card>

        <Card>
          <CardHeader title="Pipeline statuses" description="Rename, reorder (by number), add or remove. A status still in use can't be removed." />
          <ActionForm action={saveStatusesAction} className="p-5">
            <input type="hidden" name="count" value={slots.length} />
            <div className="space-y-2">
              {slots.map((st, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_1fr_9rem_7rem_auto_auto]">
                  <Input aria-label="Label" name={`s${i}_label`} defaultValue={st.label} placeholder={st.key ? "" : "New status label"} />
                  <Input aria-label="Key" name={`s${i}_key`} defaultValue={st.key} placeholder="key_name" readOnly={!!st.key} className={st.key ? "bg-ink-50 text-ink-500" : ""} />
                  <Select aria-label="Type" name={`s${i}_type`} defaultValue={!st.isClosed ? "open" : st.outcome ?? "lost"}>
                    <option value="open">Open</option><option value="won">Closed – won</option><option value="lost">Closed – lost</option>
                  </Select>
                  <Select aria-label="Colour" name={`s${i}_color`} defaultValue={st.color}>{COLORS.map((c) => <option key={c}>{c}</option>)}</Select>
                  <Checkbox id={`s${i}_stops`} name={`s${i}_stops`} defaultChecked={st.stopsFollowUps} label="Stops follow-ups" />
                  {st.key ? <Checkbox id={`s${i}_remove`} name={`s${i}_remove`} label="Remove" /> : <span />}
                </div>
              ))}
            </div>
            {canWrite && <div className="mt-4"><SubmitButton>Save statuses</SubmitButton></div>}
          </ActionForm>
        </Card>

        <Card>
          <CardHeader title="Privacy and data" />
          <ActionForm action={savePrivacyAction} className="space-y-4 p-5">
            <Checkbox id="aiAck" name="aiAck" defaultChecked={s.aiDataSharingAcknowledged} label="Allow AI-assisted drafting" description={getAiProvider().external ? "Enquiry text is sent to the configured AI provider only when someone clicks an AI button." : "AI is in demo mode; no data leaves the server."} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="retention" label="Delete closed enquiries after (months)"><Input id="retention" name="retention" type="number" min={1} max={120} defaultValue={s.retentionMonths} /></Field>
              <Field id="marketingBasis" label="Marketing email rule">
                <Select id="marketingBasis" name="marketingBasis" defaultValue={s.marketingBasis}>
                  <option value="consent_required">Recorded consent required (recommended)</option>
                  <option value="soft_opt_in">Soft opt-in for existing customers — take legal advice first</option>
                </Select>
              </Field>
            </div>
            {canWrite && <SubmitButton>Save privacy settings</SubmitButton>}
          </ActionForm>
          {can(actor.role, "data.export_all") && (
            <div className="border-t border-ink-100 px-5 py-4">
              <ButtonLink href="/api/export/workspace" variant="secondary" size="sm" prefetch={false}>Export all workspace data (JSON)</ButtonLink>
            </div>
          )}
        </Card>

        {audit.length > 0 && (
          <Card>
            <CardHeader title="Audit log" description="Sensitive actions, most recent first." />
            <ul className="max-h-96 divide-y divide-ink-100 overflow-y-auto">
              {audit.map((a) => (
                <li key={a.id} className="flex justify-between gap-4 px-5 py-2 text-sm">
                  <span><span className="font-mono text-xs text-ink-700">{a.action}</span> <span className="text-ink-500">by {a.actorName ?? "system"}</span></span>
                  <time className="shrink-0 text-xs text-ink-400">{formatInZone(a.createdAt, org.timezone, "short")}</time>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {can(actor.role, "org.delete") && (
          <Card className="ring-red-200">
            <CardHeader title="Delete workspace" description="Permanently deletes every enquiry, contact, message and setting. Export first. This cannot be undone." />
            <ActionForm action={deleteWorkspaceAction} className="flex flex-wrap items-end gap-3 p-5">
              <Field id="confirmName" label={`Type “${org.name}” to confirm`}><Input id="confirmName" name="confirmName" autoComplete="off" /></Field>
              <SubmitButton variant="danger" confirm="Delete this workspace permanently?">Delete workspace</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
