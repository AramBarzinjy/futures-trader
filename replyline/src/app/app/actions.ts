"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attempt, bool, num, str, type ActionState } from "@/lib/actions";
import { requireApp } from "@/lib/auth/session";
import { runDueJobs } from "@/worker/process";
import type { ImportField } from "@/modules/enquiries/service";
import {
  addNote,
  bulkUpdate,
  createEnquiry,
  importEnquiries,
  previewImport,
  resolveDuplicate,
  updateEnquiry,
  PRIORITIES,
} from "@/modules/enquiries/service";
import { setMarketingConsent, updateContact } from "@/modules/contacts/service";
import { approveMessage, composeMessage, discardMessage, logCustomerReply } from "@/modules/email/messages";
import { aiDraft, aiNextAction, aiQuestions, aiSummary } from "@/modules/ai/service";
import { FLAG_LABELS } from "@/modules/ai/validate";
import { createAppointment, rescheduleAppointment, setAppointmentStatus } from "@/modules/appointments/service";
import { retryJob } from "@/modules/automation/queue";
import { stopRun, testWorkflow, updateWorkflow } from "@/modules/automation/workflows";
import { deleteTemplate, previewTemplate, resetTemplate, saveTemplate } from "@/modules/templates/service";
import { changeRole, inviteMember, removeMember, revokeInvite } from "@/modules/team/service";
import { saveStatuses, updateBusinessProfile, updateSettings } from "@/modules/orgs/service";
import { devSetStatus, openBillingPortal, startCheckout } from "@/modules/billing/service";
import { deleteOrganization, eraseContact } from "@/modules/compliance/data";
import { generateReportNow } from "@/modules/reports/service";
import type { BusinessHours } from "@/lib/db/schema";
import type { IndustryKey } from "@/config/industries";
import type { Role } from "@/modules/auth/permissions";

/** Process jobs that are already due (e.g. a just-approved email) so the UI updates immediately. The worker does the same in the background. */
async function kick() {
  await runDueJobs(20).catch(() => undefined);
}

// ------------------------------------------------------------ enquiries

export async function createEnquiryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const r = await createEnquiry(actor, {
      contact: { name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), company: str(fd, "company") },
      subject: str(fd, "subject"),
      message: str(fd, "message"),
      source: str(fd, "source") || "manual",
      category: str(fd, "category"),
      priority: (str(fd, "priority") || "normal") as (typeof PRIORITIES)[number],
      assignedUserId: str(fd, "assignedUserId"),
      marketingConsent: bool(fd, "marketingConsent"),
    }, { runAutomation: !bool(fd, "skipAutomation"), consentSource: "Recorded by staff at entry" });
    await kick();
    redirect(`/app/enquiries/${r.id}`);
  });
}

export async function updateEnquiryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const id = str(fd, "id");
    const followUp = str(fd, "nextFollowUpAt");
    await updateEnquiry(actor, id, {
      statusKey: str(fd, "statusKey") || undefined,
      priority: (str(fd, "priority") || undefined) as (typeof PRIORITIES)[number] | undefined,
      category: fd.has("category") ? str(fd, "category") || null : undefined,
      assignedUserId: fd.has("assignedUserId") ? str(fd, "assignedUserId") || null : undefined,
      nextFollowUpAt: fd.has("nextFollowUpAt") ? (followUp ? new Date(followUp) : null) : undefined,
    });
    revalidatePath(`/app/enquiries/${id}`);
    return { ok: true, message: "Saved." };
  });
}

/** Kanban card / list quick status change. */
export async function setStatusAction(fd: FormData) {
  const { actor } = await requireApp();
  await updateEnquiry(actor, str(fd, "id"), { statusKey: str(fd, "statusKey") });
  revalidatePath("/app/enquiries");
}

export async function addNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await addNote(actor, str(fd, "id"), str(fd, "body"));
    revalidatePath(`/app/enquiries/${str(fd, "id")}`);
    return { ok: true };
  });
}

export async function resolveDuplicateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await resolveDuplicate(actor, str(fd, "id"), str(fd, "resolution") as "not_duplicate");
    revalidatePath(`/app/enquiries/${str(fd, "id")}`);
    return { ok: true, message: "Duplicate flag resolved." };
  });
}

