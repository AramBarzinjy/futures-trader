import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { AppError, PlanLimitError } from "@/lib/errors";
import { assertCan, systemActor, type Actor } from "@/modules/auth/permissions";
import { consumeUsage } from "@/modules/billing/entitlements";
import { addSuppression, sendBlockReason, unsubscribeUrl } from "@/modules/compliance/suppression";
import { enqueue } from "@/modules/automation/queue";
import { EmailProviderError, getEmailProvider } from "./provider";

type Message = typeof schema.messages.$inferSelect;

export interface NewOutbound {
  orgId: string;
  enquiryId?: string | null;
  contactId: string;
  appointmentId?: string | null;
  toEmail: string | null;
  subject: string;
  body: string;
  kind: "transactional" | "marketing";
  templateKey?: string | null;
  aiGenerated?: boolean;
  reviewFlags?: string[];
  idempotencyKey?: string;
  workflowRunId?: string | null;
  createdBy?: string | null;
  /** Queue for sending now. Ignored (→ approval queue) if there are review flags. */
  autoSend: boolean;
}

/** Create an outbound message. With an idempotency key, a second call returns null instead of a duplicate. */
export async function createOutbound(tx: TenantTx, m: NewOutbound): Promise<Message | null> {
  const flags = m.reviewFlags ?? [];
  const status = m.autoSend && flags.length === 0 ? "queued" : "pending_approval";
  const [row] = await tx
    .insert(schema.messages)
    .values({
      orgId: m.orgId,
      enquiryId: m.enquiryId ?? null,
      contactId: m.contactId,
      appointmentId: m.appointmentId ?? null,
      direction: "outbound",
      status,
      kind: m.kind,
      toEmail: m.toEmail,
      subject: m.subject,
      body: m.body,
      templateKey: m.templateKey ?? null,
      aiGenerated: m.aiGenerated ?? false,
      reviewFlags: flags,
      idempotencyKey: m.idempotencyKey ?? null,
      workflowRunId: m.workflowRunId ?? null,
      createdBy: m.createdBy ?? null,
    })
    .onConflictDoNothing({ target: [schema.messages.orgId, schema.messages.idempotencyKey] })
    .returning();
  if (!row) return null;
  if (status === "queued") await enqueueSend(tx, row);
  await tx.insert(schema.activities).values({
    orgId: m.orgId,
    enquiryId: m.enquiryId ?? null,
    contactId: m.contactId,
    actorUserId: m.createdBy ?? null,
    type: status === "queued" ? "email.queued" : "email.awaiting_approval",
    summary: status === "queued" ? `Email queued: ${m.subject}` : `Email waiting for approval: ${m.subject}`,
    data: { messageId: row.id, flags },
  });
  return row;
}

async function enqueueSend(tx: TenantTx, msg: Message) {
  await enqueue(tx, { orgId: msg.orgId, type: "email.send", payload: { messageId: msg.id }, dedupeKey: `send:${msg.id}` });
}

const PLACEHOLDER_RE = /\[(customer_name|customer_first_name|business_name|enquiry_subject|appointment_date|appointment_time|appointment_location|booking_link|assigned_user_name|business_phone|email_signature)\]/;

export const composeSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200).refine((s) => !/[\r\n]/.test(s), "Subject must be one line"),
  body: z.string().trim().min(1, "Message is required").max(20000),
  kind: z.enum(["transactional", "marketing"]).default("transactional"),
  templateKey: z.string().max(60).optional(),
  aiGenerated: z.boolean().default(false),
  action: z.enum(["draft", "send"]),
});

/** A person writes (or edits an AI draft of) a reply to an enquiry. */
export async function composeMessage(actor: Actor, enquiryId: string, input: z.input<typeof composeSchema>) {
  assertCan(actor, "message.send");
  const data = composeSchema.parse(input);
  if (data.action === "send" && PLACEHOLDER_RE.test(data.subject + data.body)) {
    throw new AppError("Fill in the [placeholders] before sending.");
  }
  return withTenant(actor, async (tx) => {
    const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
    if (!enquiry) throw new AppError("Enquiry not found", "not_found");
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) });
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    if (data.action === "send") {
      const block = await sendBlockReason(tx, {
        toEmail: contact?.email ?? null,
        kind: data.kind,
        contact: contact ?? null,
        marketingBasis: org!.settings.marketingBasis,
      });
      if (block) throw new AppError(block);
    }
    const msg = await createOutbound(tx, {
      orgId: actor.orgId,
      enquiryId,
      contactId: enquiry.contactId,
      toEmail: contact?.email ?? null,
      subject: data.subject,
      body: data.body,
      kind: data.kind,
      templateKey: data.templateKey,
      aiGenerated: data.aiGenerated,
      createdBy: actor.userId,
      autoSend: data.action === "send",
    });
    if (msg && data.action === "draft") {
      await tx.update(schema.messages).set({ status: "draft" }).where(eq(schema.messages.id, msg.id));
    } else if (msg && data.action === "send") {
      await tx.update(schema.messages).set({ approvedBy: actor.userId, approvedAt: new Date() }).where(eq(schema.messages.id, msg.id));
    }
    return msg!;
  });
}

