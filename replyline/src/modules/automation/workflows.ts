import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { assertFeature, loadPlan } from "@/modules/billing/entitlements";
import { audit } from "@/modules/audit/service";
import { WORKFLOW_SEEDS } from "@/config/industries";
import { dryRunWorkflow } from "./engine";

export async function listWorkflows(actor: Actor) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const wfs = await tx.query.workflows.findMany({ orderBy: [schema.workflows.createdAt] });
    const stats = await tx
      .select({ workflowId: schema.workflowRuns.workflowId, status: schema.workflowRuns.status, n: sql<number>`count(*)::int` })
      .from(schema.workflowRuns)
      .groupBy(schema.workflowRuns.workflowId, schema.workflowRuns.status);
    const { plan } = await loadPlan(tx, actor.orgId);
    return wfs.map((w) => {
      const seed = WORKFLOW_SEEDS.find((s) => s.templateKey === w.templateKey);
      const locked = seed?.requiresFeature ? !plan.features[seed.requiresFeature] : false;
      const counts = Object.fromEntries(stats.filter((s) => s.workflowId === w.id).map((s) => [s.status, s.n]));
      return { ...w, locked, counts };
    });
  });
}

export async function getWorkflow(actor: Actor, id: string) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const wf = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) });
    if (!wf) throw new AppError("Workflow not found", "not_found");
    const runs = await tx
      .select({
        id: schema.workflowRuns.id,
        status: schema.workflowRuns.status,
        stopReason: schema.workflowRuns.stopReason,
        nextStep: schema.workflowRuns.nextStep,
        startedAt: schema.workflowRuns.startedAt,
        finishedAt: schema.workflowRuns.finishedAt,
        enquiryId: schema.workflowRuns.enquiryId,
        subject: schema.enquiries.subject,
      })
      .from(schema.workflowRuns)
      .leftJoin(schema.enquiries, eq(schema.enquiries.id, schema.workflowRuns.enquiryId))
      .where(eq(schema.workflowRuns.workflowId, id))
      .orderBy(desc(schema.workflowRuns.startedAt))
      .limit(50);
    const templates = await tx.query.emailTemplates.findMany({ columns: { key: true, name: true, kind: true } });
    const statuses = await tx.query.pipelineStatuses.findMany({ orderBy: (s, { asc }) => [asc(s.position)] });
    return { workflow: wf, runs, templates, statuses };
  });
}

const stepSchema = z.object({
  delay: z.object({ amount: z.number().int().min(0).max(365), unit: z.enum(["minutes", "hours", "business_days"]) }),
  action: z.enum(["email", "escalate"]),
  templateKey: z.string().max(80).optional(),
});

export const workflowUpdateSchema = z.object({
  enabled: z.boolean(),
  requireApproval: z.boolean(),
  businessHoursOnly: z.boolean(),
  steps: z.array(stepSchema).max(6).optional(),
  conditions: z
    .object({ sources: z.array(z.string()).optional(), priorities: z.array(z.string()).optional(), categories: z.array(z.string()).optional() })
    .optional(),
  stopRules: z
    .object({ onCustomerReply: z.boolean(), onBusinessReply: z.boolean(), onAppointmentBooked: z.boolean(), onStatusKeys: z.array(z.string()) })
    .optional(),
});

/**
 * Save workflow settings. Turning approval OFF (= automatic sending) is an
 * owner-only, audited decision, and is refused for marketing templates.
 */
export async function updateWorkflow(actor: Actor, id: string, input: z.input<typeof workflowUpdateSchema>) {
  assertCan(actor, "workflow.write");
  const data = workflowUpdateSchema.parse(input);
  await withTenant(actor, async (tx) => {
    const wf = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) });
    if (!wf) throw new AppError("Workflow not found", "not_found");
    const seed = WORKFLOW_SEEDS.find((s) => s.templateKey === wf.templateKey);
    if (data.enabled && seed?.requiresFeature) await assertFeature(tx, actor.orgId, seed.requiresFeature, "Automated follow-up sequences");
    const changed = (a: unknown, b: unknown) => a !== undefined && JSON.stringify(a) !== JSON.stringify(b);
    if (changed(data.steps, wf.steps) || changed(data.conditions, wf.conditions) || changed(data.stopRules, wf.stopRules)) {
      await assertFeature(tx, actor.orgId, "customWorkflowRules", "Custom workflow rules");
    }
    if (data.enabled && !wf.enabled) {
      const { plan } = await loadPlan(tx, actor.orgId);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.workflows).where(eq(schema.workflows.enabled, true));
      if (n >= plan.limits.activeWorkflows) throw new AppError(`The ${plan.name} plan allows ${plan.limits.activeWorkflows} active workflows.`, "limit");
    }
    const steps = data.steps ?? wf.steps;
    for (const s of steps) {
      if (s.action !== "email") continue;
      const t = s.templateKey ? await tx.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.key, s.templateKey) }) : null;
      if (!t) throw new AppError("Each email step needs an existing template.");
      if (!data.requireApproval && t.kind === "marketing") {
        throw new AppError("Marketing templates can't be sent automatically. Keep approval on for this workflow.");
      }
    }
    if (!data.requireApproval && wf.requireApproval) {
      assertCan(actor, "workflow.authorise_autosend");
    }
    await tx
      .update(schema.workflows)
      .set({
        enabled: data.enabled,
        requireApproval: data.requireApproval,
        businessHoursOnly: data.businessHoursOnly,
        steps,
        conditions: data.conditions ?? wf.conditions,
        stopRules: data.stopRules ?? wf.stopRules,
        updatedAt: new Date(),
      })
      .where(eq(schema.workflows.id, id));
    if (data.requireApproval !== wf.requireApproval) {
      await audit(tx, actor, data.requireApproval ? "workflow.autosend_disabled" : "workflow.autosend_authorised", { type: "workflow", id }, { name: wf.name });
    }
    if (data.enabled !== wf.enabled) await audit(tx, actor, data.enabled ? "workflow.enabled" : "workflow.disabled", { type: "workflow", id }, { name: wf.name });
    // Turning a workflow off stops its in-flight runs at their next step (see executeWorkflowStep).
  });
}

export async function testWorkflow(actor: Actor, workflowId: string, enquiryId: string) {
  assertCan(actor, "workflow.write");
  return withTenant(actor, (tx) => dryRunWorkflow(tx, actor.orgId, workflowId, enquiryId));
}

export async function recentEnquiriesForTest(actor: Actor) {
  return withTenant(actor, (tx) =>
    tx.select({ id: schema.enquiries.id, subject: schema.enquiries.subject }).from(schema.enquiries).orderBy(desc(schema.enquiries.createdAt)).limit(20),
  );
}

export async function stopRun(actor: Actor, runId: string) {
  assertCan(actor, "workflow.write");
  await withTenant(actor, async (tx) => {
    const [r] = await tx
      .update(schema.workflowRuns)
      .set({ status: "stopped", stopReason: "Stopped by a user", finishedAt: new Date() })
      .where(and(eq(schema.workflowRuns.id, runId), eq(schema.workflowRuns.status, "running")))
      .returning();
    if (!r) throw new AppError("That run isn't running.", "conflict");
  });
}