export async function bulkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) return { error: "Select at least one enquiry." };
    const op = str(fd, "op");
    const r =
      op === "delete"
        ? await bulkUpdate(actor, { action: "delete", ids, confirmCount: num(fd, "confirmCount") })
        : op === "priority"
          ? await bulkUpdate(actor, { action: "priority", ids, priority: str(fd, "value") as "normal" })
          : op === "assign"
            ? await bulkUpdate(actor, { action: "assign", ids, assignedUserId: str(fd, "value") || null })
            : await bulkUpdate(actor, { action: "status", ids, statusKey: str(fd, "value") });
    revalidatePath("/app/enquiries");
    return { ok: true, message: `Updated ${r.affected} enquir${r.affected === 1 ? "y" : "ies"}.` };
  });
}

export async function previewImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    await requireApp();
    const file = fd.get("file");
    const text = file instanceof File && file.size ? await file.text() : str(fd, "csv");
    if (text.length > 2_000_000) return { error: "That file is too large (2 MB max)." };
    const p = previewImport(text);
    return { ok: true, data: { preview: p, csv: text } };
  });
}

export async function runImportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const mapping: Partial<Record<ImportField, number>> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("map_") && v !== "") mapping[k.slice(4) as ImportField] = Number(v);
    }
    const r = await importEnquiries(actor, str(fd, "csv"), mapping, { runAutomation: bool(fd, "runAutomation") });
    revalidatePath("/app/enquiries");
    return { ok: true, message: `Imported ${r.created} enquiries (${r.matchedContacts} matched existing contacts${r.conflicts ? `, ${r.conflicts} with differing details kept for review` : ""}). ${r.errors.length ? `${r.errors.length} rows skipped.` : ""}`, data: { errors: r.errors } };
  });
}

// ------------------------------------------------------------ messages + AI

export async function composeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const action = str(fd, "intent") === "send" ? "send" : "draft";
    await composeMessage(actor, str(fd, "id"), {
      subject: str(fd, "subject"),
      body: str(fd, "body"),
      kind: str(fd, "kind") === "marketing" ? "marketing" : "transactional",
      templateKey: str(fd, "templateKey") || undefined,
      aiGenerated: bool(fd, "aiGenerated"),
      action,
    });
    if (action === "send") await kick();
    revalidatePath(`/app/enquiries/${str(fd, "id")}`);
    return { ok: true, message: action === "send" ? "Sent." : "Draft saved." };
  });
}

export async function aiAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const id = str(fd, "id");
    const op = str(fd, "op");
    const draft = { subject: str(fd, "subject"), body: str(fd, "body") };
    if (op === "questions") return { ok: true, data: { questions: (await aiQuestions(actor, id)).questions } };
    if (op === "summary") return { ok: true, data: { summary: await aiSummary(actor, id) } };
    if (op === "next") return { ok: true, data: { next: await aiNextAction(actor, id) } };
    const task =
      op === "draft"
        ? ({ kind: "draft" } as const)
        : op === "shorter" || op === "more_detailed"
          ? ({ kind: "length", direction: op, draft } as const)
          : ({ kind: "rewrite", tone: op as "friendly", draft } as const);
    if (task.kind !== "draft" && !draft.body.trim()) return { error: "Write or generate a draft first." };
    const d = await aiDraft(actor, id, task);
    return { ok: true, data: { draft: d, flagLabels: d.flags.map((f) => FLAG_LABELS[f]) } };
  });
}

export async function templateIntoComposerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const r = await previewTemplate(actor, str(fd, "subject"), str(fd, "body"), str(fd, "id"));
    return { ok: true, data: { draft: { subject: r.subject, body: r.body, needsConfirmation: r.missing.map((m) => `Fill in ${m.replace(/_/g, " ")}`), flags: [] }, templateKey: str(fd, "templateKey"), kind: str(fd, "kind") } };
  });
}

export async function logReplyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await logCustomerReply(actor, str(fd, "id"), { body: str(fd, "body"), subject: str(fd, "subject") });
    revalidatePath(`/app/enquiries/${str(fd, "id")}`);
    return { ok: true, message: "Reply logged. Any running follow-ups will stop." };
  });
}

export async function approveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await approveMessage(actor, str(fd, "messageId"), { subject: str(fd, "subject"), body: str(fd, "body") });
    await kick();
    // The message leaves the queue, taking its form with it, so confirm at page level.
    redirect("/app/follow-ups?done=approved");
  });
}

export async function discardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await discardMessage(actor, str(fd, "messageId"));
    redirect("/app/follow-ups?done=discarded");
  });
}

// ------------------------------------------------------------ contacts

export async function updateContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await updateContact(actor, str(fd, "id"), { name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), company: str(fd, "company"), notes: str(fd, "notes") });
    revalidatePath(`/app/contacts/${str(fd, "id")}`);
    return { ok: true, message: "Contact saved." };
  });
}

