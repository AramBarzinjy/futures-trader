import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatInZone } from "@/lib/time";
import { assertCan, systemActor, type Actor } from "@/modules/auth/permissions";
import { enqueue } from "@/modules/automation/queue";
import type { ReportMetrics, ReportSuggestion } from "@/lib/db/schema";
import { nextReportTime } from "./schedule";

/*
 * Weekly prospect report. Every number is a count over stored rows for the
 * period; nothing is estimated. Suggestions are rule-based and each one names
 * the enquiry it is about, so it can be checked.
 */

export const QUIET_AFTER_DAYS = 7;

export async function computeMetrics(tx: TenantTx, orgId: string, start: Date, end: Date, tz: string, now = new Date()): Promise<ReportMetrics> {
  const e = schema.enquiries;
  const c = schema.contacts;
  const inPeriod = and(gte(e.createdAt, start), lt(e.createdAt, end));

  const bySourceRows = await tx.select({ source: e.source, n: sql<number>`count(*)::int` }).from(e).where(inPeriod).groupBy(e.source);
  const bySource = Object.fromEntries(bySourceRows.map((r) => [r.source, r.n]));
  const newEnquiries = bySourceRows.reduce((a, r) => a + r.n, 0);

  // Needing a response: open, and either never answered or the customer spoke last.
  const [{ n: needingResponse }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(e)
    .where(and(isNull(e.closedAt), sql`(${e.lastOutboundAt} is null or (${e.lastInboundAt} is not null and ${e.lastInboundAt} > ${e.lastOutboundAt}))`));

  const [{ n: overdueFollowUps }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(e)
    .where(and(isNull(e.closedAt), lt(e.nextFollowUpAt, now)));

  const [{ n: appointmentsScheduled }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .where(and(gte(schema.appointments.createdAt, start), lt(schema.appointments.createdAt, end)));

  const quietCutoff = new Date(now.getTime() - QUIET_AFTER_DAYS * 86_400_000);
  const quietRows = await tx
    .select({ id: e.id, subject: e.subject, contactName: c.name, lastActivity: sql<Date>`greatest(${e.lastInboundAt}, ${e.lastOutboundAt}, ${e.createdAt})` })
    .from(e)
    .innerJoin(c, eq(c.id, e.contactId))
    .where(and(isNull(e.closedAt), isNotNull(e.lastOutboundAt), sql`greatest(${e.lastInboundAt}, ${e.lastOutboundAt}, ${e.createdAt}) < ${quietCutoff}`))
    .orderBy(asc(sql`greatest(${e.lastInboundAt}, ${e.lastOutboundAt}, ${e.createdAt})`))
    .limit(10);
  const goneQuiet = quietRows.map((r) => ({ id: r.id, subject: r.subject, contactName: r.contactName, daysQuiet: Math.floor((now.getTime() - new Date(r.lastActivity).getTime()) / 86_400_000) }));

  const closedIn = async (outcome: "won" | "lost") =>
    tx
      .select({ id: e.id, subject: e.subject, contactName: c.name })
      .from(e)
      .innerJoin(c, eq(c.id, e.contactId))
      .innerJoin(schema.pipelineStatuses, eq(schema.pipelineStatuses.key, e.statusKey))
      .where(and(eq(schema.pipelineStatuses.outcome, outcome), gte(e.closedAt, start), lt(e.closedAt, end)))
      .orderBy(desc(e.closedAt))
      .limit(10);
  const won = await closedIn("won");
  const lost = await closedIn("lost");

  const upcoming = await tx
    .select({ id: schema.appointments.id, title: schema.appointments.title, startsAt: schema.appointments.startsAt, contactName: c.name })
    .from(schema.appointments)
    .innerJoin(c, eq(c.id, schema.appointments.contactId))
    .where(and(eq(schema.appointments.status, "scheduled"), gte(schema.appointments.startsAt, now), lt(schema.appointments.startsAt, new Date(now.getTime() + 7 * 86_400_000))))
    .orderBy(asc(schema.appointments.startsAt))
    .limit(10);

  // Comparison with the previous period, only if the account existed for all of it.
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { createdAt: true } });
  let previous: ReportMetrics["previous"] = null;
  if (org && org.createdAt <= prevStart) {
    const prevIn = and(gte(e.createdAt, prevStart), lt(e.createdAt, start));
    const [{ n: pe }] = await tx.select({ n: sql<number>`count(*)::int` }).from(e).where(prevIn);
    const [{ n: pa }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.appointments)
      .where(and(gte(schema.appointments.createdAt, prevStart), lt(schema.appointments.createdAt, start)));
    const [{ n: pw }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(e)
      .innerJoin(schema.pipelineStatuses, eq(schema.pipelineStatuses.key, e.statusKey))
      .where(and(eq(schema.pipelineStatuses.outcome, "won"), gte(e.closedAt, prevStart), lt(e.closedAt, start)));
    previous = { newEnquiries: pe, appointmentsScheduled: pa, won: pw };
  }

  return {
    periodLabel: `${formatInZone(start, tz, "date")} – ${formatInZone(new Date(end.getTime() - 1), tz, "date")}`,
    newEnquiries,
    bySource,
    needingResponse,
    overdueFollowUps,
    appointmentsScheduled,
    goneQuiet,
    won,
    lost,
    upcomingAppointments: upcoming.map((u) => ({ ...u, startsAt: u.startsAt.toISOString() })),
    previous,
  };
}

/** Deterministic suggestions. Each is traceable to the metric that produced it. */
export function suggestActions(m: ReportMetrics): ReportSuggestion[] {
  const out: ReportSuggestion[] = [];
  if (m.needingResponse > 0) out.push({ source: "rule", text: `${m.needingResponse} open enquir${m.needingResponse === 1 ? "y is" : "ies are"} waiting on a reply from you. Start there.` });
  if (m.overdueFollowUps > 0) out.push({ source: "rule", text: `${m.overdueFollowUps} follow-up${m.overdueFollowUps === 1 ? " is" : "s are"} overdue.` });
  for (const q of m.goneQuiet.slice(0, 3)) {
    out.push({ source: "rule", enquiryId: q.id, text: `${q.contactName} ("${q.subject}") has been quiet for ${q.daysQuiet} days — follow up or close it.` });
  }
  if (m.upcomingAppointments.length) out.push({ source: "rule", text: `${m.upcomingAppointments.length} appointment${m.upcomingAppointments.length === 1 ? "" : "s"} in the next 7 days — check reminders are set.` });
  if (!out.length) out.push({ source: "rule", text: "Nothing urgent. Your pipeline is up to date." });
  return out;
}

/** Generate (or return the existing) report for the week ending at `periodEnd`. Idempotent per period. */
export async function generateWeeklyReport(orgId: string, periodEnd: Date) {
  return withTenant(systemActor(orgId), async (tx) => {
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }))!;
    const end = periodEnd;
    const start = DateTime.fromJSDate(end, { zone: org.timezone }).minus({ weeks: 1 }).toJSDate();
    const existing = await tx.query.reports.findFirst({ where: eq(schema.reports.periodStart, start) });
    if (existing) return existing;
    const metrics = await computeMetrics(tx, orgId, start, end, org.timezone);
    const [report] = await tx
      .insert(schema.reports)
      .values({ orgId, periodStart: start, periodEnd: end, metrics, suggestions: suggestActions(metrics) })
      .onConflictDoNothing()
      .returning();
    if (!report) return (await tx.query.reports.findFirst({ where: eq(schema.reports.periodStart, start) }))!;

    const recipients = org.settings.report.emailEnabled ? org.settings.report.recipients : [];
    if (recipients.length) {
      // Report emails go to the business's own staff, recorded as internal messages without a contact.
      for (const to of recipients) {
        await tx.insert(schema.messages).values({
          orgId,
          direction: "outbound",
          status: "queued",
          kind: "transactional",
          toEmail: to,
          subject: `Weekly prospect report: ${metrics.periodLabel}`,
          body: reportAsText(org.name, metrics, report.suggestions),
          idempotencyKey: `report:${report.id}:${to}`,
        }).onConflictDoNothing();
      }
      const queued = await tx.query.messages.findMany({ where: sql`${schema.messages.idempotencyKey} like ${`report:${report.id}:%`}` });
      for (const m of queued) {
        await enqueue(tx, { orgId, type: "email.send", payload: { messageId: m.id }, dedupeKey: `send:${m.id}` });
      }
      await tx.update(schema.reports).set({ emailedTo: recipients }).where(eq(schema.reports.id, report.id));
    }
    return report;
  });
}

