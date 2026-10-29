import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { PlanLimitError } from "@/lib/errors";
import { applyDelay } from "@/lib/time";
import { systemActor } from "@/modules/auth/permissions";
import { consumeUsage, hasFeature } from "@/modules/billing/entitlements";
import { isSuppressed } from "@/modules/compliance/suppression";
import { buildVariables, renderEmail } from "@/modules/templates/render";
import { createOutbound } from "@/modules/email/messages";
import { enqueue } from "./queue";
import type { WorkflowStep } from "@/lib/db/schema";

/*
 * The follow-up engine.
 *
 *   enquiry created ─► startEnquiryWorkflows ─► one workflow_run per matching workflow
 *                                                (unique per workflow+enquiry)
 *                     each step is a delayed "workflow.step" job
 *   step due ─► executeWorkflowStep ─► re-check stop rules against CURRENT data
 *                                   ─► prepare/send email or escalate
 *                                   ─► schedule the next step, or finish
 *
 * Stop rules are evaluated when each step falls due, never only at the start,
 * so a reply, booking or status change between steps always wins.
 */

type Workflow = typeof schema.workflows.$inferSelect;
type Enquiry = typeof schema.enquiries.$inferSelect;
type Run = typeof schema.workflowRuns.$inferSelect;

export function matchesConditions(wf: Pick<Workflow, "conditions">, e: Pick<Enquiry, "source" | "priority" | "category">): boolean {
  const c = wf.conditions ?? {};
  if (c.sources?.length && !c.sources.includes(e.source)) return false;
  if (c.priorities?.length && !c.priorities.includes(e.priority)) return false;
  if (c.categories?.length && (!e.category || !c.categories.includes(e.category))) return false;
  return true;
}

export interface StopFacts {
  statusKey: string;
  statusIsClosed: boolean;
  statusStopsFollowUps: boolean;
  lastInboundAt: Date | null;
  humanReplySince: boolean;
  appointmentBookedSince: boolean;
  optedOut: boolean;
}

/** Pure: why this run must stop now, or null to continue. */
export function stopReason(wf: Pick<Workflow, "stopRules">, run: Pick<Run, "startedAt">, f: StopFacts): string | null {
  const r = wf.stopRules;
  if (f.statusIsClosed) return "Enquiry closed";
  if (r.onStatusKeys.includes(f.statusKey) || f.statusStopsFollowUps) return `Status changed to "${f.statusKey}"`;
  if (r.onCustomerReply && f.lastInboundAt && f.lastInboundAt > run.startedAt) return "Customer replied";
  if (r.onBusinessReply && f.humanReplySince) return "Team replied";
  if (r.onAppointmentBooked && f.appointmentBookedSince) return "Appointment booked";
  if (f.optedOut) return "Customer opted out";
  return null;
}

/** Start every enabled enquiry workflow that applies. Called inside the enquiry-creation transaction. */
export async function startEnquiryWorkflows(tx: TenantTx, orgId: string, enquiryId: string) {
  const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
  if (!enquiry) return;
  const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }))!;
  const wfs = await tx.query.workflows.findMany({
    where: and(eq(schema.workflows.trigger, "enquiry_created"), eq(schema.workflows.enabled, true)),
  });
  const sequencesAllowed = await hasFeature(tx, orgId, "followUpSequences");
  for (const wf of wfs) {
    if (!matchesConditions(wf, enquiry) || wf.steps.length === 0) continue;
    if (wf.steps.length > 1 && !sequencesAllowed) continue;
    try {
      await consumeUsage(tx, orgId, "automation_runs");
    } catch (e) {
      if (!(e instanceof PlanLimitError)) throw e;
      await tx.insert(schema.activities).values({ orgId, enquiryId, type: "automation.skipped", summary: `"${wf.name}" skipped: ${e.message}` });
      continue;
    }
    const [run] = await tx
      .insert(schema.workflowRuns)
      .values({ orgId, workflowId: wf.id, subjectId: enquiryId, enquiryId })
      .onConflictDoNothing()
      .returning();
    if (!run) continue;
    const due = applyDelay(new Date(), wf.steps[0].delay, org.businessHours, org.timezone, wf.businessHoursOnly);
    await enqueue(tx, { orgId, type: "workflow.step", payload: { runId: run.id, step: 0 }, runAt: due, dedupeKey: `wfstep:${run.id}:0` });
    if (wf.steps[0].action === "email" && wf.templateKey !== "new_enquiry_ack") {
      await setNextFollowUp(tx, enquiryId, due);
    }
    await tx.insert(schema.activities).values({ orgId, enquiryId, type: "automation.started", summary: `Workflow started: ${wf.name}`, data: { runId: run.id } });
  }
}

async function setNextFollowUp(tx: TenantTx, enquiryId: string, due: Date | null) {
  await tx.update(schema.enquiries).set({ nextFollowUpAt: due }).where(eq(schema.enquiries.id, enquiryId));
}