export async function consentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await setMarketingConsent(actor, str(fd, "id"), str(fd, "consent") === "granted" ? "granted" : "withdrawn", str(fd, "source") || "Updated by staff");
    revalidatePath(`/app/contacts/${str(fd, "id")}`);
    return { ok: true, message: "Consent updated." };
  });
}

export async function eraseContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    if (str(fd, "confirm") !== "ERASE") return { error: "Type ERASE to confirm." };
    await eraseContact(actor, str(fd, "id"));
    revalidatePath(`/app/contacts/${str(fd, "id")}`);
    return { ok: true, message: "Personal data erased. The address stays on your suppression list." };
  });
}

// ------------------------------------------------------------ appointments

export async function createAppointmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const a = await createAppointment(actor, {
      contactId: str(fd, "contactId"),
      enquiryId: str(fd, "enquiryId"),
      title: str(fd, "title"),
      date: str(fd, "date"),
      time: str(fd, "time"),
      timezone: str(fd, "timezone"),
      durationMinutes: num(fd, "durationMinutes"),
      location: str(fd, "location"),
      meetingLink: str(fd, "meetingLink"),
      assignedUserId: str(fd, "assignedUserId"),
      reminderOffsetsMinutes: fd.getAll("reminders").map(Number).filter(Boolean),
      notifyCustomer: bool(fd, "notifyCustomer"),
    });
    await kick();
    redirect(`/app/appointments/${a.id}`);
  });
}

export async function rescheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await rescheduleAppointment(actor, str(fd, "id"), { date: str(fd, "date"), time: str(fd, "time"), notifyCustomer: bool(fd, "notifyCustomer") });
    await kick();
    revalidatePath(`/app/appointments/${str(fd, "id")}`);
    return { ok: true, message: "Rescheduled. Old reminders were cancelled and new ones scheduled." };
  });
}

export async function appointmentStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await setAppointmentStatus(actor, str(fd, "id"), str(fd, "status") as "cancelled", bool(fd, "notifyCustomer"));
    await kick();
    revalidatePath(`/app/appointments/${str(fd, "id")}`);
    return { ok: true, message: "Updated." };
  });
}

// ------------------------------------------------------------ workflows & jobs

export async function updateWorkflowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const id = str(fd, "id");
    const stepCount = num(fd, "stepCount");
    const steps = Array.from({ length: stepCount }, (_, i) => ({
      delay: { amount: num(fd, `step${i}_amount`), unit: str(fd, `step${i}_unit`) as "business_days" },
      action: str(fd, `step${i}_action`) as "email",
      templateKey: str(fd, `step${i}_template`) || undefined,
    }));
    await updateWorkflow(actor, id, {
      enabled: bool(fd, "enabled"),
      requireApproval: !bool(fd, "autoSend"),
      businessHoursOnly: bool(fd, "businessHoursOnly"),
      ...(stepCount ? { steps } : {}),
      ...(fd.has("hasRules")
        ? {
            stopRules: { onCustomerReply: bool(fd, "stopReply"), onBusinessReply: bool(fd, "stopTeamReply"), onAppointmentBooked: bool(fd, "stopBooked"), onStatusKeys: fd.getAll("stopStatus").map(String) },
            conditions: { sources: fd.getAll("condSource").map(String).filter(Boolean) },
          }
        : {}),
    });
    revalidatePath(`/app/workflows/${id}`);
    return { ok: true, message: "Workflow saved." };
  });
}

export async function testWorkflowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const r = await testWorkflow(actor, str(fd, "id"), str(fd, "enquiryId"));
    return { ok: true, data: { result: JSON.parse(JSON.stringify(r)) } };
  });
}

export async function stopRunAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await stopRun(actor, str(fd, "runId"));
    revalidatePath(`/app/workflows/${str(fd, "id")}`);
    return { ok: true, message: "Run stopped." };
  });
}

export async function retryJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await retryJob(actor, str(fd, "jobId"));
    await kick();
    revalidatePath("/app/workflows/health");
    return { ok: true, message: "Retried." };
  });
}

// ------------------------------------------------------------ templates

export async function saveTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const id = str(fd, "id") || null;
    const t = await saveTemplate(actor, id, { name: str(fd, "name"), purpose: str(fd, "purpose"), kind: str(fd, "kind") as "transactional", subject: str(fd, "subject"), body: str(fd, "body") });
    if (!id) redirect(`/app/templates/${t.id}`);
    revalidatePath(`/app/templates/${t.id}`);
    return { ok: true, message: "Template saved." };
  });
}

