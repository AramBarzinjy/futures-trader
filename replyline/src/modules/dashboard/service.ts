import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { sequential } from "@/lib/db/sequential";
import { schema, withTenant } from "@/lib/db";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { effectivePlan, getUsage } from "@/modules/billing/entitlements";

/** Every figure here is a direct count over stored rows. Each links to the list it counts. */
export async function dashboard(actor: Actor) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) }))!;
    const tz = org.timezone;
    const now = new Date();
    const weekStart = DateTime.fromJSDate(now, { zone: tz }).startOf("week").toJSDate();
    const endOfToday = DateTime.fromJSDate(now, { zone: tz }).endOf("day").toJSDate();
    const e = schema.enquiries;
    const count = async (where: ReturnType<typeof and>) => (await tx.select({ n: sql<number>`count(*)::int` }).from(e).where(where))[0].n;

    const [newThisWeek, awaitingResponse, dueToday, overdue] = await sequential([
      () => count(gte(e.createdAt, weekStart)),
      () => count(and(isNull(e.closedAt), sql`(${e.lastOutboundAt} is null or (${e.lastInboundAt} is not null and ${e.lastInboundAt} > ${e.lastOutboundAt}))`)),
      () => count(and(isNull(e.closedAt), gte(e.nextFollowUpAt, now), lt(e.nextFollowUpAt, endOfToday))),
      () => count(and(isNull(e.closedAt), lt(e.nextFollowUpAt, now))),
    ] as const);
    const [{ n: pendingApproval }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.messages).where(eq(schema.messages.status, "pending_approval"));

    const upcoming = await tx
      .select({ id: schema.appointments.id, title: schema.appointments.title, startsAt: schema.appointments.startsAt, contactName: schema.contacts.name })
      .from(schema.appointments)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.appointments.contactId))
      .where(and(eq(schema.appointments.status, "scheduled"), gte(schema.appointments.startsAt, now)))
      .orderBy(asc(schema.appointments.startsAt))
      .limit(5);

    const recent = await tx.query.activities.findMany({ orderBy: [desc(schema.activities.createdAt)], limit: 12 });

    // Eight weeks of new enquiries, bucketed by local week.
    const eightWeeksAgo = DateTime.fromJSDate(weekStart, { zone: tz }).minus({ weeks: 7 }).toJSDate();
    const weekly = await tx
      .select({ week: sql<string>`to_char(date_trunc('week', ${e.createdAt} at time zone ${tz}), 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(e)
      .where(gte(e.createdAt, eightWeeksAgo))
      .groupBy(sql`1`);
    const trend = Array.from({ length: 8 }, (_, i) => {
      const wk = DateTime.fromJSDate(eightWeeksAgo, { zone: tz }).plus({ weeks: i });
      const key = wk.toFormat("yyyy-MM-dd");
      return { week: key, label: wk.toFormat("d LLL"), count: weekly.find((w) => w.week === key)?.n ?? 0 };
    });

    const jobRows = await tx
      .select({ status: schema.jobs.status, n: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(sql`${schema.jobs.status} in ('queued','running','dead') or ${schema.jobs.updatedAt} > now() - interval '7 days'`)
      .groupBy(schema.jobs.status);
    const health = { queued: 0, running: 0, succeeded: 0, dead: 0 };
    for (const r of jobRows) health[r.status as keyof typeof health] = r.n;

    const [{ n: totalEnquiries }] = await tx.select({ n: sql<number>`count(*)::int` }).from(e);
    const plan = effectivePlan(org);
    const usage = await getUsage(tx, actor.orgId);

    return { org, newThisWeek, awaitingResponse, dueToday, overdue, pendingApproval, upcoming, recent, trend, health, plan, usage, totalEnquiries };
  });
}