/** Approve a pending message (optionally with edits) and queue it. */
export async function approveMessage(actor: Actor, messageId: string, edits?: { subject?: string; body?: string }) {
  assertCan(actor, "message.send");
  await withTenant(actor, async (tx) => {
    const msg = await tx.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (!msg || !["pending_approval", "draft"].includes(msg.status)) throw new AppError("That message is no longer waiting for approval.", "conflict");
    const subject = edits?.subject?.trim() || msg.subject;
    const body = edits?.body?.trim() || msg.body;
    if (/[\r\n]/.test(subject)) throw new AppError("Subject must be one line");
    if (PLACEHOLDER_RE.test(subject + body)) throw new AppError("Fill in the [placeholders] before sending.");
    const contact = msg.contactId ? await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, msg.contactId) }) : null;
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    const block = await sendBlockReason(tx, { toEmail: msg.toEmail, kind: msg.kind as "transactional" | "marketing", contact: contact ?? null, marketingBasis: org!.settings.marketingBasis });
    if (block) throw new AppError(block);
    const [updated] = await tx
      .update(schema.messages)
      .set({ subject, body, status: "queued", approvedBy: actor.userId, approvedAt: new Date() })
      .where(and(eq(schema.messages.id, messageId), inArray(schema.messages.status, ["pending_approval", "draft"])))
      .returning();
    if (!updated) throw new AppError("That message is no longer waiting for approval.", "conflict");
    await enqueueSend(tx, updated);
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId: msg.enquiryId,
      contactId: msg.contactId,
      actorUserId: actor.userId,
      type: "email.approved",
      summary: `Approved and queued: ${subject}`,
      data: { messageId, edited: subject !== msg.subject || body !== msg.body },
    });
  });
}

export async function discardMessage(actor: Actor, messageId: string) {
  assertCan(actor, "message.send");
  await withTenant(actor, async (tx) => {
    const [row] = await tx
      .update(schema.messages)
      .set({ status: "cancelled", error: "Discarded by user" })
      .where(and(eq(schema.messages.id, messageId), inArray(schema.messages.status, ["pending_approval", "draft", "queued"])))
      .returning();
    if (!row) throw new AppError("That message can no longer be discarded.", "conflict");
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId: row.enquiryId,
      contactId: row.contactId,
      actorUserId: actor.userId,
      type: "email.discarded",
      summary: `Discarded: ${row.subject}`,
    });
  });
}

export async function listApprovalQueue(actor: Actor) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, (tx) =>
    tx
      .select({
        id: schema.messages.id,
        subject: schema.messages.subject,
        body: schema.messages.body,
        toEmail: schema.messages.toEmail,
        kind: schema.messages.kind,
        status: schema.messages.status,
        reviewFlags: schema.messages.reviewFlags,
        aiGenerated: schema.messages.aiGenerated,
        templateKey: schema.messages.templateKey,
        createdAt: schema.messages.createdAt,
        enquiryId: schema.messages.enquiryId,
        contactName: schema.contacts.name,
      })
      .from(schema.messages)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.messages.contactId))
      .where(eq(schema.messages.status, "pending_approval"))
      .orderBy(desc(schema.messages.createdAt))
      .limit(100),
  );
}

// ------------------------------------------------------------ the send job

const CONTACT_STATUSES_FROM = ["new", "needs_response", "follow_up_due"];
const NOT_A_REAL_REPLY = new Set(["acknowledge", "appointment_confirmation", "appointment_reminder", "appointment_reschedule", "appointment_cancelled"]);

/**
 * Deliver one queued message. Safe to call any number of times for the same
 * message: only the call that moves it queued → sending actually sends.
 * Returns "retry" if the job should be retried later.
 */
