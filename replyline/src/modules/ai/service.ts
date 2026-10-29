import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { assertFeature, consumeUsage } from "@/modules/billing/entitlements";
import { INDUSTRIES, type IndustryKey } from "@/config/industries";
import { getAiProvider, AiProviderError } from "./provider";
import type { AiTask, AiTaskInput } from "./prompts";
import { draftSchema, nextActionSchema, questionsSchema, summarySchema } from "./schemas";
import { checkDraft, type DraftFlag } from "./validate";

/*
 * Every AI request: permission check → plan feature → data-sharing consent
 * (for external providers) → usage metering → provider call → schema
 * validation → content checks. Results are suggestions for a person to edit;
 * nothing here sends email.
 */

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

async function loadContext(actor: Actor, enquiryId: string, task: AiTask) {
  return withTenant(actor, async (tx) => {
    await assertFeature(tx, actor.orgId, "aiDrafts", "AI drafting");
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) }))!;
    const provider = getAiProvider();
    if (provider.external && !org.settings.aiDataSharingAcknowledged) {
      throw new AppError("An owner or admin must allow AI drafting in Settings → Privacy before enquiry text is sent to the AI provider.", "forbidden");
    }
    const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
    if (!enquiry) throw new AppError("Enquiry not found", "not_found");
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) });
    if (contact?.erasedAt) throw new AppError("This contact's data has been erased.");
    const msgs = await tx.query.messages.findMany({
      where: eq(schema.messages.enquiryId, enquiryId),
      orderBy: [desc(schema.messages.createdAt)],
      limit: 10,
    });
    await consumeUsage(tx, actor.orgId, "ai_requests");
    const hoursText = DAYS.map((d) => {
      const h = org.businessHours[d];
      return `${d} ${h ? `${h.open}-${h.close}` : "closed"}`;
    }).join(", ");
    const input: AiTaskInput = {
      task,
      business: {
        name: org.name,
        industry: INDUSTRIES[org.industry as IndustryKey]?.label ?? org.industry,
        tone: org.tone,
        phone: org.phone,
        bookingLink: org.bookingLink,
        website: org.website,
        signature: org.emailSignature,
        hoursText,
      },
      enquiry: {
        subject: enquiry.subject,
        message: enquiry.message,
        source: enquiry.source,
        status: enquiry.statusKey,
        createdAt: enquiry.createdAt.toISOString().slice(0, 10),
        customerFirstName: contact?.name.split(/\s+/)[0] ?? "",
      },
      conversation: msgs
        .filter((m) => m.status === "sent" || m.status === "received")
        .map((m) => ({ direction: m.direction as "inbound" | "outbound", at: m.createdAt.toISOString().slice(0, 16), subject: m.subject, body: m.body })),
    };
    const allowed = {
      sourceText: [enquiry.subject, enquiry.message, ...msgs.map((m) => m.body), org.emailSignature ?? ""].join("\n"),
      allowedEmails: [org.email, contact?.email],
      allowedPhones: [org.phone, contact?.phone],
      allowedUrls: [org.bookingLink, org.website],
    };
    await tx.insert(schema.activities).values({
      orgId: actor.orgId,
      enquiryId,
      actorUserId: actor.userId,
      type: "ai.used",
      summary: `AI ${task.kind.replace("_", " ")} requested (${provider.name})`,
    });
    return { input, allowed, provider };
  });
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiProviderError) throw new AppError(e.message);
    throw e;
  }
}

export interface DraftResult {
  subject: string;
  body: string;
  needsConfirmation: string[];
  flags: DraftFlag[];
  provider: string;
}

export async function aiDraft(
  actor: Actor,
  enquiryId: string,
  task: Extract<AiTask, { kind: "draft" | "rewrite" | "length" }>,
): Promise<DraftResult> {
  assertCan(actor, "message.send");
  return run(async () => {
    const { input, allowed, provider } = await loadContext(actor, enquiryId, task);
    const out = await provider.generate(input, draftSchema);
    const subject = out.subject.replace(/[\r\n]+/g, " ").trim();
    // Text the user wrote into the draft counts as supplied by the business.
    const extraSource = task.kind === "draft" ? "" : task.draft.body;
    const flags = checkDraft(`${subject}\n${out.body}`, { ...allowed, sourceText: allowed.sourceText + "\n" + extraSource });
    return { subject, body: out.body, needsConfirmation: out.needsConfirmation, flags, provider: provider.name };
  });
}

export async function aiQuestions(actor: Actor, enquiryId: string) {
  assertCan(actor, "enquiry.read");
  return run(async () => {
    const { input, provider } = await loadContext(actor, enquiryId, { kind: "questions" });
    return provider.generate(input, questionsSchema);
  });
}

export async function aiSummary(actor: Actor, enquiryId: string) {
  assertCan(actor, "enquiry.read");
  return run(async () => {
    const { input, provider } = await loadContext(actor, enquiryId, { kind: "summarise" });
    return provider.generate(input, summarySchema);
  });
}

export async function aiNextAction(actor: Actor, enquiryId: string) {
  assertCan(actor, "enquiry.read");
  return run(async () => {
    const { input, provider } = await loadContext(actor, enquiryId, { kind: "next_action" });
    return provider.generate(input, nextActionSchema);
  });
}
