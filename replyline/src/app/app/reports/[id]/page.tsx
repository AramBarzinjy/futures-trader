import Link from "next/link";
import { notFound } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getReport } from "@/modules/reports/service";
import { getOrganization } from "@/modules/orgs/service";
import { Card, CardHeader, Stat } from "@/components/ui";
import { formatInZone } from "@/lib/time";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  let r;
  try {
    r = await getReport(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const m = r.metrics;
  const tz = (await getOrganization(actor)).timezone;
  const delta = (now: number, prev?: number) => (prev === undefined ? undefined : `Previous week: ${prev} (${now - prev >= 0 ? "+" : ""}${now - prev})`);
  const sources = Object.entries(m.bySource).sort((a, b) => b[1] - a[1]);
  const maxSource = Math.max(1, ...sources.map(([, n]) => n));

  return (
    <>
      <Link href="/app/reports" className="text-sm text-ink-500 hover:text-ink-800">← Reports</Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Weekly prospect report</h1>
      <p className="mt-1 text-ink-600">{m.periodLabel}</p>
      <p className="mt-1 text-xs text-ink-400">All figures are counts of records in your workspace. {m.previous ? "" : "Week-on-week comparison appears once there's a full previous week of data."}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="New enquiries" value={m.newEnquiries} hint={delta(m.newEnquiries, m.previous?.newEnquiries)} />
        <Stat label="Waiting on your reply" value={m.needingResponse} tone={m.needingResponse ? "warn" : undefined} href="/app/follow-ups" hint="As of report time" />
        <Stat label="Overdue follow-ups" value={m.overdueFollowUps} tone={m.overdueFollowUps ? "bad" : undefined} href="/app/enquiries?view=overdue" hint="As of report time" />
        <Stat label="Appointments booked" value={m.appointmentsScheduled} hint={delta(m.appointmentsScheduled, m.previous?.appointmentsScheduled)} />
        <Stat label="Won" value={m.won.length} tone={m.won.length ? "good" : undefined} hint={delta(m.won.length, m.previous?.won)} />
      </div>

      <Card className="mt-6 border-l-4 border-violet-400">
        <CardHeader title="Suggested next actions" description="Generated from the figures on this page by fixed rules — not predictions." />
        <ul className="space-y-2 px-5 py-4 text-sm">
          {r.suggestions.map((s, i) => (
            <li key={i} className="flex gap-2">
              <Lightbulb size={16} className="mt-0.5 shrink-0 text-violet-500" aria-hidden />
              <span>{s.text} {s.enquiryId && <Link className="text-brand-700" href={`/app/enquiries/${s.enquiryId}`}>Open</Link>}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Enquiries by source" />
          {sources.length === 0 ? <p className="px-5 py-4 text-sm text-ink-500">No new enquiries this period.</p> : (
            <ul className="space-y-2 px-5 py-4">
              {sources.map(([s, n]) => (
                <li key={s} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 text-sm">
                  <span className="truncate text-ink-700">{s}</span>
                  <span className="h-2 rounded-r-[4px] bg-brand-600" style={{ width: `${(n / maxSource) * 100}%` }} aria-hidden />
                  <span className="text-right tabular-nums text-ink-900">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <List title="Gone quiet" empty="No open enquiries have gone quiet." items={m.goneQuiet.map((q) => ({ href: `/app/enquiries/${q.id}`, primary: q.contactName, secondary: `${q.subject} · ${q.daysQuiet} days` }))} />
        <List title="Won this week" empty="None this week." items={m.won.map((q) => ({ href: `/app/enquiries/${q.id}`, primary: q.contactName, secondary: q.subject }))} />
        <List title="Lost this week" empty="None this week." items={m.lost.map((q) => ({ href: `/app/enquiries/${q.id}`, primary: q.contactName, secondary: q.subject }))} />
        <List title="Coming up (next 7 days)" empty="No appointments booked." items={m.upcomingAppointments.map((a) => ({ href: `/app/appointments/${a.id}`, primary: a.title, secondary: `${a.contactName} · ${formatInZone(new Date(a.startsAt), tz, "short")}` }))} />
      </div>
    </>
  );
}

function List({ title, items, empty }: { title: string; empty: string; items: { href: string; primary: string; secondary: string }[] }) {
  return (
    <Card>
      <CardHeader title={title} description={`${items.length}`} />
      {items.length === 0 ? <p className="px-5 py-4 text-sm text-ink-500">{empty}</p> : (
        <ul className="divide-y divide-ink-100">
          {items.map((i) => <li key={i.href}><Link href={i.href} className="block px-5 py-3 text-sm hover:bg-ink-50"><span className="font-medium text-ink-900">{i.primary}</span> <span className="text-ink-500">· {i.secondary}</span></Link></li>)}
        </ul>
      )}
    </Card>
  );
}
