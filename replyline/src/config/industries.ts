import type { WorkflowStep, WorkflowStopRules, WorkflowConditions } from "@/lib/db/schema";

/**
 * Industry presets. One platform, configured per segment: these supply the
 * starting statuses, categories, templates and workflows for a new workspace.
 * Everything here is copied into the workspace and is then fully editable.
 */

export type IndustryKey = "trades" | "property" | "consulting" | "recruitment" | "agency";

export interface TemplateSeed {
  key: string;
  name: string;
  purpose: string;
  kind: "transactional" | "marketing";
  subject: string;
  body: string;
}

export interface StatusSeed {
  key: string;
  label: string;
  isClosed?: boolean;
  outcome?: "won" | "lost";
  stopsFollowUps?: boolean;
  color: string;
}

export interface WorkflowSeed {
  templateKey: string;
  name: string;
  purpose: string;
  trigger: "enquiry_created" | "appointment_scheduled" | "weekly_schedule";
  steps: WorkflowStep[];
  stopRules: WorkflowStopRules;
  conditions?: WorkflowConditions;
  businessHoursOnly: boolean;
  /** Plan feature required to enable it, if any. */
  requiresFeature?: "followUpSequences";
  enabledByDefault: boolean;
}

export interface IndustryPreset {
  key: IndustryKey;
  label: string;
  examples: string;
  /** Plain-English name for an enquiry in this industry. */
  enquiryNoun: string;
  categories: string[];
  sources: string[];
  appointmentNoun: string;
  defaultAppointmentMinutes: number;
  /** Template overrides on top of BASE_TEMPLATES, by key. */
  templateOverrides: Partial<Record<string, Partial<TemplateSeed>>>;
  marketing: { headline: string; pains: string[]; outcomes: string[] };
}

export const DEFAULT_STATUSES: StatusSeed[] = [
  { key: "new", label: "New", color: "blue" },
  { key: "needs_response", label: "Needs response", color: "amber" },
  { key: "contacted", label: "Contacted", color: "violet" },
  { key: "follow_up_due", label: "Follow-up due", color: "orange" },
  { key: "appointment_booked", label: "Appointment booked", color: "teal", stopsFollowUps: true },
  { key: "won", label: "Won", isClosed: true, outcome: "won", stopsFollowUps: true, color: "green" },
  { key: "lost", label: "Lost", isClosed: true, outcome: "lost", stopsFollowUps: true, color: "slate" },
];

/** Variables every template may use. Rendering rejects anything not listed. */
export const TEMPLATE_VARIABLES = [
  "customer_name",
  "customer_first_name",
  "business_name",
  "enquiry_subject",
  "appointment_date",
  "appointment_time",
  "appointment_location",
  "booking_link",
  "assigned_user_name",
  "business_phone",
  "email_signature",
] as const;

