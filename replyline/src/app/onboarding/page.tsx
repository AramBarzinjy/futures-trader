import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Checkbox, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { listUserOrgs } from "@/modules/auth/service";
import { getOrganization } from "@/modules/orgs/service";
import { INDUSTRIES, INDUSTRY_KEYS } from "@/config/industries";
import { getAiProvider } from "@/modules/ai/provider";
import { createWorkspaceAction, saveCommsStep, saveContactStep, savePrivacyStep } from "./actions";

export const metadata = { title: "Set up your workspace" };

const STEPS = ["Your business", "Contact & hours", "How you communicate", "Privacy & finish"];
const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;
const TIMEZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "America/New_York", "Australia/Sydney"];

export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/onboarding");
  const orgs = await listUserOrgs(session.user.id);
  const requested = Number(sp.step ?? 1);
  const step = orgs.length === 0 ? 1 : Math.min(Math.max(requested, 2), 4);
  const current = orgs.find((o) => o.orgId === session.activeOrgId) ?? orgs[0];
  const org = current ? await getOrganization({ orgId: current.orgId, userId: session.user.id, role: current.role }) : null;
  if (org?.onboardingCompletedAt && !sp.step) redirect("/app");

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Logo href="/app" />
          {org && <Link href="/app" className="text-sm text-ink-500 hover:text-ink-900">Skip for now</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <ol className="mb-8 grid grid-cols-4 gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s} className="text-xs">
              <div className={cx("h-1.5 rounded-full", i + 1 <= step ? "bg-brand-600" : "bg-ink-200")} />
              <div className={cx("mt-2 hidden sm:block", i + 1 === step ? "font-medium text-ink-900" : "text-ink-500")} aria-current={i + 1 === step ? "step" : undefined}>{s}</div>
            </li>
          ))}
        </ol>
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-ink-200 sm:p-8">
          {step === 1 && (
            <ActionForm action={createWorkspaceAction} className="space-y-5">
              <h1 className="text-xl font-semibold">Tell us about your business</h1>
              <input type="hidden" name="plan" value={sp.plan ?? ""} />
              <Field id="name" label="Business name">
                <Input id="name" name="name" required placeholder="e.g. Hughes Plumbing & Heating" />
              </Field>
              <Field id="industry" label="Industry" hint="— sets your starting templates">
                <Select id="industry" name="industry" defaultValue={sp.industry && sp.industry in INDUSTRIES ? sp.industry : "trades"}>
                  {INDUSTRY_KEYS.map((k) => (
                    <option key={k} value={k}>{INDUSTRIES[k].label} — {INDUSTRIES[k].examples}</option>
                  ))}
                </Select>
              </Field>
              <Field id="timezone" label="Timezone">
                <Select id="timezone" name="timezone" defaultValue="Europe/London">
                  {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <SubmitButton pendingText="Creating workspace…">Continue</SubmitButton>
            </ActionForm>
          )}

          {step === 2 && org && (
            <ActionForm action={saveContactStep} className="space-y-5">
              <h1 className="text-xl font-semibold">Contact details and opening hours</h1>
              <p className="text-sm text-ink-500">Used in your emails and to keep follow-ups within working hours. All optional.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="phone" label="Business phone"><Input id="phone" name="phone" defaultValue={org.phone ?? ""} /></Field>
                <Field id="email" label="Reply-to email"><Input id="email" name="email" type="email" defaultValue={org.email ?? session.user.email} /></Field>
                <Field id="website" label="Website"><Input id="website" name="website" type="url" placeholder="https://" defaultValue={org.website ?? ""} /></Field>
                <Field id="bookingLink" label="Booking link" hint="(Calendly etc.)"><Input id="bookingLink" name="bookingLink" type="url" placeholder="https://" defaultValue={org.bookingLink ?? ""} /></Field>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Working days and hours</legend>
                <div className="space-y-2">
                  {DAYS.map(([k, label]) => {
                    const h = org.businessHours[k];
                    return (
                      <div key={k} className="flex flex-wrap items-center gap-3">
                        <div className="w-32"><Checkbox id={`${k}_open`} name={`${k}_open`} label={label} defaultChecked={!!h} /></div>
                        <Input aria-label={`${label} opens`} name={`${k}_from`} type="time" defaultValue={h?.open ?? "09:00"} className="w-32" />
                        <span className="text-ink-400">to</span>
                        <Input aria-label={`${label} closes`} name={`${k}_to`} type="time" defaultValue={h?.close ?? "17:00"} className="w-32" />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <Field id="appointmentMinutes" label="Typical appointment length (minutes)">
                <Input id="appointmentMinutes" name="appointmentMinutes" type="number" min={5} max={600} defaultValue={org.settings.defaultAppointmentMinutes} className="w-32" />
              </Field>
              <SubmitButton>Continue</SubmitButton>
            </ActionForm>
          )}

          {step === 3 && org && (
            <ActionForm action={saveCommsStep} className="space-y-5">
              <h1 className="text-xl font-semibold">How you communicate</h1>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="tone" label="Tone for drafted replies">
                  <Select id="tone" name="tone" defaultValue={org.tone}>
                    <option value="friendly">Friendly</option>
                    <option value="professional">Professional</option>
                    <option value="warm">Warm</option>
                    <option value="concise">Concise</option>
                  </Select>
                </Field>
                <Field id="followUpDays" label="Follow up after (business days)">
                  <Input id="followUpDays" name="followUpDays" type="number" min={1} max={30} defaultValue={org.settings.followUpDelayBusinessDays} />
                </Field>
              </div>
              <Field id="signature" label="Email signature">
                <Textarea id="signature" name="signature" rows={3} defaultValue={org.emailSignature ?? `Best wishes,\n${session.user.name}\n${org.name}`} />
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Where do your enquiries come from?</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {INDUSTRIES[org.industry as keyof typeof INDUSTRIES].sources.map((s) => (
                    <Checkbox key={s} id={`src-${s}`} name="sources" value={s} label={s} defaultChecked={org.settings.enquirySources.includes(s)} />
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="emailProvider" label="Your email provider">
                  <Select id="emailProvider" name="emailProvider" defaultValue={org.settings.emailProviderPreference}>
                    <option value="none">Not sure / skip</option>
                    <option value="gmail">Gmail / Google Workspace</option>
                    <option value="microsoft">Outlook / Microsoft 365</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field id="calendarProvider" label="Your calendar">
                  <Select id="calendarProvider" name="calendarProvider" defaultValue={org.settings.calendarProviderPreference}>
                    <option value="none">Not sure / skip</option>
                    <option value="google">Google Calendar</option>
                    <option value="microsoft">Outlook Calendar</option>
                  </Select>
                </Field>
              </div>
              <fieldset className="space-y-3 rounded-lg bg-ink-50 p-4">
                <legend className="text-sm font-semibold text-ink-900">Automatic sending</legend>
                <p className="text-sm text-ink-500">Everything else waits for your approval. You can change these later in Workflows.</p>
                <Checkbox id="autoAck" name="autoAck" label="Send the &ldquo;thanks for your enquiry&rdquo; acknowledgement automatically" description="Template only — never AI-written. Held for review if any detail is missing." />
                <Checkbox id="autoReminders" name="autoReminders" label="Send appointment confirmations and reminders automatically" />
              </fieldset>
              <Checkbox id="reportEmail" name="reportEmail" defaultChecked label="Email me the weekly prospect report" description="Mondays at 8am. You can always view it in the app." />
              <SubmitButton>Continue</SubmitButton>
            </ActionForm>
          )}

          {step === 4 && org && (
            <ActionForm action={savePrivacyStep} className="space-y-5">
              <h1 className="text-xl font-semibold">Privacy and data</h1>
              <Checkbox
                id="aiAck"
                name="aiAck"
                defaultChecked={org.settings.aiDataSharingAcknowledged}
                label="Allow AI-assisted drafting"
                description={
                  getAiProvider().external
                    ? "When you ask for a draft, that enquiry's text and your business details are sent to our AI provider to write it. Nothing is sent unless you click a draft button."
                    : "AI is currently in demo mode: drafts are generated locally and no data leaves the server."
                }
              />
              <Field id="retention" label="Delete closed enquiries after">
                <Select id="retention" name="retention" defaultValue={String(org.settings.retentionMonths)}>
                  <option value="12">12 months</option>
                  <option value="24">24 months</option>
                  <option value="36">36 months</option>
                  <option value="72">6 years</option>
                </Select>
              </Field>
              <Notice tone="info">
                Marketing emails (like re-engaging old prospects) are only sent to contacts with recorded consent, and always include an unsubscribe link. Replies about a customer&apos;s own enquiry or appointment don&apos;t need marketing consent.
              </Notice>
              <SubmitButton>Finish setup</SubmitButton>
            </ActionForm>
          )}
        </div>
      </main>
    </div>
  );
}
