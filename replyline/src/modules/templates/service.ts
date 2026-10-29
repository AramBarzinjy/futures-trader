import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { audit } from "@/modules/audit/service";
import { templatesFor, type IndustryKey } from "@/config/industries";
import { buildVariables, renderEmail, SAMPLE_VARS, validateTemplate } from "./render";

export async function listTemplates(actor: Actor) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, (tx) => tx.query.emailTemplates.findMany({ orderBy: [asc(schema.emailTemplates.name)] }));
}

export async function getTemplate(actor: Actor, id: string) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const t = await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.id, id) });
    if (!t) throw new AppError("Template not found", "not_found");
    return t;
  });
}

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  purpose: z.string().trim().max(300).default(""),
  kind: z.enum(["transactional", "marketing"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

export async function saveTemplate(actor: Actor, id: string | null, input: z.input<typeof templateSchema>) {
  assertCan(actor, "template.write");
  const data = templateSchema.parse(input);
  const errors = validateTemplate(data.subject, data.body);
  if (errors.length) throw new AppError(errors.join(" "));
  return withTenant(actor, async (tx) => {
    if (id) {
      const [row] = await tx.update(schema.emailTemplates).set({ ...data, updatedAt: new Date() }).where(eq(schema.emailTemplates.id, id)).returning();
      if (!row) throw new AppError("Template not found", "not_found");
      await audit(tx, actor, "template.updated", { type: "template", id }, { key: row.key, kind: row.kind });
      return row;
    }
    const key = `custom_${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}_${Date.now().toString(36)}`;
    const [row] = await tx.insert(schema.emailTemplates).values({ orgId: actor.orgId, key, ...data }).returning();
    await audit(tx, actor, "template.created", { type: "template", id: row.id });
    return row;
  });
}

/** Put a built-in template back to the industry default text. */
export async function resetTemplate(actor: Actor, id: string) {
  assertCan(actor, "template.write");
  await withTenant(actor, async (tx) => {
    const t = await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.id, id) });
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    const seed = templatesFor(org!.industry as IndustryKey).find((s) => s.key === t?.key);
    if (!t || !seed) throw new AppError("Only built-in templates can be reset.");
    await tx.update(schema.emailTemplates).set({ name: seed.name, subject: seed.subject, body: seed.body, kind: seed.kind, purpose: seed.purpose, updatedAt: new Date() }).where(eq(schema.emailTemplates.id, id));
  });
}

export async function deleteTemplate(actor: Actor, id: string) {
  assertCan(actor, "template.write");
  await withTenant(actor, async (tx) => {
    const t = await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.id, id) });
    if (!t) throw new AppError("Template not found", "not_found");
    if (!t.key.startsWith("custom_")) throw new AppError("Built-in templates can be edited or reset, not deleted — workflows depend on them.");
    await tx.delete(schema.emailTemplates).where(and(eq(schema.emailTemplates.id, id)));
  });
}

/** Render a template with sample data, or with a real enquiry's data. */
export async function previewTemplate(actor: Actor, subject: string, body: string, enquiryId?: string) {
  assertCan(actor, "enquiry.read");
  const errors = validateTemplate(subject, body);
  if (!enquiryId) return { ...renderEmail(subject, body, SAMPLE_VARS), errors };
  return withTenant(actor, async (tx) => {
    const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
    if (!enquiry) throw new AppError("Enquiry not found", "not_found");
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) });
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) }))!;
    const assigned = enquiry.assignedUserId ? await tx.query.users.findFirst({ where: eq(schema.users.id, enquiry.assignedUserId), columns: { name: true } }) : null;
    const appt = await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.enquiryId, enquiryId), eq(schema.appointments.status, "scheduled")) });
    return { ...renderEmail(subject, body, buildVariables({ org, contact, enquiry, appointment: appt, assignedUserName: assigned?.name })), errors };
  });
}