export const BASE_TEMPLATES: TemplateSeed[] = [
  {
    key: "acknowledge",
    name: "Acknowledge new enquiry",
    purpose: "Sent soon after an enquiry arrives so the customer knows it was received.",
    kind: "transactional",
    subject: "Thanks for your enquiry — {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nThanks for getting in touch with {{business_name}}. We've received your enquiry about \"{{enquiry_subject}}\" and will come back to you shortly.\n\nIf it's urgent, you can call us on {{business_phone}}.\n\n{{email_signature}}",
  },
  {
    key: "request_info",
    name: "Request missing information",
    purpose: "Ask for details needed before you can quote or book.",
    kind: "transactional",
    subject: "A couple of quick questions about {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nThanks for your enquiry. So we can help properly, could you tell us a little more?\n\n- \n- \n\n{{email_signature}}",
  },
  {
    key: "quote_next_step",
    name: "Quote or consultation next step",
    purpose: "Explain what happens next. Do not include prices you have not confirmed.",
    kind: "transactional",
    subject: "Next steps for {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nThe best next step is a short consultation so we can understand exactly what you need. You can choose a time that suits you here: {{booking_link}}\n\n{{email_signature}}",
  },
  {
    key: "confirm_receipt",
    name: "Confirm receipt of request",
    purpose: "Confirm you have received documents, photos or other information.",
    kind: "transactional",
    subject: "Received — {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nJust to confirm we've received what you sent over. We'll review it and be in touch.\n\n{{email_signature}}",
  },
  {
    key: "follow_up_no_response",
    name: "Follow up after no response",
    purpose: "A polite nudge when the customer hasn't replied.",
    kind: "transactional",
    subject: "Following up — {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nI wanted to follow up on your enquiry about \"{{enquiry_subject}}\". Are you still looking for help with this? Just reply to this email and we'll pick it up.\n\n{{email_signature}}",
  },
  {
    key: "follow_up_final",
    name: "Final follow-up",
    purpose: "The last message in a sequence. Leaves the door open without pressure.",
    kind: "transactional",
    subject: "Shall we close this off? — {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nWe haven't heard back, so we'll assume you're sorted for now and won't chase further. If you'd still like help with \"{{enquiry_subject}}\", just reply and we'll pick it straight back up.\n\n{{email_signature}}",
  },
  {
    key: "appointment_confirmation",
    name: "Confirm appointment",
    purpose: "Sent when an appointment is booked.",
    kind: "transactional",
    subject: "Confirmed: {{appointment_date}} at {{appointment_time}}",
    body: "Hi {{customer_first_name}},\n\nThis is to confirm your appointment with {{business_name}} on {{appointment_date}} at {{appointment_time}}.\n\nWhere: {{appointment_location}}\n\nIf you need to change it, reply to this email or call {{business_phone}}.\n\n{{email_signature}}",
  },
  {
    key: "appointment_reminder",
    name: "Appointment reminder",
    purpose: "Sent before the appointment, at the offsets set on the appointment.",
    kind: "transactional",
    subject: "Reminder: {{appointment_date}} at {{appointment_time}}",
    body: "Hi {{customer_first_name}},\n\nA quick reminder of your appointment with {{business_name}} on {{appointment_date}} at {{appointment_time}}.\n\nWhere: {{appointment_location}}\n\nNeed to rearrange? Reply to this email or call {{business_phone}}.\n\n{{email_signature}}",
  },
  {
    key: "appointment_reschedule",
    name: "Appointment rescheduled",
    purpose: "Sent when an appointment's date or time changes.",
    kind: "transactional",
    subject: "Updated: your appointment is now {{appointment_date}} at {{appointment_time}}",
    body: "Hi {{customer_first_name}},\n\nYour appointment with {{business_name}} has moved to {{appointment_date}} at {{appointment_time}}.\n\nWhere: {{appointment_location}}\n\n{{email_signature}}",
  },
  {
    key: "appointment_cancelled",
    name: "Appointment cancelled",
    purpose: "Sent when an appointment is cancelled.",
    kind: "transactional",
    subject: "Cancelled: your appointment on {{appointment_date}}",
    body: "Hi {{customer_first_name}},\n\nYour appointment with {{business_name}} on {{appointment_date}} at {{appointment_time}} has been cancelled. If you'd like to book another time: {{booking_link}}\n\n{{email_signature}}",
  },
  {
    key: "post_appointment",
    name: "Post-appointment follow-up",
    purpose: "Thank the customer and confirm next steps after a visit or meeting.",
    kind: "transactional",
    subject: "Thanks for your time — {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nThanks for your time today. As discussed, the next step is:\n\n- \n\nAny questions, just reply.\n\n{{email_signature}}",
  },
  {
    key: "close_polite",
    name: "Close enquiry politely",
    purpose: "Close the loop when the enquiry won't go ahead.",
    kind: "transactional",
    subject: "Closing your enquiry — {{enquiry_subject}}",
    body: "Hi {{customer_first_name}},\n\nThanks again for considering {{business_name}}. We've closed this enquiry for now, but if anything changes you're very welcome to get back in touch.\n\n{{email_signature}}",
  },
  {
    key: "re_engage",
    name: "Re-engage an existing prospect",
    purpose: "MARKETING. Only sent to contacts with recorded consent. Always includes an unsubscribe link.",
    kind: "marketing",
    subject: "Still thinking about {{enquiry_subject}}?",
    body: "Hi {{customer_first_name}},\n\nYou were in touch a while ago about \"{{enquiry_subject}}\". If it's still on your list, we'd be happy to help — you can book a time here: {{booking_link}}\n\n{{email_signature}}",
  },
];

