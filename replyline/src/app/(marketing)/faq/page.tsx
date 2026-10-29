import { BRAND } from "@/config/brand";
import { TRIAL_DAYS } from "@/config/plans";

export const metadata = { title: "FAQ" };

const FAQ = [
  { q: "Will it email my customers without me knowing?", a: `No. Out of the box, every automated message waits in your approval queue. You can choose to let specific workflows — like the "thanks for your enquiry" acknowledgement or appointment reminders — send on their own. Only the workspace owner can switch that on, and it's recorded in your audit log.` },
  { q: "Does the AI make up prices?", a: "It's instructed not to, and every draft is checked afterwards. Drafts that mention a price, a link, a phone number or a promise you haven't supplied are flagged before you can send them. AI drafts are never sent automatically." },
  { q: "Which email accounts does it work with?", a: `Today, replies are sent from ${BRAND.name}'s sending service on your behalf, with replies going straight to your own inbox. Direct Gmail and Microsoft 365 connections are on the roadmap. You can forward enquiries into ${BRAND.name} from any email account.` },
  { q: "Do I need a calendar integration?", a: "No. Appointments and reminders work without one, and you can add any appointment to Google, Outlook or Apple Calendar with one click. Two-way calendar sync is on the roadmap." },
  { q: "Is my customers' data safe?", a: "Each business's data is isolated at the database level, not just hidden in the interface. Sensitive actions are logged. You can export or erase a customer's data on request and set how long closed enquiries are kept." },
  { q: "Is it GDPR compliant?", a: `${BRAND.name} gives you the tools — consent records, opt-outs, export, erasure and retention — but compliance depends on how your business uses them. You remain responsible for your own privacy notice and lawful basis for contacting people.` },
  { q: "How does the free trial work?", a: `You get ${TRIAL_DAYS} days of the Growth plan with no card. At the end, choose a plan or your workspace moves to Starter limits. Your data is kept either way.` },
  { q: "Can I cancel any time?", a: "Yes. Monthly plans can be cancelled at any time and run to the end of the billing period. You can export all your data first." },
];

export default function FaqPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight text-ink-950">Frequently asked questions</h1>
      <dl className="mt-10 divide-y divide-ink-100">
        {FAQ.map((f) => (
          <div key={f.q} className="py-6">
            <dt className="font-semibold text-ink-950">{f.q}</dt>
            <dd className="mt-2 leading-7 text-ink-600">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
