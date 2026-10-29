import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { INDUSTRIES, INDUSTRY_KEYS, type IndustryKey } from "@/config/industries";

export function generateStaticParams() {
  return INDUSTRY_KEYS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: INDUSTRIES[slug as IndustryKey]?.label ?? "Industries" };
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ind = INDUSTRIES[slug as IndustryKey];
  if (!ind) notFound();
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <p className="text-sm font-medium text-brand-700">{ind.label}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink-950">{ind.marketing.headline}</h1>
      <p className="mt-3 text-lg text-ink-600">For {ind.examples.toLowerCase()}.</p>
      <div className="mt-12 grid gap-8 md:grid-cols-2">
        <div className="rounded-2xl bg-ink-50 p-6 ring-1 ring-ink-100">
          <h2 className="font-semibold text-ink-950">Sound familiar?</h2>
          <ul className="mt-4 space-y-3">
            {ind.marketing.pains.map((p) => (
              <li key={p} className="flex gap-2 text-ink-700"><XCircle className="shrink-0 text-ink-400" size={20} aria-hidden />{p}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-brand-50 p-6 ring-1 ring-brand-100">
          <h2 className="font-semibold text-ink-950">With the {ind.label.toLowerCase()} setup</h2>
          <ul className="mt-4 space-y-3">
            {ind.marketing.outcomes.map((p) => (
              <li key={p} className="flex gap-2 text-ink-700"><CheckCircle2 className="shrink-0 text-brand-600" size={20} aria-hidden />{p}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-12">
        <h2 className="font-semibold text-ink-950">Ready-made for you</h2>
        <p className="mt-2 text-ink-600">
          Categories: {ind.categories.join(", ")}. Sources: {ind.sources.join(", ")}. Appointment type: {ind.appointmentNoun}, {ind.defaultAppointmentMinutes} minutes by default.
        </p>
      </div>
      <ButtonLink href={`/sign-up?industry=${ind.key}`} size="lg" className="mt-10">Start free trial</ButtonLink>
    </section>
  );
}
