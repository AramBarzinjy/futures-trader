import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isValidTimezone, parseLocalDateTime, reminderTime } from "@/lib/time";
import { assertCan, systemActor, type Actor } from "@/modules/auth/permissions";
import { loadPlan } from "@/modules/billing/entitlements";
import { enqueue } from "@/modules/automation/queue";
import { stopRunsForEnquiry } from "@/modules/automation/engine";
import { createOutbound } from "@/modules/email/messages";
import { buildVariables, renderEmail } from "@/modules/templates/render";

/*
 * Appointments and reminders.
 *
 * Every reminder job carries the appointment `version` it was scheduled for.
 * Rescheduling or cancelling bumps the version, so reminders built from old
 * details find a mismatch when they fall due and do nothing.
 */

type Appointment = typeof schema.appointments.$inferSelect;
export type AppointmentMessageKind = "confirmation" | "reminder" | "reschedule" | "cancelled";

const TEMPLATE_FOR: Record<AppointmentMessageKind, string> = {
  confirmation: "appointment_confirmation",
  reminder: "appointment_reminder",
  reschedule: "appointment_reschedule",
  cancelled: "appointment_cancelled",
};

export const appointmentInputSchema = z.object({
  contactId: z.string().uuid(),
  enquiryId: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(1, "Give the appointment a title").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time"),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  durationMinutes: z.coerce.number().int().min(5).max(24 * 60),
  location: z.string().trim().max(300).optional().or(z.literal("")),
  meetingLink: z.string().trim().url().max(500).optional().or(z.literal("")),
  assignedUserId: z.string().uuid().optional().or(z.literal("")),
  reminderOffsetsMinutes: z.array(z.number().int().min(15).max(14 * 1440)).max(5).default([1440]),
  notifyCustomer: z.boolean().default(true),
});

async function reminderWorkflow(tx: TenantTx) {
  return tx.query.workflows.findFirst({ where: eq(schema.workflows.templateKey, "appointment_reminder") });
}

/** Schedule confirmation + reminder jobs for the appointment's current version. */
async function scheduleMessages(tx: TenantTx, appt: Appointment, opening: AppointmentMessageKind | null) {
  const wf = await reminderWorkflow(tx);
  if (!wf?.enabled) return;
  const now = Date.now();
  if (opening) {
    await enqueue(tx, {
      orgId: appt.orgId,
      type: "appointment.message",
      payload: { appointmentId: appt.id, version: appt.version, kind: opening },
      dedupeKey: `appt:${appt.id}:v${appt.version}:${opening}`,
    });
  }
  for (const offset of appt.reminderOffsetsMinutes) {
    const at = reminderTime(appt.startsAt, offset, appt.timezone);
    if (at.getTime() <= now) continue; // too late for this reminder
    await enqueue(tx, {
      orgId: appt.orgId,
      type: "appointment.message",
      payload: { appointmentId: appt.id, version: appt.version, kind: "reminder", offset },
      runAt: at,
      dedupeKey: `appt:${appt.id}:v${appt.version}:reminder:${offset}`,
    });
  }
}

export async function createAppointment(actor: Actor, input: z.input<typeof appointmentInputSchema>) {
  assertCan(actor, "appointment.write");
  const data = appointmentInputSchema.parse(input);
  let startsAt: Date;
  try {
    startsAt = parseLocalDateTime(data.date, data.time, data.timezone);
  } catch (e) {
    throw new AppError(e instanceof Error ? e.message : "Invalid date");
  }
  return withTenant(actor, async (tx) => {
    const { plan } = await loadPlan(tx, actor.orgId);
    const offsets = [...new Set(data.reminderOffsetsMinutes)].sort((a, b) => b - a);
    if (offsets.length > plan.limits.reminderOffsets) {
      throw new AppError(`The ${plan.name} plan allows ${plan.limits.reminderOffsets} reminder${plan.limits.reminderOffsets === 1 ? "" : "s"} per appointment.`, "limit");
    }
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, data.contactId) });
    if (!contact) throw new AppError("Contact not found", "not_found");
    if (data.enquiryId) {
      const e = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, data.enquiryId) });
      if (!e || e.contactId !== contact.id) throw new AppError("That enquiry doesn't belong to this contact.");
    }
    const [appt] = await tx
      .insert(schema.appointments)
      .values({
        orgId: actor.orgId,
        contactId: contact.id,
        enquiryId: data.enquiryId || null,
        title: data.title,
        startsAt,
        timezone: data.timezone,
        durationMinutes: data.durationMinutes,
        location: data.location || null,
        meetingLink: data.meetingLink || null,
        assignedUserId: data.assignedUserId || null,
        reminderOffsetsMinutes: offsets,
      })
      .returning();
    await scheduleMessages(tx, appt, data.notifyCustomer ? "confirmation" : null);
    if (appt.enquiryId) {
      const booked = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, "appointment_booked") });
      if (booked) await tx.update(schema.enquiries).set({ statusKey: "appointment_booked", updatedAt: new Date() }).where(eq(schema.enquiries.id, appt.enquiryId));
      await stopRunsForEnquiry(tx, actor.orgId, appt.enquiryId, "Appointment booked");
    }
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId: appt.enquiryId,
      contactId: contact.id,
      actorUserId: actor.userId,
      type: "appointment.created",
      summary: `Appointment booked: ${appt.title}`,
      data: { appointmentId: appt.id },
    });
    return appt;
  });
}