async function gatherStopFacts(tx: TenantTx, run: Run, enquiry: Enquiry, contactEmail: string | null): Promise<StopFacts> {
  const status = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, enquiry.statusKey) });
  const humanReply = await tx.query.messages.findFirst({
    where: and(
      eq(schema.messages.enquiryId, enquiry.id),
      eq(schema.messages.direction, "outbound"),
      eq(schema.messages.status, "sent"),
      isNull(schema.messages.workflowRunId),
      isNull(schema.messages.appointmentId),
      gt(schema.messages.sentAt, run.startedAt),
    ),
    columns: { id: true },
  });
  const appt = await tx.query.appointments.findFirst({
    where: and(eq(schema.appointments.enquiryId, enquiry.id), ne(schema.appointments.status, "cancelled"), gt(schema.appointments.createdAt, run.startedAt)),
    columns: { id: true },
  });
  return {
    statusKey: enquiry.statusKey,
    statusIsClosed: status?.isClosed ?? !!enquiry.closedAt,
    statusStopsFollowUps: status?.stopsFollowUps ?? false,
    lastInboundAt: enquiry.lastInboundAt,
    humanReplySince: !!humanReply,
    appointmentBookedSince: !!appt,
    optedOut: contactEmail ? await isSuppressed(tx, contactEmail, "transactional") : false,
  };
}

async function finishRun(tx: TenantTx, run: Run, status: "completed" | "stopped" | "failed", reason?: string) {
  await tx
    .update(schema.workflowRuns)
    .set({ status, stopReason: reason ?? null, finishedAt: new Date() })
    .where(and(eq(schema.workflowRuns.id, run.id), eq(schema.workflowRuns.status, "running")));
}

/**
 * Execute step `stepIndex` of a run. Idempotent: the run's next_step must equal
 * stepIndex, and any email carries idempotency key wf:<run>:<step>.
 */
export async function executeWorkflowStep(orgId: string, runId: string, stepIndex: number) {
  await withTenant(systemActor(orgId), async (tx) => {
    // Row lock so two workers can't advance the same run at once.
    await tx.execute(sql`select id from workflow_runs where id = ${runId} for update`);
    const run = await tx.query.workflowRuns.findFirst({ where: eq(schema.workflowRuns.id, runId) });
    if (!run || run.status !== "running" || run.nextStep !== stepIndex) return;
    const wf = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, run.workflowId) });
    const enquiry = run.enquiryId ? await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, run.enquiryId) }) : null;
    if (!wf || !enquiry) return finishRun(tx, run, "stopped", "Workflow or enquiry was deleted");
    if (!wf.enabled) {
      await finishRun(tx, run, "stopped", "Workflow was turned off");
      return;
    }
    const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) });
    const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }))!;

    const reason = stopReason(wf, run, await gatherStopFacts(tx, run, enquiry, contact?.email ?? null));
    if (reason) {
      await finishRun(tx, run, "stopped", reason);
      if (wf.templateKey !== "new_enquiry_ack") await setNextFollowUp(tx, enquiry.id, null);
      await tx.insert(schema.activities).values({ orgId, enquiryId: enquiry.id, type: "automation.stopped", summary: `${wf.name} stopped: ${reason}`, data: { runId } });
      return;
    }

    const step: WorkflowStep | undefined = wf.steps[stepIndex];
    if (!step) return finishRun(tx, run, "completed");

    if (step.action === "escalate") {
      await tx.update(schema.enquiries).set({ priority: "urgent", updatedAt: new Date() }).where(eq(schema.enquiries.id, enquiry.id));
      await tx.insert(schema.activities).values({
        orgId,
        enquiryId: enquiry.id,
        type: "automation.escalated",
        summary: "Escalated: no reply from the team yet — marked urgent",
        data: { runId },
      });
    } else {
      const template = step.templateKey
        ? await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.key, step.templateKey) })
        : null;
      if (!template) {
        await finishRun(tx, run, "failed", `Template "${step.templateKey}" not found`);
        return;
      }
      if (!contact?.email) {
        await finishRun(tx, run, "stopped", "Contact has no email address");
        return;
      }
      const assigned = enquiry.assignedUserId ? await tx.query.users.findFirst({ where: eq(schema.users.id, enquiry.assignedUserId), columns: { name: true } }) : null;
      const rendered = renderEmail(template.subject, template.body, buildVariables({ org, contact, enquiry, assignedUserName: assigned?.name }));
      const flags = [...rendered.missing.map((v) => `missing:${v}`), ...rendered.unknown.map((v) => `unknown:${v}`)];
      const created = await createOutbound(tx, {
        orgId,
        enquiryId: enquiry.id,
        contactId: contact.id,
        toEmail: contact.email,
        subject: rendered.subject,
        body: rendered.body,
        kind: template.kind as "transactional" | "marketing",
        templateKey: template.key,
        reviewFlags: flags,
        idempotencyKey: `wf:${run.id}:${stepIndex}`,
        workflowRunId: run.id,
        autoSend: !wf.requireApproval,
      });
      if (created?.status === "pending_approval" && wf.templateKey !== "new_enquiry_ack") {
        const followUpDue = await tx.query.pipelineStatuses.findFirst({ where: eq(schema.pipelineStatuses.key, "follow_up_due") });
        if (followUpDue && ["new", "contacted", "needs_response"].includes(enquiry.statusKey)) {
          await tx.update(schema.enquiries).set({ statusKey: "follow_up_due", updatedAt: new Date() }).where(eq(schema.enquiries.id, enquiry.id));
        }
      }
    }

    const next = stepIndex + 1;
    if (next < wf.steps.length) {
      const due = applyDelay(new Date(), wf.steps[next].delay, org.businessHours, org.timezone, wf.businessHoursOnly);
      await tx.update(schema.workflowRuns).set({ nextStep: next }).where(eq(schema.workflowRuns.id, run.id));
      await enqueue(tx, { orgId, type: "workflow.step", payload: { runId: run.id, step: next }, runAt: due, dedupeKey: `wfstep:${run.id}:${next}` });
      if (wf.steps[next].action === "email") await setNextFollowUp(tx, enquiry.id, due);
    } else {
      await tx.update(schema.workflowRuns).set({ nextStep: next }).where(eq(schema.workflowRuns.id, run.id));
      await finishRun(tx, run, "completed");
      if (wf.templateKey !== "new_enquiry_ack" && step.action === "email") await setNextFollowUp(tx, enquiry.id, null);
    }
  });
}