export const WORKFLOW_SEEDS: WorkflowSeed[] = [
  {
    templateKey: "new_enquiry_ack",
    name: "New enquiry acknowledgement",
    purpose: "Let every customer know their enquiry arrived, within minutes.",
    trigger: "enquiry_created",
    steps: [{ delay: { amount: 0, unit: "minutes" }, action: "email", templateKey: "acknowledge" }],
    stopRules: { onCustomerReply: true, onBusinessReply: true, onAppointmentBooked: true, onStatusKeys: ["won", "lost"] },
    businessHoursOnly: false,
    enabledByDefault: true,
  },
  {
    templateKey: "follow_up_sequence",
    name: "Follow up after two business days",
    purpose: "Nudge customers who go quiet, then close politely. Stops the moment they reply or book.",
    trigger: "enquiry_created",
    steps: [
      { delay: { amount: 2, unit: "business_days" }, action: "email", templateKey: "follow_up_no_response" },
      { delay: { amount: 5, unit: "business_days" }, action: "email", templateKey: "follow_up_final" },
    ],
    stopRules: { onCustomerReply: true, onBusinessReply: false, onAppointmentBooked: true, onStatusKeys: ["appointment_booked", "won", "lost"] },
    businessHoursOnly: true,
    requiresFeature: "followUpSequences",
    enabledByDefault: true,
  },
  {
    templateKey: "no_response_escalation",
    name: "No-response escalation",
    purpose: "If nobody in the team has replied within one business day, flag the enquiry as urgent.",
    trigger: "enquiry_created",
    steps: [{ delay: { amount: 1, unit: "business_days" }, action: "escalate" }],
    stopRules: { onCustomerReply: false, onBusinessReply: true, onAppointmentBooked: true, onStatusKeys: ["won", "lost"] },
    businessHoursOnly: true,
    enabledByDefault: true,
  },
  {
    templateKey: "appointment_reminder",
    name: "Appointment confirmation and reminders",
    purpose: "Confirm each booking, then remind the customer at the times set on the appointment.",
    trigger: "appointment_scheduled",
    steps: [],
    stopRules: { onCustomerReply: false, onBusinessReply: false, onAppointmentBooked: false, onStatusKeys: [] },
    businessHoursOnly: false,
    enabledByDefault: true,
  },
  {
    templateKey: "weekly_summary",
    name: "Weekly prospect summary",
    purpose: "A report of the week's enquiries, follow-ups and appointments.",
    trigger: "weekly_schedule",
    steps: [],
    stopRules: { onCustomerReply: false, onBusinessReply: false, onAppointmentBooked: false, onStatusKeys: [] },
    businessHoursOnly: false,
    enabledByDefault: true,
  },
];

