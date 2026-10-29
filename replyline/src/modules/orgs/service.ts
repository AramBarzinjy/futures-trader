import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DateTime } from "luxon";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { DEFAULT_BUSINESS_HOURS, isValidTimezone } from "@/lib/time";
import { AppError } from "@/lib/errors";
import { DEFAULT_PLAN, TRIAL_DAYS } from "@/config/plans";
import {
  DEFAULT_STATUSES,
  INDUSTRIES,
  INDUSTRY_KEYS,
  WORKFLOW_SEEDS,
  templatesFor,
  type IndustryKey,
} from "@/config/industries";
import type { BusinessHours, OrgSettings } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { audit } from "@/modules/audit/service";
import { nextReportTime } from "@/modules/reports/schedule";

export const createOrgSchema = z.object({
  name: z.string().trim().min(1, "Enter your business name").max(120),
  industry: z.enum(INDUSTRY_KEYS as [IndustryKey, ...IndustryKey[]]),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone").default("Europe/London"),
});

export function defaultSettings(industry: IndustryKey): OrgSettings {
  const preset = INDUSTRIES[industry];
  return {
    enquirySources: preset.sources,
    emailProviderPreference: "none",
    calendarProviderPreference: "none",
    defaultAppointmentMinutes: preset.defaultAppointmentMinutes,
    followUpDelayBusinessDays: 2,
    report: { weekday: 1, hour: 8, recipients: [], emailEnabled: false },
    aiDataSharingAcknowledged: false,
    marketingBasis: "consent_required",
    retentionMonths: 24,
    categories: preset.categories,
  };
}

/** Create a workspace and make `userId` its owner. Seeds statuses, templates and workflows. */
export async function createOrganization(userId: string, input: z.input<typeof createOrgSchema>) {
  const data = createOrgSchema.parse(input);
  const orgId = randomUUID();
  const settings = defaultSettings(data.industry);
  // The id is chosen first so the insert can be done inside that tenant's RLS scope.
  await withTenant({ orgId, userId }, async (tx) => {
    await tx.insert(schema.organizations).values({
      id: orgId,
      name: data.name,
      industry: data.industry,
      timezone: data.timezone,
      businessHours: DEFAULT_BUSINESS_HOURS,
      settings,
      formKey: randomToken(18),
      planKey: DEFAULT_PLAN,
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      nextReportAt: nextReportTime(new Date(), settings.report, data.timezone),
    });
    await tx.insert(schema.memberships).values({ orgId, userId, role: "owner" });
    await seedDefaults(tx, orgId, data.industry);
    await audit(tx, { orgId, userId, role: "owner" }, "org.created", { type: "organization", id: orgId });
  });
  return orgId;
}

export async function seedDefaults(tx: TenantTx, orgId: string, industry: IndustryKey) {
  await tx.insert(schema.pipelineStatuses).values(
    DEFAULT_STATUSES.map((s, i) => ({
      orgId,
      key: s.key,
      label: s.label,
      position: i,
      isClosed: s.isClosed ?? false,
      outcome: s.outcome ?? null,
      stopsFollowUps: s.stopsFollowUps ?? false,
      color: s.color,
    })),
  );
  await tx.insert(schema.emailTemplates).values(templatesFor(industry).map((t) => ({ orgId, ...t })));
  await tx.insert(schema.workflows).values(
    WORKFLOW_SEEDS.map((w) => ({
      orgId,
      templateKey: w.templateKey,
      name: w.name,
      purpose: w.purpose,
      trigger: w.trigger,
      steps: w.steps,
      stopRules: w.stopRules,
      conditions: w.conditions ?? {},
      businessHoursOnly: w.businessHoursOnly,
      // Every workflow starts in "needs approval" mode. Auto-send is an explicit, audited choice.
      requireApproval: true,
      enabled: w.enabledByDefault,
    })),
  );
}

export async function getOrganization(actor: Actor) {
  return withTenant(actor, async (tx) => {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    if (!org) throw new AppError("Workspace not found", "not_found");
    return org;
  });
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const dayHours = z.object({ open: hhmm, close: hhmm }).nullable();

export const businessProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  industry: z.enum(INDUSTRY_KEYS as [IndustryKey, ...IndustryKey[]]),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  website: z.string().trim().url().optional().or(z.literal("")),
  bookingLink: z.string().trim().url().optional().or(z.literal("")),
  emailSignature: z.string().max(1000).optional(),
  tone: z.enum(["friendly", "professional", "concise", "warm"]),
  businessHours: z.object({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours }),
});

export async function updateBusinessProfile(actor: Actor, input: z.input<typeof businessProfileSchema>) {
  assertCan(actor, "settings.write");
  const data = businessProfileSchema.parse(input);
  for (const [day, h] of Object.entries(data.businessHours)) {
    if (h && h.open >= h.close) throw new AppError(`Opening time must be before closing time on ${day}.`);
  }
  await withTenant(actor, async (tx) => {
    await tx
      .update(schema.organizations)
      .set({
        ...data,
        phone: data.phone || null,
        email: data.email || null,
        website: data.website || null,
        bookingLink: data.bookingLink || null,
        businessHours: data.businessHours as BusinessHours,
      })
      .where(eq(schema.organizations.id, actor.orgId));
    await audit(tx, actor, "settings.business_profile_updated");
  });
}