export async function previewTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const r = await previewTemplate(actor, str(fd, "subject"), str(fd, "body"), str(fd, "enquiryId") || undefined);
    return { ok: true, data: { preview: r } };
  });
}

export async function resetTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await resetTemplate(actor, str(fd, "id"));
    revalidatePath(`/app/templates/${str(fd, "id")}`);
    return { ok: true, message: "Reset to the default wording." };
  });
}

export async function deleteTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await deleteTemplate(actor, str(fd, "id"));
    redirect("/app/templates");
  });
}

// ------------------------------------------------------------ team

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const link = await inviteMember(actor, { email: str(fd, "email"), role: str(fd, "role") as "member" });
    revalidatePath("/app/team");
    return { ok: true, message: "Invitation created. Email sending for invites isn't connected yet — copy this link to them:", data: { link } };
  });
}

export async function teamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const op = str(fd, "op");
    if (op === "role") await changeRole(actor, str(fd, "membershipId"), str(fd, "role") as Role);
    if (op === "remove") await removeMember(actor, str(fd, "membershipId"));
    if (op === "revoke") await revokeInvite(actor, str(fd, "inviteId"));
    revalidatePath("/app/team");
    return { ok: true, message: "Updated." };
  });
}

// ------------------------------------------------------------ settings

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const businessHours = Object.fromEntries(
      DAYS.map((d) => [d, bool(fd, `${d}_open`) ? { open: str(fd, `${d}_from`), close: str(fd, `${d}_to`) } : null]),
    ) as BusinessHours;
    await updateBusinessProfile(actor, {
      name: str(fd, "name"),
      industry: str(fd, "industry") as IndustryKey,
      timezone: str(fd, "timezone"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      website: str(fd, "website"),
      bookingLink: str(fd, "bookingLink"),
      emailSignature: str(fd, "signature"),
      tone: str(fd, "tone") as "friendly",
      businessHours,
    });
    revalidatePath("/app/settings");
    return { ok: true, message: "Business profile saved." };
  });
}

export async function savePreferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const lines = (k: string) => str(fd, k).split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
    await updateSettings(actor, {
      enquirySources: lines("sources"),
      categories: lines("categories"),
      defaultAppointmentMinutes: num(fd, "appointmentMinutes"),
      report: { weekday: num(fd, "reportWeekday"), hour: num(fd, "reportHour"), recipients: lines("reportRecipients"), emailEnabled: bool(fd, "reportEmail") },
    });
    revalidatePath("/app/settings");
    return { ok: true, message: "Preferences saved." };
  });
}

export async function savePrivacyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await updateSettings(actor, {
      aiDataSharingAcknowledged: bool(fd, "aiAck"),
      retentionMonths: num(fd, "retention"),
      marketingBasis: str(fd, "marketingBasis") === "soft_opt_in" ? "soft_opt_in" : "consent_required",
    });
    revalidatePath("/app/settings");
    return { ok: true, message: "Privacy settings saved." };
  });
}

export async function saveStatusesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const n = num(fd, "count");
    const list = Array.from({ length: n }, (_, i) => i)
      .filter((i) => !bool(fd, `s${i}_remove`) && str(fd, `s${i}_key`) && str(fd, `s${i}_label`))
      .map((i) => {
        const type = str(fd, `s${i}_type`);
        return {
          key: str(fd, `s${i}_key`),
          label: str(fd, `s${i}_label`),
          isClosed: type !== "open",
          outcome: (type === "won" || type === "lost" ? type : null) as "won" | "lost" | null,
          stopsFollowUps: bool(fd, `s${i}_stops`) || type !== "open",
          color: str(fd, `s${i}_color`) || "slate",
        };
      });
    await saveStatuses(actor, list);
    revalidatePath("/app/settings");
    return { ok: true, message: "Statuses saved." };
  });
}

export async function deleteWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await deleteOrganization(actor, str(fd, "confirmName"));
    redirect("/onboarding");
  });
}

// ------------------------------------------------------------ billing & reports

export async function checkoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const url = await startCheckout(actor, { plan: str(fd, "plan") as "growth", interval: str(fd, "interval") as "monthly" });
    redirect(url);
  });
}

export async function portalAction(): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    redirect(await openBillingPortal(actor));
  });
}

export async function devBillingStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    await devSetStatus(actor, str(fd, "status") as "active");
    revalidatePath("/app/billing");
    return { ok: true, message: "Status changed (development only)." };
  });
}

export async function generateReportAction(): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await requireApp();
    const r = await generateReportNow(actor);
    await kick();
    redirect(`/app/reports/${r.id}`);
  });
}
