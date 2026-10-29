import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/*
 * Tenancy model
 * -------------
 * Every row that belongs to a business carries `org_id`. Row-level security
 * (drizzle/0001_rls.sql) restricts the application database role to rows whose
 * org_id matches the `app.org_id` setting for the current transaction.
 *
 * Tables WITHOUT org_id (users, sessions, rate_limits, billing_events) are
 * platform tables. They are only read by server code that filters explicitly.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const orgId = () => uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- platform

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(), // stored lower-cased
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the cookie token; the token itself is never stored. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activeOrgId: uuid("active_org_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Every payment-provider webhook we've processed, for idempotency. */
export const billingEvents = pgTable("billing_events", {
  providerEventId: text("provider_event_id").primaryKey(),
  type: text("type").notNull(),
  orgId: uuid("org_id"),
  receivedAt: createdAt(),
});

// ---------------------------------------------------------------- tenants

export type BusinessHours = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { open: string; close: string } | null>;

export interface OrgSettings {
  enquirySources: string[];
  emailProviderPreference: "none" | "gmail" | "microsoft" | "other";
  calendarProviderPreference: "none" | "google" | "microsoft";
  defaultAppointmentMinutes: number;
  followUpDelayBusinessDays: number;
  report: { weekday: number; hour: number; recipients: string[]; emailEnabled: boolean };
  /** Owner has acknowledged that enquiry text is sent to the configured AI provider. */
  aiDataSharingAcknowledged: boolean;
  /** Marketing (re-engagement) requires recorded consent unless this is changed after legal advice. */
  marketingBasis: "consent_required" | "soft_opt_in";
  retentionMonths: number;
  categories: string[];
}

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  industry: text("industry").notNull().default("trades"),
  timezone: text("timezone").notNull().default("Europe/London"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  bookingLink: text("booking_link"),
  emailSignature: text("email_signature"),
  tone: text("tone").notNull().default("friendly"),
  businessHours: jsonb("business_hours").$type<BusinessHours>().notNull(),
  settings: jsonb("settings").$type<OrgSettings>().notNull(),
  /** Public identifier for the website form. Not a secret, but unguessable. */
  formKey: text("form_key").notNull().unique(),
  planKey: text("plan_key").notNull().default("growth"),
  billingInterval: text("billing_interval").notNull().default("monthly"),
  subscriptionStatus: text("subscription_status").notNull().default("trialing"), // trialing|active|past_due|canceled
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  nextReportAt: timestamp("next_report_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // owner | admin | member
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable("invitations", {
  id: id(),
  orgId: orgId(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const pipelineStatuses = pgTable(
  "pipeline_statuses",
  {
    id: id(),
    orgId: orgId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    /** Closed statuses end the enquiry; outcome distinguishes won from lost. */
    isClosed: boolean("is_closed").notNull().default(false),
    outcome: text("outcome"), // won | lost | null
    /** Entering this status stops any running follow-up sequence. */
    stopsFollowUps: boolean("stops_follow_ups").notNull().default(false),
    color: text("color").notNull().default("slate"),
  },
  (t) => [uniqueIndex("pipeline_statuses_org_key").on(t.orgId, t.key)],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: id(),
    orgId: orgId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull().default("text"), // text | number | select
    options: jsonb("options").$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_fields_org_key").on(t.orgId, t.key)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    email: text("email"),
    emailNormalised: text("email_normalised"),
    phone: text("phone"),
    phoneNormalised: text("phone_normalised"),
    company: text("company"),
    /** PECR/UK GDPR: marketing consent is recorded separately from the enquiry itself. */
    marketingConsent: text("marketing_consent").notNull().default("unknown"), // unknown | granted | withdrawn
    consentSource: text("consent_source"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    notes: text("notes"),
    customFields: jsonb("custom_fields").$type<Record<string, string>>().notNull().default({}),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_org_email").on(t.orgId, t.emailNormalised),
    index("contacts_org_phone").on(t.orgId, t.phoneNormalised),
  ],
);

export const enquiries = pgTable(
  "enquiries",
  {
    id: id(),
    orgId: orgId(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    message: text("message").notNull().default(""),
    source: text("source").notNull().default("manual"),
    category: text("category"),
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    statusKey: text("status_key").notNull(),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    possibleDuplicateOfId: uuid("possible_duplicate_of_id"),
    customFields: jsonb("custom_fields").$type<Record<string, string>>().notNull().default({}),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("enquiries_org_status").on(t.orgId, t.statusKey),
    index("enquiries_org_created").on(t.orgId, t.createdAt),
    index("enquiries_org_followup").on(t.orgId, t.nextFollowUpAt),
    index("enquiries_contact").on(t.contactId),
  ],
);

export const notes = pgTable("notes", {
  id: id(),
  orgId: orgId(),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/** The timeline. Append-only from application code. */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    orgId: orgId(),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("activities_org_created").on(t.orgId, t.createdAt), index("activities_enquiry").on(t.enquiryId)],
);

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: id(),
    orgId: orgId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    purpose: text("purpose").notNull().default(""),
    /** transactional = about the customer's own enquiry/appointment; marketing = needs consent + unsubscribe. */
    kind: text("kind").notNull().default("transactional"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_templates_org_key").on(t.orgId, t.key)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    orgId: orgId(),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id"),
    direction: text("direction").notNull(), // inbound | outbound
    /**
     * draft → pending_approval → queued → sending → sent
     *                                      ↘ failed / uncertain
     * cancelled is terminal from any pre-send state.
     */
    status: text("status").notNull(),
    kind: text("kind").notNull().default("transactional"),
    toEmail: text("to_email"),
    fromEmail: text("from_email"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    templateKey: text("template_key"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /** Reasons this message needs a human look before sending. */
    reviewFlags: jsonb("review_flags").$type<string[]>().notNull().default([]),
    /** Unique per org: guarantees a retried job can never create a second copy. */
    idempotencyKey: text("idempotency_key"),
    workflowRunId: uuid("workflow_run_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_org_idem").on(t.orgId, t.idempotencyKey),
    index("messages_org_status").on(t.orgId, t.status),
    index("messages_enquiry").on(t.enquiryId),
  ],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    orgId: orgId(),
    /** sha256 of the normalised address, so the block survives erasure of the contact. */
    emailHash: text("email_hash").notNull(),
    scope: text("scope").notNull(), // marketing | all
    reason: text("reason").notNull(), // unsubscribe | stop_follow_ups | bounce | complaint | manual | erasure
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppressions_org_hash_scope").on(t.orgId, t.emailHash, t.scope)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    orgId: orgId(),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    location: text("location"),
    meetingLink: text("meeting_link"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("scheduled"), // scheduled | cancelled | completed | no_show
    /** Bumped on every reschedule/cancel. Reminder jobs carry the version they were made for. */
    version: integer("version").notNull().default(1),
    reminderOffsetsMinutes: jsonb("reminder_offsets_minutes").$type<number[]>().notNull().default([1440]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("appointments_org_starts").on(t.orgId, t.startsAt)],
);

export interface WorkflowStep {
  /** Delay before this step, measured from the previous step (or the trigger). */
  delay: { amount: number; unit: "minutes" | "hours" | "business_days" };
  /** email = prepare/send a templated email; escalate = flag the enquiry for the team, no customer contact. */
  action: "email" | "escalate";
  templateKey?: string;
}

export interface WorkflowConditions {
  sources?: string[];
  priorities?: string[];
  categories?: string[];
}

export interface WorkflowStopRules {
  onCustomerReply: boolean;
  /** Stop once anyone in the business has emailed the customer (used by escalations). */
  onBusinessReply: boolean;
  onAppointmentBooked: boolean;
  onStatusKeys: string[];
}

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    orgId: orgId(),
    templateKey: text("template_key").notNull(), // which predefined template it came from
    name: text("name").notNull(),
    purpose: text("purpose").notNull().default(""),
    trigger: text("trigger").notNull(), // enquiry_created | appointment_scheduled | weekly_schedule
    conditions: jsonb("conditions").$type<WorkflowConditions>().notNull().default({}),
    steps: jsonb("steps").$type<WorkflowStep[]>().notNull().default([]),
    /** true = every message waits in the approval queue. Turning this off is audited. */
    requireApproval: boolean("require_approval").notNull().default(true),
    /** Respect business hours when a step falls due. */
    businessHoursOnly: boolean("business_hours_only").notNull().default(true),
    stopRules: jsonb("stop_rules").$type<WorkflowStopRules>().notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workflows_org_template").on(t.orgId, t.templateKey)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: id(),
    orgId: orgId(),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    /** What the run is about: an enquiry or an appointment. Unique per workflow to prevent double-starts. */
    subjectId: uuid("subject_id").notNull(),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"), // running | completed | stopped | failed
    nextStep: integer("next_step").notNull().default(0),
    stopReason: text("stop_reason"),
    dryRun: boolean("dry_run").notNull().default(false),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("workflow_runs_unique_subject").on(t.workflowId, t.subjectId)],
);

/**
 * Durable job queue (Postgres, SELECT ... FOR UPDATE SKIP LOCKED).
 * org_id is nullable for platform jobs; RLS lets the app role see only its own org's jobs.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | dead
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    /** Enqueueing the same key twice is a no-op. */
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_due").on(t.status, t.runAt), index("jobs_org_status").on(t.orgId, t.status)],
);

export interface ReportMetrics {
  periodLabel: string;
  newEnquiries: number;
  bySource: Record<string, number>;
  needingResponse: number;
  overdueFollowUps: number;
  appointmentsScheduled: number;
  goneQuiet: { id: string; subject: string; contactName: string; daysQuiet: number }[];
  won: { id: string; subject: string; contactName: string }[];
  lost: { id: string; subject: string; contactName: string }[];
  upcomingAppointments: { id: string; title: string; startsAt: string; contactName: string }[];
  previous: { newEnquiries: number; appointmentsScheduled: number; won: number } | null;
}

export interface ReportSuggestion {
  text: string;
  /** "rule" = derived deterministically from the metrics; "ai" = model-written wording. */
  source: "rule" | "ai";
  enquiryId?: string;
}

export const reports = pgTable(
  "reports",
  {
    id: id(),
    orgId: orgId(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    metrics: jsonb("metrics").$type<ReportMetrics>().notNull(),
    suggestions: jsonb("suggestions").$type<ReportSuggestion[]>().notNull().default([]),
    emailedTo: jsonb("emailed_to").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reports_org_period").on(t.orgId, t.periodStart)],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    orgId: orgId(),
    period: text("period").notNull(), // YYYY-MM
    metric: text("metric").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.period, t.metric] })],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: orgId(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created").on(t.orgId, t.createdAt)],
);

/** Connected third-party accounts. Tokens are AES-256-GCM encrypted at rest. */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    orgId: orgId(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("disconnected"),
    accountLabel: text("account_label"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    encryptedTokens: text("encrypted_tokens"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_org_provider").on(t.orgId, t.provider)],
);

/** Tenant-scoped tables: RLS is enabled on each of these in drizzle/0001_rls.sql. */
export const TENANT_TABLES = [
  "memberships",
  "invitations",
  "pipeline_statuses",
  "custom_field_definitions",
  "contacts",
  "enquiries",
  "notes",
  "activities",
  "email_templates",
  "messages",
  "suppressions",
  "appointments",
  "workflows",
  "workflow_runs",
  "jobs",
  "reports",
  "usage_counters",
  "audit_logs",
  "integrations",
] as const;
