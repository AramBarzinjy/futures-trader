/**
 * Post-generation checks on AI-written email text. Each flag is shown to the
 * user beside the draft; flagged drafts can still be edited and sent by a
 * person, but are never sent automatically.
 */

export type DraftFlag = "mentions_money" | "unexpected_contact_details" | "unexpected_link" | "commitment_language" | "placeholder_left";

export const FLAG_LABELS: Record<DraftFlag, string> = {
  mentions_money: "Mentions a price or amount — check it's one you've confirmed",
  unexpected_contact_details: "Contains an email address or phone number that isn't yours",
  unexpected_link: "Contains a link that isn't your booking link or website",
  commitment_language: "Makes a promise (guarantee, deadline, availability) — check you can keep it",
  placeholder_left: "Has [placeholders] to fill in before sending",
};

const MONEY = /(£|\$|€)\s?\d|\b\d+(\.\d{2})?\s?(pounds|gbp|quid)\b|\bfree of charge\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?44\s?|0)(?:\d[\s-]?){9,10}/g;
const URL = /\bhttps?:\/\/[^\s)]+/gi;
const COMMIT = /\b(guarantee[ds]?|definitely|we will be (there|with you)|same[- ]day|within \d+ (hours?|days?)|by (tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|available (on|at|tomorrow)|no extra cost|fixed price)\b/i;
const PLACEHOLDER = /\[[^\]]{2,60}\]/;

export interface AllowedFacts {
  /** Text the business or customer supplied; amounts that appear here aren't "invented". */
  sourceText: string;
  allowedEmails: (string | null | undefined)[];
  allowedPhones: (string | null | undefined)[];
  allowedUrls: (string | null | undefined)[];
}

const digits = (s: string) => s.replace(/\D/g, "").replace(/^44/, "0");

export function checkDraft(text: string, allowed: AllowedFacts): DraftFlag[] {
  const flags = new Set<DraftFlag>();
  const source = allowed.sourceText.toLowerCase();

  const money = text.match(new RegExp(MONEY, "gi")) ?? [];
  if (money.some((m) => !source.includes(m.toLowerCase()))) flags.add("mentions_money");

  const okEmails = new Set(allowed.allowedEmails.filter(Boolean).map((e) => e!.toLowerCase()));
  if ((text.match(EMAIL) ?? []).some((e) => !okEmails.has(e.toLowerCase()))) flags.add("unexpected_contact_details");

  const okPhones = new Set(allowed.allowedPhones.filter(Boolean).map((p) => digits(p!)));
  if ((text.match(PHONE) ?? []).some((p) => !okPhones.has(digits(p)))) flags.add("unexpected_contact_details");

  const okUrls = allowed.allowedUrls.filter(Boolean).map((u) => u!.replace(/\/$/, "").toLowerCase());
  if ((text.match(URL) ?? []).some((u) => !okUrls.some((ok) => u.replace(/[.,;:!?]+$/, "").replace(/\/$/, "").toLowerCase().startsWith(ok)))) {
    flags.add("unexpected_link");
  }

  if (COMMIT.test(text) && !COMMIT.test(source)) flags.add("commitment_language");
  if (PLACEHOLDER.test(text)) flags.add("placeholder_left");
  return [...flags];
}
