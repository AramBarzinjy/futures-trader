import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor } from "@/modules/auth/permissions";

export const normaliseEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null) || null;

/** Digits only, UK numbers rewritten to international form so 07700… and +447700… match. */
export function normalisePhone(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "44" + d.slice(1);
  d = d.replace(/\D/g, "");
  return d.length >= 7 ? d : null;
}

export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Invalid email").max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(200).optional().or(z.literal("")),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

type Contact = typeof schema.contacts.$inferSelect;

export interface ContactMatch {
  contact: Contact;
  matched: boolean;
  /** Fields where the incoming value differs from what's stored. Stored values are kept. */
  conflicts: { field: string; existing: string; incoming: string }[];
}

/**
 * Find an existing contact by email, then phone; otherwise create one.
 * Never overwrites stored details: empty fields are filled, differing values are
 * reported as conflicts for a human to resolve.
 */
export async function findOrCreateContact(tx: TenantTx, orgId: string, input: ContactInput): Promise<ContactMatch> {
  const email = normaliseEmail(input.email);
  const phone = normalisePhone(input.phone);
  let existing: Contact | undefined;
  if (email) existing = await tx.query.contacts.findFirst({ where: and(eq(schema.contacts.emailNormalised, email), isNull(schema.contacts.erasedAt)) });
  if (!existing && phone) existing = await tx.query.contacts.findFirst({ where: and(eq(schema.contacts.phoneNormalised, phone), isNull(schema.contacts.erasedAt)) });

  if (!existing) {
    const [contact] = await tx
      .insert(schema.contacts)
      .values({
        orgId,
        name: input.name,
        email: input.email || null,
        emailNormalised: email,
        phone: input.phone || null,
        phoneNormalised: phone,
        company: input.company || null,
      })
      .returning();
    return { contact, matched: false, conflicts: [] };
  }

  const conflicts: ContactMatch["conflicts"] = [];
  const fill: Partial<Contact> = {};
  const compare = (field: "name" | "email" | "phone" | "company", incoming: string | undefined, same: (a: string, b: string) => boolean) => {
    if (!incoming) return;
    const current = existing![field];
    if (!current) (fill as Record<string, unknown>)[field] = incoming;
    else if (!same(current, incoming)) conflicts.push({ field, existing: current, incoming });
  };
  compare("name", input.name, (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase());
  compare("email", input.email, (a, b) => normaliseEmail(a) === normaliseEmail(b));
  compare("phone", input.phone, (a, b) => normalisePhone(a) === normalisePhone(b));
  compare("company", input.company, (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase());
  if (fill.email) fill.emailNormalised = email;
  if (fill.phone) fill.phoneNormalised = phone;

  let contact = existing;
  if (Object.keys(fill).length) {
    [contact] = await tx.update(schema.contacts).set({ ...fill, updatedAt: new Date() }).where(eq(schema.contacts.id, existing.id)).returning();
  }
  return { contact, matched: true, conflicts };
}

export async function listContacts(actor: Actor, opts: { q?: string; page?: number; pageSize?: number } = {}) {
  assertCan(actor, "enquiry.read");
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  return withTenant(actor, async (tx) => {
    const where = and(
      isNull(schema.contacts.erasedAt),
      opts.q
        ? or(
            ilike(schema.contacts.name, `%${escapeLike(opts.q)}%`),
            ilike(schema.contacts.email, `%${escapeLike(opts.q)}%`),
            ilike(schema.contacts.company, `%${escapeLike(opts.q)}%`),
            ilike(schema.contacts.phone, `%${escapeLike(opts.q)}%`),
          )
        : undefined,
    );
    const rows = await tx
      .select({
        id: schema.contacts.id,
        name: schema.contacts.name,
        email: schema.contacts.email,
        phone: schema.contacts.phone,
        company: schema.contacts.company,
        marketingConsent: schema.contacts.marketingConsent,
        createdAt: schema.contacts.createdAt,
        enquiryCount: sql<number>`(select count(*)::int from enquiries e where e.contact_id = ${schema.contacts.id})`,
      })
      .from(schema.contacts)
      .where(where)
      .orderBy(asc(schema.contacts.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(schema.contacts).where(where);
    return { rows, total, page, pageSize };
  });
}

export async function getContact(actor: Actor, id: string) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, id) });
    if (!contact) throw new AppError("Contact not found", "not_found");
    const enquiries = await tx.query.enquiries.findMany({
      where: eq(schema.enquiries.contactId, id),
      orderBy: [desc(schema.enquiries.createdAt)],
    });
    return { contact, enquiries };
  });
}

export const contactUpdateSchema = contactInputSchema.extend({
  notes: z.string().max(5000).optional(),
});

/** Explicit, user-initiated edit. This is the only path that may change stored details. */
export async function updateContact(actor: Actor, id: string, input: z.input<typeof contactUpdateSchema>) {
  assertCan(actor, "enquiry.write");
  const data = contactUpdateSchema.parse(input);
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .update(schema.contacts)
      .set({
        name: data.name,
        email: data.email || null,
        emailNormalised: normaliseEmail(data.email),
        phone: data.phone || null,
        phoneNormalised: normalisePhone(data.phone),
        company: data.company || null,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.erasedAt)))
      .returning({ id: schema.contacts.id });
    if (!row) throw new AppError("Contact not found", "not_found");
    await tx.insert(schema.activities).values({ orgId: actor.orgId, contactId: id, actorUserId: actor.userId, type: "contact.updated", summary: "Contact details edited" });
  });
}

/** Record marketing consent (or its withdrawal) with its source, per UK GDPR accountability. */
export async function setMarketingConsent(actor: Actor, contactId: string, consent: "granted" | "withdrawn", source: string) {
  assertCan(actor, "enquiry.write");
  await withTenant(actor, async (tx) => {
    const [row] = await tx
      .update(schema.contacts)
      .set({ marketingConsent: consent, consentSource: source.slice(0, 200), consentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.contacts.id, contactId))
      .returning({ id: schema.contacts.id });
    if (!row) throw new AppError("Contact not found", "not_found");
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      contactId,
      actorUserId: actor.userId,
      type: "consent.changed",
      summary: `Marketing consent ${consent} (${source.slice(0, 80)})`,
    });
  });
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