export const settingsPatchSchema = z
  .object({
    enquirySources: z.array(z.string().trim().min(1).max(60)).max(30),
    categories: z.array(z.string().trim().min(1).max(60)).max(50),
    emailProviderPreference: z.enum(["none", "gmail", "microsoft", "other"]),
    calendarProviderPreference: z.enum(["none", "google", "microsoft"]),
    defaultAppointmentMinutes: z.number().int().min(5).max(600),
    followUpDelayBusinessDays: z.number().int().min(1).max(30),
    report: z.object({
      weekday: z.number().int().min(1).max(7),
      hour: z.number().int().min(0).max(23),
      recipients: z.array(z.string().email()).max(10),
      emailEnabled: z.boolean(),
    }),
    aiDataSharingAcknowledged: z.boolean(),
    marketingBasis: z.enum(["consent_required", "soft_opt_in"]),
    retentionMonths: z.number().int().min(1).max(120),
  })
  .partial();

export async function updateSettings(actor: Actor, patch: z.input<typeof settingsPatchSchema>) {
  assertCan(actor, "settings.write");
  const data = settingsPatchSchema.parse(patch);
  await withTenant(actor, async (tx) => {
    const org = await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, actor.orgId) });
    if (!org) throw new AppError("Workspace not found", "not_found");
    const settings = { ...org.settings, ...data };
    const values: Partial<typeof schema.organizations.$inferInsert> = { settings };
    if (data.report) values.nextReportAt = nextReportTime(new Date(), settings.report, org.timezone);
    await tx.update(schema.organizations).set(values).where(eq(schema.organizations.id, actor.orgId));
    if (data.aiDataSharingAcknowledged !== undefined && data.aiDataSharingAcknowledged !== org.settings.aiDataSharingAcknowledged) {
      await audit(tx, actor, "settings.ai_data_sharing_changed", undefined, { acknowledged: data.aiDataSharingAcknowledged });
    }
    if (data.marketingBasis && data.marketingBasis !== org.settings.marketingBasis) {
      await audit(tx, actor, "settings.marketing_basis_changed", undefined, { basis: data.marketingBasis });
    }
    if (data.retentionMonths && data.retentionMonths !== org.settings.retentionMonths) {
      await audit(tx, actor, "settings.retention_changed", undefined, { months: data.retentionMonths });
    }
  });
}

export async function completeOnboarding(actor: Actor) {
  assertCan(actor, "settings.write");
  await withTenant(actor, async (tx) => {
    await tx.update(schema.organizations).set({ onboardingCompletedAt: new Date() }).where(eq(schema.organizations.id, actor.orgId));
    await audit(tx, actor, "onboarding.completed");
  });
}

export async function listStatuses(tx: TenantTx) {
  return tx.query.pipelineStatuses.findMany({ orderBy: (s, { asc }) => [asc(s.position)] });
}

export const statusSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/, "Lowercase letters, numbers and underscores only"),
  label: z.string().trim().min(1).max(40),
  isClosed: z.boolean().default(false),
  outcome: z.enum(["won", "lost"]).nullable().default(null),
  stopsFollowUps: z.boolean().default(false),
  color: z.string().default("slate"),
});

/** Replace the status list. Statuses still in use by an enquiry cannot be removed. */
export async function saveStatuses(actor: Actor, list: z.input<typeof statusSchema>[]) {
  assertCan(actor, "settings.write");
  const parsed = z.array(statusSchema).min(2).max(20).parse(list);
  const keys = new Set(parsed.map((s) => s.key));
  if (keys.size !== parsed.length) throw new AppError("Each status needs a unique key.");
  if (!parsed.some((s) => !s.isClosed)) throw new AppError("At least one status must be open.");
  await withTenant(actor, async (tx) => {
    const existing = await listStatuses(tx);
    for (const s of existing) {
      if (keys.has(s.key)) continue;
      const inUse = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.statusKey, s.key), columns: { id: true } });
      if (inUse) throw new AppError(`"${s.label}" is still used by enquiries. Move them to another status first.`, "conflict");
    }
    await tx.delete(schema.pipelineStatuses).where(eq(schema.pipelineStatuses.orgId, actor.orgId));
    await tx.insert(schema.pipelineStatuses).values(parsed.map((s, i) => ({ ...s, orgId: actor.orgId, position: i })));
    await audit(tx, actor, "settings.statuses_updated", undefined, { count: parsed.length });
  });
}

export function trialDaysLeft(trialEndsAt: Date | null): number | null {
  if (!trialEndsAt) return null;
  return Math.max(0, Math.ceil(DateTime.fromJSDate(trialEndsAt).diffNow("days").days));
}

export async function getStatuses(actor: Actor) {
  return withTenant(actor, (tx) => listStatuses(tx));
}
