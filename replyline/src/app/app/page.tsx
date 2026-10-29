import Link from "next/link";
import { CheckCircle2, Circle, Inbox } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { dashboard } from "@/modules/dashboard/service";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { TrendChart } from "@/components/trend-chart";
import { formatInZone } from "@/lib/time";
import { METRIC_LABELS } from "@/modules/billing/entitlements";
import type { UsageMetric } from "@/config/plans";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor, user } = await requireApp();
  const d = await dashboard(actor);
  const tz = d.org.timezone;

  const checklist = [
    { done: !!d.org.onboardingCompletedAt, label: "Finish setting up your business", href: "/onboarding?step=2" },
    { done: d.totalEnquiries > 0, label: "Add your first enquiry", href: "/app/enquiries/new" },
    { done: !!d.org.bookingLink, label: "Add a booking link for your emails", href: "/app/settings" },
    { done: d.health.succeeded > 0, label: "Send your first reply", href: "/app/enquiries" },
    { done: false, label: "Put the enquiry form on your website", href: "/app/integrations", optional: true },
  ];
  const pending = checklist.filter((c) => !c.done && !c.optional).length;

  return (
    <>
      <PageHeader
        title={`Good ${greeting(tz)}, ${user.name.split(" ")[0]}`}
        description="Everything that needs your attention today."
        actions={<ButtonLink href="/app/enquiries/new">New enquiry</ButtonLink>}
      />
      {sp.welcome && <div className="mb-6"><Notice tone="success" title="You're set up">Add an enquiry to see the acknowledgement and follow-ups in action.</Notice></div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="New this week" value={d.newThisWeek} href="/app/enquiries?view=all&sort=newest" />
        <Stat label="Waiting on your reply" value={d.awaitingResponse} href="/app/follow-ups" tone={d.awaitingResponse ? "warn" : undefined} />
        <Stat label="Follow-ups due today" value={d.dueToday} href="/app/enquiries?view=due_today&sort=follow_up" />
        <Stat label="Overdue" value={d.overdue} href="/app/enquiries?view=overdue&sort=follow_up" tone={d.overdue ? "bad" : undefined} />
        <Stat label="Awaiting approval" value={d.pendingApproval} href="/app/follow-ups" tone={d.pendingApproval ? "warn" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="New enquiries per week" description="Last 8 weeks" />
          <div className="px-5 pb-4 pt-8">
            <TrendChart data={d.trend} label="New enquiries per week, last 8 weeks" />
          </div>
        </Card>

        {pending > 0 ? (
          <Card>
            <CardHeader title="Getting started" description={`${pending} step${pending === 1 ? "" : "s"} left`} />
            <ul className="divide-y divide-ink-100">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-ink-50">
                    {c.done ? <CheckCircle2 size={18} className="text-emerald-600" aria-label="Done" /> : <Circle size={18} className="text-ink-300" aria-label="To do" />}
                    <span className={c.done ? "text-ink-400 line-through" : "text-ink-800"}>{c.label}</span>
                    {c.optional && <span className="text-xs text-ink-400">optional</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <UpcomingCard d={d} tz={tz} />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" />
          {d.recent.length === 0 ? (
            <EmptyState icon={<Inbox size={20} />} title="No activity yet" description="When enquiries arrive, every email, status change and automation step shows up here." action={<ButtonLink href="/app/enquiries/new" size="sm">Add an enquiry</ButtonLink>} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {d.recent.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                  <div>
                    {a.enquiryId ? <Link className="text-ink-800 hover:text-brand-700" href={`/app/enquiries/${a.enquiryId}`}>{a.summary}</Link> : <span className="text-ink-800">{a.summary}</span>}
                  </div>
                  <time className="shrink-0 text-xs text-ink-400">{formatInZone(a.createdAt, tz, "short")}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          {pending > 0 && <UpcomingCard d={d} tz={tz} />}
          <Card>
            <CardHeader title="Automation health" description="Last 7 days" action={<Link href="/app/workflows/health" className="text-sm text-brand-700">Details</Link>} />
            <dl className="grid grid-cols-3 gap-2 px-5 py-4 text-center text-sm">
              <div><dt className="text-ink-500">Done</dt><dd className="text-lg font-semibold tabular-nums">{d.health.succeeded}</dd></div>
              <div><dt className="text-ink-500">Waiting</dt><dd className="text-lg font-semibold tabular-nums">{d.health.queued + d.health.running}</dd></div>
              <div><dt className="text-ink-500">Failed</dt><dd className={`text-lg font-semibold tabular-nums ${d.health.dead ? "text-red-600" : ""}`}>{d.health.dead}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Plan usage this month" description={d.plan.name} action={<Link href="/app/billing" className="text-sm text-brand-700">Billing</Link>} />
            <div className="space-y-3 px-5 py-4">
              {(Object.keys(d.usage) as UsageMetric[]).map((m) => {
                const limit = d.plan.limits.monthly[m];
                const pct = Math.min(100, Math.round((d.usage[m] / limit) * 100));
                return (
                  <div key={m}>
                    <div className="flex justify-between text-xs text-ink-600"><span className="capitalize">{METRIC_LABELS[m]}s</span><span className="tabular-nums">{d.usage[m]} / {limit}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-ink-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${METRIC_LABELS[m]} usage`}>
                      <div className={`h-1.5 rounded-full ${pct > 90 ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function UpcomingCard({ d, tz }: { d: Awaited<ReturnType<typeof dashboard>>; tz: string }) {
  return (
    <Card>
      <CardHeader title="Upcoming appointments" action={<Link href="/app/appointments" className="text-sm text-brand-700">All</Link>} />
      {d.upcoming.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">Nothing booked yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {d.upcoming.map((a) => (
            <li key={a.id}>
              <Link href={`/app/appointments/${a.id}`} className="block px-5 py-3 hover:bg-ink-50">
                <div className="text-sm font-medium text-ink-900">{a.title}</div>
                <div className="text-xs text-ink-500">{a.contactName} · <Badge tone="teal">{formatInZone(a.startsAt, tz, "short")}</Badge></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