export const INDUSTRIES: Record<IndustryKey, IndustryPreset> = {
  trades: {
    key: "trades",
    label: "Trades & home services",
    examples: "Plumbers, electricians, roofers, cleaners, landscapers, builders",
    enquiryNoun: "job enquiry",
    categories: ["Repair", "Installation", "Emergency call-out", "Quote request", "Maintenance"],
    sources: ["Website form", "Phone", "Email", "Checkatrade", "Facebook", "Referral"],
    appointmentNoun: "site visit",
    defaultAppointmentMinutes: 60,
    templateOverrides: {
      quote_next_step: {
        name: "Arrange a site visit to quote",
        subject: "Arranging a visit for {{enquiry_subject}}",
        body: "Hi {{customer_first_name}},\n\nThanks for the details. To give you an accurate quote we'd like to take a quick look in person. You can pick a time that suits you here: {{booking_link}} — or reply with a couple of times that work.\n\n{{email_signature}}",
      },
      request_info: {
        body: "Hi {{customer_first_name}},\n\nThanks for your enquiry. So we can give you an accurate idea of the work, could you send:\n\n- A couple of photos of the area\n- Your postcode\n- When you'd ideally like the work done\n\n{{email_signature}}",
      },
    },
    marketing: {
      headline: "Win more jobs without living in your inbox.",
      pains: ["Enquiries land while you're on a job and get forgotten", "Customers go with whoever replied first", "No-shows waste half a day"],
      outcomes: ["Every enquiry acknowledged within minutes", "Polite follow-ups that stop the moment they reply", "Reminders the day before every site visit"],
    },
  },
  property: {
    key: "property",
    label: "Estate agents & property services",
    examples: "Sales and lettings agents, surveyors, property managers",
    enquiryNoun: "property enquiry",
    categories: ["Viewing request", "Valuation", "Lettings", "Sales", "Maintenance"],
    sources: ["Website form", "Rightmove", "Zoopla", "Phone", "Email", "Walk-in"],
    appointmentNoun: "viewing",
    defaultAppointmentMinutes: 30,
    templateOverrides: {
      quote_next_step: { name: "Book a viewing or valuation", subject: "Booking your viewing — {{enquiry_subject}}" },
    },
    marketing: {
      headline: "Every viewing request answered, every valuation followed up.",
      pains: ["Portal leads pile up overnight", "Applicants go quiet after one viewing", "Diary clashes and missed viewings"],
      outcomes: ["Instant acknowledgement of portal leads", "Automatic chasers after viewings", "Viewing reminders that cut no-shows"],
    },
  },
  consulting: {
    key: "consulting",
    label: "Consultants & coaches",
    examples: "Business consultants, coaches, accountants, professional services",
    enquiryNoun: "consultation request",
    categories: ["Discovery call", "Proposal", "Retainer", "One-off project"],
    sources: ["Website form", "LinkedIn", "Email", "Referral", "Event"],
    appointmentNoun: "discovery call",
    defaultAppointmentMinutes: 30,
    templateOverrides: {},
    marketing: {
      headline: "Turn more discovery calls into clients.",
      pains: ["Leads cool off while you deliver for clients", "Proposals sent and never chased", "Too much admin between calls"],
      outcomes: ["Fast, personal-sounding replies", "Proposal follow-ups on autopilot", "A weekly view of who to call"],
    },
  },
  recruitment: {
    key: "recruitment",
    label: "Recruitment & staffing",
    examples: "Recruitment agencies, staffing firms",
    enquiryNoun: "client or candidate enquiry",
    categories: ["New vacancy", "Candidate application", "Temp request", "Permanent placement"],
    sources: ["Website form", "Job board", "LinkedIn", "Email", "Phone"],
    appointmentNoun: "interview",
    defaultAppointmentMinutes: 45,
    templateOverrides: {},
    marketing: {
      headline: "Never leave a client or candidate waiting.",
      pains: ["Vacancy enquiries buried under applications", "Interview no-shows", "No time to chase cold clients"],
      outcomes: ["Every enquiry triaged and acknowledged", "Interview reminders for candidates", "Follow-ups that keep clients warm"],
    },
  },
  agency: {
    key: "agency",
    label: "Marketing agencies & B2B",
    examples: "Marketing, design and web agencies, small B2B firms",
    enquiryNoun: "new business enquiry",
    categories: ["New project", "Retainer", "Audit request", "Partnership"],
    sources: ["Website form", "LinkedIn", "Email", "Referral", "Clutch"],
    appointmentNoun: "intro call",
    defaultAppointmentMinutes: 30,
    templateOverrides: {},
    marketing: {
      headline: "A new-business pipeline that runs itself.",
      pains: ["Inbound leads answered days late", "Proposals that stall", "No clear weekly pipeline view"],
      outcomes: ["Leads acknowledged in minutes", "Structured follow-ups", "A weekly prospect report for the team"],
    },
  },
};

export const INDUSTRY_KEYS = Object.keys(INDUSTRIES) as IndustryKey[];

export function templatesFor(industry: IndustryKey): TemplateSeed[] {
  const overrides = INDUSTRIES[industry]?.templateOverrides ?? {};
  return BASE_TEMPLATES.map((t) => ({ ...t, ...(overrides[t.key] ?? {}) }));
}