export async function deliverMessage(orgId: string, messageId: string, opts: { finalAttempt: boolean }): Promise<"done" | "retry"> {
  const actor = systemActor(orgId);
  const prepared = await withTenant(actor, async (tx) => {
    const msg = await tx.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (!msg) return null;
    if (msg.status === "sending") {
      // A previous attempt died between claiming and confirming. It may have been sent: do not resend.
      await tx.update(schema.messages).set({ status: "uncertain", error: "Send was interrupted; check before resending." }).where(eq(schema.messages.id, msg.id));
      return null;
    }
    if (msg.status !== "queued") return null;
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }))!;
    const contact = msg.contactId ? await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, msg.contactId) }) : null;
    const block = await sendBlockReason(tx, { toEmail: msg.toEmail, kind: msg.kind as "transactional" | "marketing", contact: contact ?? null, marketingBasis: org.settings.marketingBasis });
    if (block) {
      await tx.update(schema.messages).set({ status: "cancelled", error: block }).where(eq(schema.messages.id, msg.id));
      await tx.insert(schema.activities).values({ orgId, enquiryId: msg.enquiryId, contactId: msg.contactId, type: "email.blocked", summary: `Not sent: ${block}` });
      return null;
    }
    try {
      await consumeUsage(tx, orgId, "emails_sent");
    } catch (e) {
      if (!(e instanceof PlanLimitError)) throw e;
      await tx.update(schema.messages).set({ status: "failed", error: e.message }).where(eq(schema.messages.id, msg.id));
      return null;
    }
    const [claimed] = await tx
      .update(schema.messages)
      .set({ status: "sending" })
      .where(and(eq(schema.messages.id, msg.id), eq(schema.messages.status, "queued")))
      .returning();
    if (!claimed) return null;
    let text = claimed.body;
    const headers: Record<string, string> = {};
    if (claimed.kind === "marketing") {
      const url = unsubscribeUrl(orgId, claimed.toEmail!, "marketing");
      text += `\n\n—\nYou're receiving this because you agreed to hear from ${org.name}. Unsubscribe: ${url}`;
      headers["List-Unsubscribe"] = `<${url}>`;
    } else if (claimed.workflowRunId && !NOT_A_REAL_REPLY.has(claimed.templateKey ?? "")) {
      const url = unsubscribeUrl(orgId, claimed.toEmail!, "all");
      text += `\n\n—\nPrefer we don't follow up? ${url}`;
      headers["List-Unsubscribe"] = `<${url}>`;
    }
    return { msg: claimed, org, text, headers };
  });
  if (!prepared) return "done";

  const provider = getEmailProvider();
  try {
    const { providerMessageId } = await provider.send({
      to: prepared.msg.toEmail!,
      fromName: prepared.org.name,
      replyTo: prepared.org.email,
      subject: prepared.msg.subject,
      text: prepared.text,
      idempotencyKey: prepared.msg.id,
      headers: prepared.headers,
    });
    await withTenant(actor, async (tx) => {
      const now = new Date();
      await tx
        .update(schema.messages)
        .set({ status: "sent", sentAt: now, provider: provider.name, providerMessageId, error: null })
        .where(eq(schema.messages.id, prepared.msg.id));
      await tx.insert(schema.activities).values({
        orgId,
        enquiryId: prepared.msg.enquiryId,
        contactId: prepared.msg.contactId,
        type: "email.sent",
        summary: `${provider.isReal ? "Sent" : "Sent (simulated)"}: ${prepared.msg.subject}`,
        data: { messageId: prepared.msg.id },
      });
      if (prepared.msg.enquiryId) await recordOutbound(tx, prepared.msg, now);
    });
    return "done";
  } catch (e) {
    const err = e instanceof EmailProviderError ? e : new EmailProviderError(e instanceof Error ? e.message : "Send failed", false, true);
    // ambiguous → uncertain (never auto-retried); retryable → back in the queue, or failed on the last attempt.
    const nextStatus = err.ambiguous ? "uncertain" : err.retryable && !opts.finalAttempt ? "queued" : "failed";
    await withTenant(actor, async (tx) => {
      await tx.update(schema.messages).set({ status: nextStatus, error: err.message }).where(eq(schema.messages.id, prepared.msg.id));
      if (nextStatus !== "queued") {
        await tx.insert(schema.activities).values({
          orgId,
          enquiryId: prepared.msg.enquiryId,
          contactId: prepared.msg.contactId,
          type: "email.failed",
          summary: nextStatus === "uncertain" ? `Delivery uncertain — check before resending: ${prepared.msg.subject}` : `Failed to send: ${prepared.msg.subject}`,
          data: { messageId: prepared.msg.id },
        });
      }
    });
    // Rethrow retryable errors so the job is retried — or, on its last attempt, lands in the failed list.
    if (err.retryable && !err.ambiguous) throw err;
    return "done";
  }
}