export async function rescheduleAppointment(actor: Actor, id: string, input: { date: string; time: string; notifyCustomer: boolean }) {
  assertCan(actor, "appointment.write");
  return withTenant(actor, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, id) });
    if (!appt || appt.status !== "scheduled") throw new AppError("Only scheduled appointments can be rescheduled.", "conflict");
    let startsAt: Date;
    try {
      startsAt = parseLocalDateTime(input.date, input.time, appt.timezone);
    } catch (e) {
      throw new AppError(e instanceof Error ? e.message : "Invalid date");
    }
    const [updated] = await tx
      .update(schema.appointments)
      .set({ startsAt, version: appt.version + 1, updatedAt: new Date() })
      .where(eq(schema.appointments.id, id))
      .returning();
    await scheduleMessages(tx, updated, input.notifyCustomer ? "reschedule" : null);
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId: appt.enquiryId,
      contactId: appt.contactId,
      actorUserId: actor.userId,
      type: "appointment.rescheduled",
      summary: `Appointment moved: ${appt.title}`,
      data: { appointmentId: id, from: appt.startsAt.toISOString(), to: startsAt.toISOString() },
    });
    return updated;
  });
}

export async function setAppointmentStatus(actor: Actor, id: string, status: "cancelled" | "completed" | "no_show", notifyCustomer = false) {
  assertCan(actor, "appointment.write");
  await withTenant(actor, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, id) });
    if (!appt) throw new AppError("Appointment not found", "not_found");
    if (appt.status === status) return;
    const [updated] = await tx
      .update(schema.appointments)
      .set({ status, version: appt.version + 1, updatedAt: new Date() })
      .where(eq(schema.appointments.id, id))
      .returning();
    if (status === "cancelled" && notifyCustomer) {
      await enqueue(tx, {
        orgId: actor.orgId,
        type: "appointment.message",
        payload: { appointmentId: id, version: updated.version, kind: "cancelled" },
        dedupeKey: `appt:${id}:v${updated.version}:cancelled`,
      });
    }
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId: appt.enquiryId,
      contactId: appt.contactId,
      actorUserId: actor.userId,
      type: `appointment.${status}`,
      summary: `Appointment ${status.replace("_", "-")}: ${appt.title}`,
    });
  });
}

/**
 * Job handler. Sends a confirmation/reminder/etc. only if the appointment still
 * matches the version the job was created for.
 */
export async function sendAppointmentMessage(orgId: string, p: { appointmentId: string; version: number; kind: AppointmentMessageKind; offset?: number }) {
  await withTenant(systemActor(orgId), async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, p.appointmentId) });
    if (!appt || appt.version !== p.version) return; // superseded by a reschedule/cancel
    if (p.kind !== "cancelled" && appt.status !== "scheduled") return;
    if (p.kind === "reminder" && appt.startsAt.getTime() < Date.now()) return;
    const wf = await reminderWorkflow(tx);
    if (!wf?.enabled) return;
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, appt.contactId) });
    if (!contact?.email) return;
    const template = await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.key, TEMPLATE_FOR[p.kind]) });
    if (!template) return;
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }))!;
    const enquiry = appt.enquiryId ? await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, appt.enquiryId) }) : null;
    const r = renderEmail(template.subject, template.body, buildVariables({ org, contact, enquiry, appointment: appt }));
    await createOutbound(tx, {
      orgId,
      enquiryId: appt.enquiryId,
      contactId: contact.id,
      appointmentId: appt.id,
      toEmail: contact.email,
      subject: r.subject,
      body: r.body,
      kind: "transactional",
      templateKey: template.key,
      reviewFlags: r.missing.map((v) => `missing:${v}`),
      idempotencyKey: `appt:${appt.id}:v${appt.version}:${p.kind}:${p.offset ?? 0}`,
      autoSend: !wf.requireApproval,
    });
  });
}

export async function listAppointments(actor: Actor, range: { from: Date; to: Date }) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, (tx) =>
    tx
      .select({
        id: schema.appointments.id,
        title: schema.appointments.title,
        startsAt: schema.appointments.startsAt,
        timezone: schema.appointments.timezone,
        durationMinutes: schema.appointments.durationMinutes,
        location: schema.appointments.location,
        status: schema.appointments.status,
        contactId: schema.appointments.contactId,
        enquiryId: schema.appointments.enquiryId,
        contactName: schema.contacts.name,
        reminderOffsetsMinutes: schema.appointments.reminderOffsetsMinutes,
      })
      .from(schema.appointments)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.appointments.contactId))
      .where(and(gte(schema.appointments.startsAt, range.from), lt(schema.appointments.startsAt, range.to)))
      .orderBy(asc(schema.appointments.startsAt)),
  );
}

export async function getAppointment(actor: Actor, id: string) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, id) });
    if (!appt) throw new AppError("Appointment not found", "not_found");
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, appt.contactId) });
    const messages = await tx.query.messages.findMany({ where: and(eq(schema.messages.appointmentId, id), ne(schema.messages.status, "draft")), orderBy: (m, { desc }) => [desc(m.createdAt)] });
    return { appt, contact: contact!, messages };
  });
}

/** iCalendar (.ics) for one appointment — works with every calendar app, no integration needed. */
export function toIcs(appt: Appointment, opts: { orgName: string; contactName: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const end = new Date(appt.startsAt.getTime() + appt.durationMinutes * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Replyline//Appointments//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appt.id}-v${appt.version}@replyline`,
    `SEQUENCE:${appt.version}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(appt.startsAt)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(`${appt.title} — ${opts.contactName}`)}`,
    appt.location ? `LOCATION:${esc(appt.location)}` : "",
    appt.meetingLink ? `URL:${esc(appt.meetingLink)}` : "",
    `DESCRIPTION:${esc(`${opts.orgName} appointment`)}`,
    appt.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