/** Stop every running enquiry workflow for an enquiry (e.g. closed by a user) and cancel unsent automated emails. */
export async function stopRunsForEnquiry(tx: TenantTx, orgId: string, enquiryId: string, reason: string) {
  const runs = await tx
    .update(schema.workflowRuns)
    .set({ status: "stopped", stopReason: reason, finishedAt: new Date() })
    .where(and(eq(schema.workflowRuns.enquiryId, enquiryId), eq(schema.workflowRuns.status, "running")))
    .returning({ id: schema.workflowRuns.id });
  if (runs.length) {
    await tx
      .update(schema.messages)
      .set({ status: "cancelled", error: reason })
      .where(and(inArray(schema.messages.workflowRunId, runs.map((r) => r.id)), inArray(schema.messages.status, ["pending_approval", "queued"])));
    await tx.insert(schema.activities).values({ orgId, enquiryId, type: "automation.stopped", summary: `Follow-ups stopped: ${reason}` });
  }
  await setNextFollowUp(tx, enquiryId, null);
}

// ------------------------------------------------------------ dry run

export interface DryRunStep {
  index: number;
  dueAt: Date;
  action: "email" | "escalate";
  subject?: string;
  body?: string;
  missing?: string[];
  outcome: string;
}

/**
 * Simulate a workflow against a real enquiry WITHOUT creating messages, jobs or
 * runs. Shows when each step would fall due and what it would send. Stop rules
 * are evaluated against the enquiry as it is now.
 */
export async function dryRunWorkflow(tx: TenantTx, orgId: string, workflowId: string, enquiryId: string): Promise<{ steps: DryRunStep[]; stoppedBecause: string | null }> {
  const wf = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, workflowId) });
  const enquiry = await tx.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
  if (!wf || !enquiry) throw new Error("Workflow or enquiry not found");
  const org = (await tx.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }))!;
  const contact = await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, enquiry.contactId) });
  const pseudoRun = { id: "dry-run", startedAt: enquiry.createdAt } as Run;
  const facts = await gatherStopFacts(tx, pseudoRun, enquiry, contact?.email ?? null);
  const stoppedBecause = stopReason(wf, pseudoRun, facts);
  const steps: DryRunStep[] = [];
  let at = new Date();
  for (let i = 0; i < wf.steps.length; i++) {
    const s = wf.steps[i];
    at = applyDelay(at, s.delay, org.businessHours, org.timezone, wf.businessHoursOnly);
    if (s.action === "escalate") {
      steps.push({ index: i, dueAt: at, action: "escalate", outcome: "Would mark the enquiry urgent" });
      continue;
    }
    const t = s.templateKey ? await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.key, s.templateKey) }) : null;
    if (!t) {
      steps.push({ index: i, dueAt: at, action: "email", outcome: `Template "${s.templateKey}" is missing — the run would fail here` });
      continue;
    }
    const r = renderEmail(t.subject, t.body, buildVariables({ org, contact, enquiry }));
    const outcome = !contact?.email
      ? "Would stop: contact has no email address"
      : r.missing.length || wf.requireApproval
        ? "Would wait in the approval queue"
        : "Would send automatically";
    steps.push({ index: i, dueAt: at, action: "email", subject: r.subject, body: r.body, missing: r.missing, outcome });
  }
  return { steps, stoppedBecause };
}
