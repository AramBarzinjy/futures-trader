import { TEMPLATE_VARIABLES } from "@/config/industries";
import { formatInZone } from "@/lib/time";

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES);

export interface RenderResult {
  output: string;
  /** Known variables with no value for this customer — the message needs a human look. */
  missing: string[];
  /** Variables that don't exist at all — the template itself is wrong. */
  unknown: string[];
}

/**
 * Single-pass substitution. Values are inserted literally and never re-scanned,
 * so a customer whose name is "{{business_phone}}" cannot inject template syntax.
 * Missing values are left as a visible [placeholder] rather than silently blanked.
 */
export function renderTemplate(text: string, vars: TemplateVars): RenderResult {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const output = text.replace(VAR_RE, (_m, name: string) => {
    if (!KNOWN.has(name)) {
      unknown.add(name);
      return `[${name}]`;
    }
    const v = vars[name as TemplateVariable];
    if (v == null || String(v).trim() === "") {
      missing.add(name);
      return `[${name}]`;
    }
    return String(v);
  });
  return { output, missing: [...missing], unknown: [...unknown] };
}

/** Validate a template before saving: only known variables, balanced braces. */
export function validateTemplate(subject: string, body: string): string[] {
  const errors: string[] = [];
  for (const [label, text] of [["Subject", subject], ["Body", body]] as const) {
    for (const m of text.matchAll(VAR_RE)) {
      if (!KNOWN.has(m[1])) errors.push(`${label}: unknown variable {{${m[1]}}}. Available: ${TEMPLATE_VARIABLES.join(", ")}`);
    }
    const stripped = text.replace(VAR_RE, "");
    if (stripped.includes("{{") || stripped.includes("}}")) errors.push(`${label}: has unmatched {{ or }} braces.`);
  }
  if (subject.includes("\n")) errors.push("Subject must be a single line.");
  return errors;
}

export function renderEmail(subject: string, body: string, vars: TemplateVars) {
  const s = renderTemplate(subject, vars);
  const b = renderTemplate(body, vars);
  return {
    subject: s.output.replace(/[\r\n]+/g, " ").trim(),
    body: b.output,
    missing: [...new Set([...s.missing, ...b.missing])],
    unknown: [...new Set([...s.unknown, ...b.unknown])],
  };
}

interface VarSources {
  org: { name: string; phone: string | null; bookingLink: string | null; emailSignature: string | null; timezone: string };
  contact?: { name: string } | null;
  enquiry?: { subject: string } | null;
  appointment?: { startsAt: Date; timezone: string; location: string | null; meetingLink: string | null } | null;
  assignedUserName?: string | null;
}

export function buildVariables(src: VarSources): TemplateVars {
  const first = src.contact?.name?.trim().split(/\s+/)[0];
  const tz = src.appointment?.timezone ?? src.org.timezone;
  return {
    customer_name: src.contact?.name,
    customer_first_name: first,
    business_name: src.org.name,
    business_phone: src.org.phone,
    booking_link: src.org.bookingLink,
    email_signature: src.org.emailSignature || src.org.name,
    enquiry_subject: src.enquiry?.subject,
    assigned_user_name: src.assignedUserName,
    appointment_date: src.appointment ? formatInZone(src.appointment.startsAt, tz, "date") : undefined,
    appointment_time: src.appointment ? formatInZone(src.appointment.startsAt, tz, "time") : undefined,
    appointment_location: src.appointment ? src.appointment.location || src.appointment.meetingLink || "To be confirmed" : undefined,
  };
}

/** Sample values for the template preview screen. Clearly fictional. */
export const SAMPLE_VARS: TemplateVars = {
  customer_name: "Sam Taylor",
  customer_first_name: "Sam",
  business_name: "Your Business",
  business_phone: "01632 960000",
  booking_link: "https://example.com/book",
  email_signature: "Best wishes,\nThe team",
  enquiry_subject: "Leaking kitchen tap",
  assigned_user_name: "Alex",
  appointment_date: "Tuesday 4 November 2025",
  appointment_time: "10:30",
  appointment_location: "12 Example Road",
};
