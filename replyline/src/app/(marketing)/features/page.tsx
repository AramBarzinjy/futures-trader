import { BarChart3, CalendarClock, FileText, Inbox, ListChecks, Lock, MailPlus, Repeat, Sparkles, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui";

export const metadata = { title: "Features" };

const FEATURES = [
  { icon: Inbox, t: "Every enquiry in one place", d: "A website form you can embed in minutes, forwarded emails, CSV import and manual entry — all normalised into one list with search, filters and a pipeline view." },
  { icon: Sparkles, t: "AI-assisted replies", d: "Draft a reply, change its tone, make it shorter or more detailed, list clarifying questions or summarise a long thread. Drafts that mention prices, links or promises are flagged for you to check." },
  { icon: MailPlus, t: "Templates with variables", d: "Editable templates for acknowledgements, quotes, follow-ups and appointments. Missing details are highlighted before anything goes out." },
  { icon: Repeat, t: "Follow-ups that know when to stop", d: "Sequences run on business days, inside your opening hours, and stop when the customer replies, books, opts out or you close the enquiry." },
  { icon: CalendarClock, t: "Appointments and reminders", d: "Confirmations, reminders and reschedule notices in the right timezone — including around the clock changes. Download any appointment to your calendar." },
  { icon: BarChart3, t: "Weekly prospect report", d: "New enquiries by source, who's waiting on you, who's gone quiet and what's coming up. Every figure links back to the enquiries behind it." },
  { icon: Users, t: "Built for teams", d: "Assign enquiries, see who has what, and control who can change templates, automation and billing." },
  { icon: ListChecks, t: "Approval before sending", d: "Automated messages wait for your OK unless you explicitly allow a workflow to send on its own." },
  { icon: Lock, t: "Privacy built in", d: "Consent records, a suppression list, unsubscribe links, data export, erasure and retention controls." },
  { icon: FileText, t: "Full history", d: "Every email, note, status change and automation step is on the enquiry's timeline." },
];

export default function Features() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight text-ink-950">Everything between “new enquiry” and “job booked”</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-600">No complicated CRM to learn. Just the parts that stop enquiries slipping through the cracks.</p>
      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.t} className="flex gap-4">
            <div className="h-10 w-10 shrink-0 rounded-lg bg-brand-50 p-2 text-brand-700 ring-1 ring-brand-100">
              <f.icon size={24} aria-hidden />
            </div>
            <div>
              <h2 className="font-semibold text-ink-950">{f.t}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-600">{f.d}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-14">
        <ButtonLink href="/sign-up" size="lg">Start free trial</ButtonLink>
      </div>
    </section>
  );
}
