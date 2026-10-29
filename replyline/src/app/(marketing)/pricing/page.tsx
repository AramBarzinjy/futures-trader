import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { PLANS, PLAN_ORDER, TRIAL_DAYS, formatPence } from "@/config/plans";

export const metadata = { title: "Pricing" };

export default function Pricing() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950">Simple monthly pricing</h1>
        <p className="mt-3 text-ink-600">Start with a {TRIAL_DAYS}-day free trial of Growth. No card needed. Annual plans get two months free.</p>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          const featured = k === "growth";
          return (
            <div key={k} className={`flex flex-col rounded-2xl p-8 ring-1 ${featured ? "bg-ink-950 text-white ring-ink-950" : "bg-white ring-ink-200"}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {featured && <span className="rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-medium text-white">Most popular</span>}
              </div>
              <p className={`mt-2 text-sm ${featured ? "text-ink-300" : "text-ink-500"}`}>{p.tagline}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{formatPence(p.pricePence.monthly)}</span>
                <span className={featured ? "text-ink-300" : "text-ink-500"}>/month</span>
              </div>
              <p className={`text-sm ${featured ? "text-ink-400" : "text-ink-500"}`}>or {formatPence(p.pricePence.annual)}/year</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <Check size={18} className="shrink-0 text-brand-500" aria-hidden />
                    {h}
                  </li>
                ))}
              </ul>
              <ButtonLink href={`/sign-up?plan=${k}`} variant={featured ? "primary" : "secondary"} className="mt-8 w-full">
                Start free trial
              </ButtonLink>
            </div>
          );
        })}
      </div>
      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-ink-500">
        Prices exclude VAT. Need help getting set up? We offer optional done-for-you configuration — ask us for a quote.
      </p>
    </section>
  );
}
