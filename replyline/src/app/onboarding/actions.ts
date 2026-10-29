"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { attempt, bool, num, str, type ActionState } from "@/lib/actions";
import { requireApp, requireUser } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { setActiveOrg } from "@/modules/auth/service";
import { completeOnboarding, createOrganization, getOrganization, updateBusinessProfile, updateSettings } from "@/modules/orgs/service";
import { updateWorkflow } from "@/modules/automation/workflows";
import type { BusinessHours } from "@/lib/db/schema";
import type { IndustryKey } from "@/config/industries";
import type { PlanKey } from "@/config/plans";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function createWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const s = await requireUser();
    const orgId = await createOrganization(s.user.id, { name: str(fd, "name"), industry: str(fd, "industry") as IndustryKey, timezone: str(fd, "timezone") || "Europe/London" });
    await setActiveOrg(s.tokenHash, s.user.id, orgId);
    const plan = str(fd, "plan") as PlanKey;
    if (["starter", "growth", "pro"].includes(plan)) {
      // The trial plan the visitor picked on the pricing page. Still a trial — no payment taken.
      await withTenant({ orgId, userId: s.user.id }, (tx) => tx.update(schema.organizations).set({ planKey: plan }).where(eq(schema.organizations.id, orgId)));
    }
    redirect("/onboarding?step=2");
  });
}

export async function saveContactStep(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const org = await getOrganization(actor);
    const hours = Object.fromEntries(
      DAYS.map((d) => [d, bool(fd, `${d}_open`) ? { open: str(fd, `${d}_from`) || "09:00", close: str(fd, `${d}_to`) || "17:00" } : null]),
    ) as BusinessHours;
    await updateBusinessProfile(actor, {
      name: org.name,
      industry: org.industry as IndustryKey,
      timezone: org.timezone,
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      website: str(fd, "website"),
      bookingLink: str(fd, "bookingLink"),
      emailSignature: org.emailSignature ?? undefined,
      tone: org.tone as "friendly",
      businessHours: hours,
    });
    await updateSettings(actor, { defaultAppointmentMinutes: num(fd, "appointmentMinutes") || 60 });
    redirect("/onboarding?step=3");
  });
}

export async function saveCommsStep(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor, user } = await requireApp();
    const org = await getOrganization(actor);
    await updateBusinessProfile(actor, {
      name: org.name,
      industry: org.industry as IndustryKey,
      timezone: org.timezone,
      phone: org.phone ?? "",
      email: org.email ?? "",
      website: org.website ?? "",
      bookingLink: org.bookingLink ?? "",
      businessHours: org.businessHours,
      tone: str(fd, "tone") as "friendly",
      emailSignature: str(fd, "signature"),
    });
    await updateSettings(actor, {
      enquirySources: fd.getAll("sources").map(String).filter(Boolean),
      followUpDelayBusinessDays: num(fd, "followUpDays") || 2,
      emailProviderPreference: str(fd, "emailProvider") as "none",
      calendarProviderPreference: str(fd, "calendarProvider") as "none",
      report: { ...org.settings.report, emailEnabled: bool(fd, "reportEmail"), recipients: bool(fd, "reportEmail") ? [user.email] : [] },
    });
    // Apply the follow-up delay to the first step of the sequence.
    await withTenant(actor, async (tx) => {
      const wf = await tx.query.workflows.findFirst({ where: and(eq(schema.workflows.orgId, actor.orgId), eq(schema.workflows.templateKey, "follow_up_sequence")) });
      if (wf?.steps[0]) {
        const steps = [...wf.steps];
        steps[0] = { ...steps[0], delay: { amount: num(fd, "followUpDays") || 2, unit: "business_days" } };
        await tx.update(schema.workflows).set({ steps }).where(eq(schema.workflows.id, wf.id));
      }
    });
    // Explicit, audited opt-in to automatic sending for the two low-risk workflows.
    for (const [key, field] of [["new_enquiry_ack", "autoAck"], ["appointment_reminder", "autoReminders"]] as const) {
      const wf = await withTenant(actor, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.templateKey, key) }));
      if (wf) await updateWorkflow(actor, wf.id, { enabled: wf.enabled, requireApproval: !bool(fd, field), businessHoursOnly: wf.businessHoursOnly });
    }
    redirect("/onboarding?step=4");
  });
}

export async function savePrivacyStep(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await updateSettings(actor, { aiDataSharingAcknowledged: bool(fd, "aiAck"), retentionMonths: num(fd, "retention") || 24 });
    await completeOnboarding(actor);
    redirect("/app?welcome=1");
  });
}
