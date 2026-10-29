import { and, eq, inArray, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { sequential } from "@/lib/db/sequential";
import { schema, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, systemActor, type Actor } from "@/modules/auth/permissions";
import { audit } from "@/modules/audit/service";
import { addSuppression } from "./suppression";

/*
 * Data subject rights and retention (UK GDPR Arts. 15, 17 and 5(1)(e)).
 * These are tools for the business, which is the data controller; Replyline
 * acts as its processor. They do not by themselves make a business compliant.
 */

/** Everything held about one contact, as JSON, for a subject access request. */
export async function exportContactData(actor: Actor, contactId: string) {
  assertCan(actor, "data.erase_contact");
  return withTenant(actor, async (tx) => {
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) });
    if (!contact) throw new AppError("Contact not found", "not_found");
    const enquiries = await tx.query.enquiries.findMany({ where: eq(schema.enquiries.contactId, contactId) });
    const ids = enquiries.map((e) => e.id);
    const [messages, notes, appointments, activities] = await sequential([
      () => tx.query.messages.findMany({ where: eq(schema.messages.contactId, contactId) }),
      () => ids.length ? tx.query.notes.findMany({ where: inArray(schema.notes.enquiryId, ids) }) : Promise.resolve([]),
      () => tx.query.appointments.findMany({ where: eq(schema.appointments.contactId, contactId) }),
      () => tx.query.activities.findMany({ where: eq(schema.activities.contactId, contactId) }),
    ] as const);
    await audit(tx, actor, "data.contact_exported", { type: "contact", id: contactId });
    return {
      exportedAt: new Date().toISOString(),
      contact: { ...contact, emailNormalised: undefined, phoneNormalised: undefined },
      enquiries,
      messages: messages.map((m) => ({ direction: m.direction, status: m.status, subject: m.subject, body: m.body, sentAt: m.sentAt, createdAt: m.createdAt })),
      internalNotes: notes.map((n) => ({ body: n.body, createdAt: n.createdAt })),
      appointments,
      activity: activities.map((a) => ({ type: a.type, summary: a.summary, createdAt: a.createdAt })),
    };
  });
}

/**
 * Erase a contact's personal data. The record is kept as an anonymous shell so
 * reporting counts stay correct, and the address is added to the suppression
 * list (as a hash) so a later import can't silently re-contact them.
 */
export async function eraseContact(actor: Actor, contactId: string) {
  assertCan(actor, "data.erase_contact");
  await withTenant(actor, async (tx) => {
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) });
    if (!contact) throw new AppError("Contact not found", "not_found");
    if (contact.erasedAt) return;
    if (contact.email) await addSuppression(tx, actor.orgId, contact.email, "all", "erasure");
    const enquiryIds = (await tx.select({ id: schema.enquiries.id }).from(schema.enquiries).where(eq(schema.enquiries.contactId, contactId))).map((r) => r.id);
    await tx
      .update(schema.contacts)
      .set({ name: "Erased contact", email: null, emailNormalised: null, phone: null, phoneNormalised: null, company: null, notes: null, customFields: {}, consentSource: null, erasedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.contacts.id, contactId));
    await tx
      .update(schema.messages)
      .set({ subject: "[erased]", body: "[erased]", toEmail: null, fromEmail: null })
      .where(eq(schema.messages.contactId, contactId));
    await tx.update(schema.messages).set({ status: "cancelled", error: "Contact erased" }).where(and(eq(schema.messages.contactId, contactId), inArray(schema.messages.status, ["pending_approval", "queued", "draft"])));
    if (enquiryIds.length) {
      await tx.update(schema.enquiries).set({ subject: "[erased]", message: "", customFields: {} }).where(inArray(schema.enquiries.id, enquiryIds));
      await tx.delete(schema.notes).where(inArray(schema.notes.enquiryId, enquiryIds));
      await tx.update(schema.workflowRuns).set({ status: "stopped", stopReason: "Contact erased", finishedAt: new Date() }).where(and(inArray(schema.workflowRuns.enquiryId, enquiryIds), eq(schema.workflowRuns.status, "running")));
    }
    await tx.update(schema.appointments).set({ location: null, meetingLink: null, title: "[erased]" }).where(eq(schema.appointments.contactId, contactId));
    await tx.update(schema.activities).set({ summary: "[erased]", data: {} }).where(eq(schema.activities.contactId, contactId));
    await audit(tx, actor, "data.contact_erased", { type: "contact", id: contactId });
  });
}