export function reportAsText(orgName: string, m: ReportMetrics, s: ReportSuggestion[]) {
  const delta = (now: number, prev?: number) => (prev === undefined ? "" : ` (previous week: ${prev})`);
  return [
    `${orgName} — weekly prospect report`,
    m.periodLabel,
    "",
    `New enquiries: ${m.newEnquiries}${delta(m.newEnquiries, m.previous?.newEnquiries)}`,
    ...Object.entries(m.bySource).map(([k, v]) => `  · ${k}: ${v}`),
    `Waiting on your reply: ${m.needingResponse}`,
    `Overdue follow-ups: ${m.overdueFollowUps}`,
    `Appointments booked: ${m.appointmentsScheduled}${delta(m.appointmentsScheduled, m.previous?.appointmentsScheduled)}`,
    `Won: ${m.won.length} · Lost: ${m.lost.length}`,
    "",
    "Suggested next actions (generated from the figures above):",
    ...s.map((x) => `  - ${x.text}`),
  ].join("\n");
}

export async function listReports(actor: Actor) {
  assertCan(actor, "report.read");
  return withTenant(actor, (tx) => tx.query.reports.findMany({ orderBy: [desc(schema.reports.periodStart)], limit: 52 }));
}

export async function getReport(actor: Actor, id: string) {
  assertCan(actor, "report.read");
  return withTenant(actor, async (tx) => {
    const r = await tx.query.reports.findFirst({ where: eq(schema.reports.id, id) });
    if (!r) throw new AppError("Report not found", "not_found");
    return r;
  });
}