async function recordOutbound(tx: TenantTx, msg: Message, at: Date) {
  const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, msg.enquiryId!) });
  if (!enquiry) return;
  const patch: Partial<typeof schema.enquiries.$inferInsert> = { lastOutboundAt: at, updatedAt: at };
  if (!NOT_A_REAL_REPLY.has(msg.templateKey ?? "") && CONTACT_STATUSES_FROM.includes(enquiry.statusKey)) {
    const contacted = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, "contacted") });
    if (contacted) patch.statusKey = "contacted";
  }
  await tx.update(schema.enquiries).set(patch).where(eq(schema.enquiries.id, enquiry.id));
}

// ------------------------------------------------------------ inbound

const STOP_RE = /^\s*(stop|unsubscribe|remove me|opt out)\b/i;

/**
 * Record a customer's reply (logged by a user, or delivered by the inbound
 * webhook). This is what stops follow-up sequences. A reply of "STOP" opts
 * the address out of everything.
 */
export async function recordInbound(
  tx: TenantTx,
  orgId: string,
  input: { enquiryId: string; subject: string; body: string; fromEmail: string | null; receivedAt?: Date; actorUserId?: string | null },
) {
  const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, input.enquiryId) });
  if (!enquiry) throw new AppError("Enquiry not found", "not_found");
  const at = input.receivedAt ?? new Date();
  await tx.insert(schema.messages).values({
    orgId,
    enquiryId: enquiry.id,
    contactId: enquiry.contactId,
    direction: "inbound",
    status: "received",
    subject: input.subject.slice(0, 300),
    body: input.body.slice(0, 50_000),
    fromEmail: input.fromEmail,
    createdAt: at,
  });
  const needsResponse = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, "needs_response") });
  const statusDef = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, enquiry.statusKey) });
  await tx
    .update(schema.enquiries)
    .set({
      lastInboundAt: at,
      updatedAt: new Date(),
      ...(needsResponse && !statusDef?.isClosed && enquiry.statusKey !== "appointment_booked" ? { statusKey: "needs_response" } : {}),
    })
    .where(eq(schema.enquiries.id, enquiry.id));
  await tx.insert(schema.activities).values({
    orgId,
    enquiryId: enquiry.id,
    contactId: enquiry.contactId,
    actorUserId: input.actorUserId ?? null,
    type: "email.received",
    summary: `Customer replied: ${input.subject.slice(0, 120)}`,
  });
  if (STOP_RE.test(input.body) && input.fromEmail) {
    await addSuppression(tx, orgId, input.fromEmail, "all", "stop_follow_ups");
    await tx.insert(schema.activities).values({ orgId, enquiryId: enquiry.id, contactId: enquiry.contactId, type: "consent.opt_out", summary: "Customer asked to stop — all automated emails to this address are blocked" });
  }
  // Cancel anything automated that hasn't gone yet; the sequence will also stop at its next step.
  await tx
    .update(schema.messages)
    .set({ status: "cancelled", error: "Customer replied before this was sent" })
    .where(
      and(
        eq(schema.messages.enquiryId, enquiry.id),
        inArray(schema.messages.status, ["pending_approval", "queued"]),
        eq(schema.messages.direction, "outbound"),
        isNull(schema.messages.createdBy),
        isNull(schema.messages.appointmentId),
      ),
    );
}

export async function logCustomerReply(actor: Actor, enquiryId: string, input: { subject?: string; body: string }) {
  assertCan(actor, "enquiry.write");
  const body = z.string().trim().min(1, "Paste the customer's reply").max(50_000).parse(input.body);
  await withTenant(actor, async (tx) => {
    const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
    if (!enquiry) throw new AppError("Enquiry not found", "not_found");
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) });
    await recordInbound(tx, actor.orgId, { enquiryId, subject: input.subject?.trim() || `Re: ${enquiry.subject}`, body, fromEmail: contact?.email ?? null, actorUserId: actor.userId });
  });
}