/** Full workspace export (owner only). Integration tokens are never included. */
export async function exportOrganization(actor: Actor) {
  assertCan(actor, "data.export_all");
  return withTenant(actor, async (tx) => {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    const out = {
      exportedAt: new Date().toISOString(),
      organization: { ...org, formKey: undefined },
      statuses: await tx.query.pipelineStatuses.findMany(),
      contacts: await tx.query.contacts.findMany(),
      enquiries: await tx.query.enquiries.findMany(),
      notes: await tx.query.notes.findMany(),
      messages: await tx.query.messages.findMany(),
      appointments: await tx.query.appointments.findMany(),
      templates: await tx.query.emailTemplates.findMany(),
      workflows: await tx.query.workflows.findMany(),
      reports: await tx.query.reports.findMany(),
      auditLog: await tx.query.auditLogs.findMany(),
    };
    await audit(tx, actor, "data.workspace_exported");
    return out;
  });
}

/** Permanently delete the workspace and everything in it. Requires typing the workspace name. */
export async function deleteOrganization(actor: Actor, confirmName: string) {
  assertCan(actor, "org.delete");
  await withTenant(actor, async (tx) => {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    if (!org) throw new AppError("Workspace not found", "not_found");
    if (confirmName.trim() !== org.name) throw new AppError("Type the workspace name exactly to confirm.");
    if (org.subscriptionStatus === "active" && org.stripeSubscriptionId) {
      throw new AppError("Cancel the subscription in Billing before deleting the workspace.", "conflict");
    }
    await tx.delete(schema.organizations).where(eq(schema.organizations.id, actor.orgId));
  });
}

/**
 * Retention: remove enquiries closed longer ago than the workspace's retention
 * period, then contacts left with nothing. Run daily by the worker.
 */
export async function purgeExpiredData(orgId: string, now = new Date()) {
  return withTenant(systemActor(orgId), async (tx) => {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
    if (!org) return { enquiries: 0, contacts: 0 };
    const cutoff = DateTime.fromJSDate(now).minus({ months: org.settings.retentionMonths }).toJSDate();
    const deleted = await tx
      .delete(schema.enquiries)
      .where(and(isNotNull(schema.enquiries.closedAt), lt(schema.enquiries.closedAt, cutoff)))
      .returning({ id: schema.enquiries.id });
    const orphans = await tx
      .delete(schema.contacts)
      .where(
        and(
          lt(schema.contacts.updatedAt, cutoff),
          notExists(tx.select({ x: sql`1` }).from(schema.enquiries).where(eq(schema.enquiries.contactId, schema.contacts.id))),
          notExists(tx.select({ x: sql`1` }).from(schema.appointments).where(eq(schema.appointments.contactId, schema.contacts.id))),
        ),
      )
      .returning({ id: schema.contacts.id });
    await tx.delete(schema.jobs).where(and(eq(schema.jobs.status, "succeeded"), lt(schema.jobs.updatedAt, new Date(now.getTime() - 30 * 86_400_000))));
    if (deleted.length || orphans.length) {
      await audit(tx, systemActor(orgId), "data.retention_purge", undefined, { enquiries: deleted.length, contacts: orphans.length, months: org.settings.retentionMonths });
    }
    return { enquiries: deleted.length, contacts: orphans.length };
  });
}