/** "Generate now" from the Reports page: covers the last 7 days up to this moment. */
export async function generateReportNow(actor: Actor) {
  assertCan(actor, "report.read");
  const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  return generateWeeklyReport(actor.orgId, end);
}

/** Called by the worker tick: enqueue reports for every org whose time has come. */
export async function scheduleDueReports(sysTx: TenantTx) {
  const due = await sysTx
    .select({ id: schema.organizations.id, nextReportAt: schema.organizations.nextReportAt, timezone: schema.organizations.timezone, settings: schema.organizations.settings })
    .from(schema.organizations)
    .where(lt(schema.organizations.nextReportAt, new Date()));
  for (const o of due) {
    const wf = await sysTx.query.workflows.findFirst({ where: and(eq(schema.workflows.orgId, o.id), eq(schema.workflows.templateKey, "weekly_summary")) });
    if (wf?.enabled) {
      await enqueue(sysTx, {
        orgId: o.id,
        type: "report.weekly",
        payload: { periodEnd: o.nextReportAt!.toISOString() },
        dedupeKey: `report:${o.id}:${o.nextReportAt!.toISOString()}`,
      });
    }
    await sysTx
      .update(schema.organizations)
      .set({ nextReportAt: nextReportTime(new Date(), o.settings.report, o.timezone) })
      .where(eq(schema.organizations.id, o.id));
  }
  return due.length;
}
