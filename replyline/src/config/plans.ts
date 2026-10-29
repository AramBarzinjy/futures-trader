/**
 * Plans, prices and entitlements — the ONLY place they are defined.
 *
 * Prices are launch hypotheses, not validated market rates. Change them here;
 * nothing else in the codebase names a price or a limit. Enforcement lives in
 * src/modules/billing/entitlements.ts and always runs on the server.
 */

export type PlanKey = "starter" | "growth" | "pro";
export type BillingInterval = "monthly" | "annual";

/** Metered counters. Each resets at the start of a calendar month (UTC). */
export type UsageMetric = "ai_requests" | "automation_runs" | "emails_sent";

export type Feature =
  | "csvImport"
  | "aiDrafts"
  | "followUpSequences" // multi-step automated sequences
  | "customWorkflowRules" // editing conditions / stop rules beyond the template defaults
  | "automatedCapture" // inbound email + API capture (the website form is on every plan)
  | "calendarIntegration"
  | "leadPrioritisation"
  | "teamAssignment"
  | "customFields"
  | "multiplePipelines"
  | "advancedReports"
  | "automationMonitoring"
  | "prioritySupport";

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  tagline: string;
  /** Prices in pence, VAT exclusive. */
  pricePence: Record<BillingInterval, number>;
  limits: {
    users: number;
    workspaces: number;
    activeWorkflows: number;
    /** How many reminder offsets one appointment may have (e.g. 24h + 2h = 2). */
    reminderOffsets: number;
    monthly: Record<UsageMetric, number>;
  };
  features: Record<Feature, boolean>;
  /** Marketing bullet points shown on the pricing page. */
  highlights: string[];
}

const none: Record<Feature, boolean> = {
  csvImport: false,
  aiDrafts: false,
  followUpSequences: false,
  customWorkflowRules: false,
  automatedCapture: false,
  calendarIntegration: false,
  leadPrioritisation: false,
  teamAssignment: false,
  customFields: false,
  multiplePipelines: false,
  advancedReports: false,
  automationMonitoring: false,
  prioritySupport: false,
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  starter: {
    key: "starter",
    name: "Starter",
    tagline: "For sole traders who want nothing to slip through the cracks.",
    pricePence: { monthly: 2900, annual: 29000 },
    limits: {
      users: 1,
      workspaces: 1,
      activeWorkflows: 3,
      reminderOffsets: 1,
      monthly: { ai_requests: 100, automation_runs: 300, emails_sent: 300 },
    },
    features: { ...none, csvImport: true, aiDrafts: true },
    highlights: [
      "1 user",
      "Enquiry dashboard and contact records",
      "Website enquiry form and CSV import",
      "Editable email templates with AI-assisted drafts",
      "Acknowledgement emails and a basic appointment reminder",
      "Weekly prospect summary",
      "100 AI drafts / month",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    tagline: "For established businesses that follow up every time.",
    pricePence: { monthly: 7900, annual: 79000 },
    limits: {
      users: 5,
      workspaces: 1,
      activeWorkflows: 15,
      reminderOffsets: 3,
      monthly: { ai_requests: 600, automation_runs: 3000, emails_sent: 3000 },
    },
    features: {
      ...none,
      csvImport: true,
      aiDrafts: true,
      followUpSequences: true,
      customWorkflowRules: true,
      automatedCapture: true,
      calendarIntegration: true,
      leadPrioritisation: true,
      teamAssignment: true,
      automationMonitoring: true,
    },
    highlights: [
      "Everything in Starter",
      "Up to 5 users",
      "Automated follow-up sequences that stop when the customer replies",
      "Inbound email capture",
      "Multiple appointment reminders",
      "Lead prioritisation and custom workflow rules",
      "Automation history and failure alerts",
      "600 AI drafts / month",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    tagline: "For busy teams and small agencies.",
    pricePence: { monthly: 19900, annual: 199000 },
    limits: {
      users: 15,
      workspaces: 1,
      activeWorkflows: 50,
      reminderOffsets: 5,
      monthly: { ai_requests: 2500, automation_runs: 15000, emails_sent: 15000 },
    },
    features: Object.fromEntries(Object.keys(none).map((k) => [k, true])) as Record<Feature, boolean>,
    highlights: [
      "Everything in Growth",
      "Up to 15 users",
      "Team assignment and workload view",
      "Custom fields and multiple service categories",
      "Advanced reporting and automation monitoring",
      "Priority support",
      "2,500 AI drafts / month",
    ],
  },
};

export const PLAN_ORDER: PlanKey[] = ["starter", "growth", "pro"];

/** New workspaces start on this plan, in trial, without payment details. */
export const DEFAULT_PLAN: PlanKey = "growth";
export const TRIAL_DAYS = 14;

/** What a workspace gets while its subscription is past due / cancelled. */
export const LAPSED_PLAN: PlanKey = "starter";

export function planOrDefault(key: string | null | undefined): PlanDefinition {
  return PLANS[(key as PlanKey) ?? DEFAULT_PLAN] ?? PLANS[DEFAULT_PLAN];
}

export function formatPence(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(pence / 100);
}

/** Optional extras the architecture allows for, not yet sold in-app. */
export const ADD_ONS = {
  onboardingSetup: { name: "Done-for-you setup", fromPence: 9900, toPence: 49900 },
} as const;
