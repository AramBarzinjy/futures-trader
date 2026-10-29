import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, systemDb, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { systemActor } from "@/modules/auth/permissions";
import { hasFeature } from "@/modules/billing/entitlements";
import { normaliseEmail } from "@/modules/contacts/service";
import { recordInbound } from "@/modules/email/messages";
import { createEnquiryTx } from "./service";

/*
 * Public entry points: the website form and the inbound-email webhook.
 * Both resolve the tenant from a key, rate-limit, validate, and hand off to
 * createEnquiryTx. Neither ever returns stored data to the caller.
 */

export const publicFormSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().email("Please enter a valid email").max(254),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  subject: z.string().trim().max(150).optional().or(z.literal("")),
  message: z.string().trim().min(5, "Please tell us a little about what you need").max(5000),
  marketingConsent: z.boolean().default(false),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().max(500).optional(),
  /** Milliseconds the form was open; humans take longer than 2 seconds. */
  elapsedMs: z.number().int().min(0).optional(),
});

export async function resolveFormKey(formKey: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(formKey)) return null;
  const org = await systemDb().query.organizations.findFirst({ where: eq(schema.organizations.formKey, formKey), columns: { id: true, name: true } });
  return org ?? null;
}

/**
 * Returns "accepted" for both genuine and silently-dropped spam, so bots
 * learn nothing. Only validation errors are reported back.
 */
export async function submitPublicForm(formKey: string, raw: unknown, ip: string): Promise<"accepted"> {
  const org = await resolveFormKey(formKey);
  if (!org) throw new AppError("This form is not available.", "not_found");
  await checkRateLimit(`form:${org.id}:${ip}`, 5, 600);
  await checkRateLimit(`form:${org.id}`, 300, 3600);
  const data = publicFormSchema.parse(raw);
  if (data.website || (data.elapsedMs !== undefined && data.elapsedMs < 2000)) return "accepted";
  if ((data.message.match(/https?:\/\//g) ?? []).length > 3) return "accepted";

  await withTenant(systemActor(org.id), async (tx) => {
    await createEnquiryTx(
      tx,
      org.id,
      null,
      {
        contact: { name: data.name, email: data.email, phone: data.phone, company: data.company },
        subject: data.subject || data.message.slice(0, 60),
        message: data.message,
        source: "Website form",
        marketingConsent: data.marketingConsent,
      },
      { consentSource: "Website form checkbox" },
    );
  });
  return "accepted";
}

export const inboundEmailSchema = z.object({
  from: z.object({ email: z.string().email(), name: z.string().max(200).optional() }),
  subject: z.string().max(300).default("(no subject)"),
  text: z.string().max(100_000).default(""),
  receivedAt: z.coerce.date().optional(),
});

/**
 * An email forwarded to the workspace. If the sender has an open enquiry it's
 * recorded as their reply (which stops follow-ups); otherwise it becomes a new
 * enquiry — on plans that include automated capture.
 */
export async function receiveInboundEmail(formKey: string, raw: unknown): Promise<{ result: "reply" | "new_enquiry" | "ignored" }> {
  const org = await resolveFormKey(formKey);
  if (!org) throw new AppError("Unknown workspace", "not_found");
  await checkRateLimit(`inbound:${org.id}`, 600, 3600);
  const mail = inboundEmailSchema.parse(raw);
  return withTenant(systemActor(org.id), async (tx) => {
    const email = normaliseEmail(mail.from.email)!;
    const contact = await tx.query.contacts.findFirst({ where: and(eq(schema.contacts.emailNormalised, email), isNull(schema.contacts.erasedAt)) });
    const open = contact
      ? await tx.query.enquiries.findFirst({
          where: and(eq(schema.enquiries.contactId, contact.id), isNull(schema.enquiries.closedAt)),
          orderBy: [desc(schema.enquiries.createdAt)],
        })
      : undefined;
    if (open) {
      await recordInbound(tx, org.id, { enquiryId: open.id, subject: mail.subject, body: mail.text, fromEmail: mail.from.email, receivedAt: mail.receivedAt });
      return { result: "reply" as const };
    }
    if (!(await hasFeature(tx, org.id, "automatedCapture"))) return { result: "ignored" as const };
    await createEnquiryTx(tx, org.id, null, {
      contact: { name: mail.from.name || mail.from.email, email: mail.from.email },
      subject: mail.subject.slice(0, 200) || "Email enquiry",
      message: mail.text,
      source: "Email",
    });
    return { result: "new_enquiry" as const };
  });
}
