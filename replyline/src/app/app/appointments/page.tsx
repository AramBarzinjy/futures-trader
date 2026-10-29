import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarDays } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { listAppointments } from "@/modules/appointments/service";
import { getOrganization } from "@/modules/orgs/service";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { formatInZone } from "@/lib/time";

export const metadata = { title: "Appointments" };

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await requireApp();
  const org = await getOrganization(actor);
  const tz = org.timezone;
  const past = sp.range === "past";
  const now = DateTime.now().setZone(tz);
  const range = past ? { from: now.minus({ days: 90 }).toJSDate(), to: now.toJSDate() } : { from: now.startOf("day").toJSDate(), to: now.plus({ days: 60 }).toJSDate() };
  const rows = await listAppointments(actor, range);
  const byDay = new Map<string, typeof rows>();
  for (const r of past ? [...rows].reverse() : rows) {
    const key = DateTime.fromJSDate(r.startsAt, { zone: tz }).toISODate()!;
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  return (
    <>
      <PageHeader title="Appointments" description={`Times shown in ${tz}.`} actions={<ButtonLink href="/app/appointments/new">New appointment</ButtonLink>} />
      <div className="mb-4 flex gap-2">
        <Link href="/app/appointments" className={cx("rounded-full px-3 py-1.5 text-sm", !past ? "bg-ink-900 text-white" : "bg-white ring-1 ring-ink-200")}>Upcoming</Link>
        <Link href="/app/appointments?range=past" className={cx("rounded-full px-3 py-1.5 text-sm", past ? "bg-ink-900 text-white" : "bg-white ring-1 ring-ink-200")}>Past 90 days</Link>
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays size={20} />} title="No appointments" description="Book one from an enquiry, or create one here. Reminders are scheduled automatically." action={<ButtonLink size="sm" href="/app/appointments/new">New appointment</ButtonLink>} /></Card>
      ) : (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold text-ink-700">{DateTime.fromISO(day, { zone: tz }).setLocale("en-GB").toFormat("cccc d LLLL")}</h2>
              <Card>
                <ul className="divide-y divide-ink-100">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={`/app/appointments/${a.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm hover:bg-ink-50">
                        <span className="w-14 font-semibold tabular-nums text-ink-900">{formatInZone(a.startsAt, tz, "time")}</span>
                        <span className="flex-1"><span className="font-medium text-ink-900">{a.title}</span> · {a.contactName}{a.location && <span className="text-ink-500"> · {a.location}</span>}</span>
                        <span className="text-xs text-ink-500">{a.durationMinutes} min</span>
                        <Badge tone={a.status === "scheduled" ? "teal" : a.status === "cancelled" ? "red" : "slate"}>{a.status.replace("_", "-")}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
