import { ArrowRight, BellRing, CalendarCheck, CheckCircle2, Inbox, MailCheck, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { BRAND } from "@/config/brand";
import { INDUSTRIES, INDUSTRY_KEYS } from "@/config/industries";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-brand-50 to-white" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
              <Sparkles size={14} aria-hidden /> Built for busy UK service businesses
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink-950 sm:text-5xl">{BRAND.tagline}</h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-ink-600">
              {BRAND.name} captures every enquiry, drafts the reply, chases customers who go quiet and reminds them before every appointment — and stops the moment they answer.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/sign-up" size="lg">
                Start 14-day free trial <ArrowRight size={18} aria-hidden />
              </ButtonLink>
              <ButtonLink href="/pricing" size="lg" variant="secondary">See pricing</ButtonLink>
            </div>
            <p className="mt-4 text-sm text-ink-500">No card needed for the trial. Nothing is sent to your customers until you approve it.</p>
          </div>
          <HeroPreview />
        </div>
      </section>

      <section className="border-y border-ink-100 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-3 sm:px-6">
          {[
            { icon: Timer, title: "Reply in minutes, not days", body: "Every enquiry is acknowledged straight away, even while you're on a job." },
            { icon: MailCheck, title: "Follow up every time", body: "Polite, scheduled follow-ups that stop automatically when the customer replies or books." },
            { icon: CalendarCheck, title: "Fewer no-shows", body: "Confirmation and reminder emails before every visit, in your customer's local time." },
          ].map((f) => (
            <div key={f.title}>
              <f.icon className="text-brand-600" aria-hidden />
              <h2 className="mt-3 font-semibold text-ink-950">{f.title}</h2>
              <p className="mt-1 text-sm leading-6 text-ink-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-950">How it works</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-4">
          {[
            { icon: Inbox, t: "Capture", d: "Website form, forwarded emails, CSV import or quick manual entry. Duplicates are flagged, never merged silently." },
            { icon: Sparkles, t: "Draft", d: "AI drafts a reply from the enquiry and your business details. It's told never to invent prices or availability." },
            { icon: CheckCircle2, t: "Approve", d: "You review and send. Turn on automatic sending only for the simple messages you choose." },
            { icon: BellRing, t: "Follow through", d: "Follow-ups, reminders and a weekly report keep every prospect moving." },
          ].map((s, i) => (
            <li key={s.t} className="rounded-xl bg-ink-50 p-6 ring-1 ring-ink-100">
              <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs text-white">{i + 1}</span>
                {s.t}
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-600">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-ink-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">One platform, set up for your trade</h2>
          <p className="mt-3 max-w-2xl text-ink-300">Pick your industry at sign-up and start with the right statuses, templates and follow-ups. Change anything later.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {INDUSTRY_KEYS.map((k) => (
              <Link key={k} href={`/industries/${k}`} className="rounded-xl bg-white/5 p-5 ring-1 ring-white/10 transition hover:bg-white/10">
                <div className="font-medium">{INDUSTRIES[k].label}</div>
                <div className="mt-1 text-sm text-ink-400">{INDUSTRIES[k].examples}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <ShieldCheck className="text-brand-600" aria-hidden />
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink-950">Careful by default</h2>
            <p className="mt-3 text-ink-600">Your customers&apos; details stay in your workspace, separated from every other business at the database level. Marketing emails need recorded consent and always carry an unsubscribe link. Opt-outs are honoured everywhere, immediately.</p>
          </div>
          <div className="rounded-2xl bg-brand-50 p-8 ring-1 ring-brand-100">
            <h3 className="text-xl font-semibold text-ink-950">Try it with your own enquiries</h3>
            <p className="mt-2 text-ink-600">Set up takes about ten minutes. Start on Growth free for 14 days.</p>
            <ButtonLink href="/sign-up" className="mt-6">Create your workspace</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

function HeroPreview() {
  const rows = [
    { name: "Priya Shah", subj: "Leaking radiator valve", status: "Needs response", tone: "bg-amber-50 text-amber-800" },
    { name: "Tom Hughes", subj: "Bathroom refit quote", status: "Follow-up due", tone: "bg-orange-50 text-orange-700" },
    { name: "Ellie Ward", subj: "Boiler service", status: "Appointment booked", tone: "bg-brand-50 text-brand-700" },
    { name: "Marcus Lee", subj: "Outside tap install", status: "Won", tone: "bg-emerald-50 text-emerald-700" },
  ];
  return (
    <div aria-hidden className="rounded-2xl bg-white p-4 shadow-xl ring-1 ring-ink-200">
      <div className="flex items-center justify-between border-b border-ink-100 pb-3">
        <div className="text-sm font-semibold text-ink-900">Enquiries</div>
        <div className="text-xs text-ink-400">This week · 12 new</div>
      </div>
      <ul className="divide-y divide-ink-100">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-ink-900">{r.name}</div>
              <div className="text-xs text-ink-500">{r.subj}</div>
            </div>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${r.tone}`}>{r.status}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
        <span className="font-medium text-ink-800">Draft ready:</span> &ldquo;Hi Priya, thanks for getting in touch about the radiator valve…&rdquo;
      </div>
    </div>
  );
}
