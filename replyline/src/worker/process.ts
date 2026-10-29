import { eq, sql } from "drizzle-orm";
import { schema, systemDb } from "@/lib/db";
import { pruneRateLimits } from "@/lib/rate-limit";
import { claimDueJobs, completeJob, enqueue, failJob, recoverStaleJobs, type Job } from "@/modules/automation/queue";
import { executeWorkflowStep } from "@/modules/automation/engine";
import { deliverMessage } from "@/modules/email/messages";
import { sendAppointmentMessage, type AppointmentMessageKind } from "@/modules/appointments/service";
import { generateWeeklyReport, scheduleDueReports } from "@/modules/reports/service";
import { purgeExpiredData } from "@/modules/compliance/data";

/*
 * Job dispatch. Used by the long-running worker (npm run worker), the cron
 * endpoint (/api/cron/tick) and the tests — all three run the same code.
 */

async function handle(job: Job): Promise<void> {
  const orgId = job.orgId!;
  const p = job.payload as Record<string, unknown>;
  switch (job.type) {
    case "workflow.step":
      return executeWorkflowStep(orgId, String(p.runId), Number(p.step));
    case "email.send": {
      await deliverMessage(orgId, String(p.messageId), { finalAttempt: job.attempts >= job.maxAttempts });
      return;
    }
    case "appointment.message":
      return sendAppointmentMessage(orgId, {
        appointmentId: String(p.appointmentId),
        version: Number(p.version),
        kind: p.kind as AppointmentMessageKind,
        offset: p.offset === undefined ? undefined : Number(p.offset),
      });
    case "report.weekly":
      await generateWeeklyReport(orgId, new Date(String(p.periodEnd)));
      return;
    case "retention.purge":
      await purgeExpiredData(orgId);
      return;
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

export interface RunResult {
  processed: number;
  failed: number;
  dead: number;
}

/** Process due jobs until none are left or `maxJobs` is reached. */
export async function runDueJobs(maxJobs = 100): Promise<RunResult> {
  const result: RunResult = { processed: 0, failed: 0, dead: 0 };
  while (result.processed < maxJobs) {
    const batch = await claimDueJobs(Math.min(10, maxJobs - result.processed));
    if (!batch.length) break;
    for (const job of batch) {
      result.processed++;
      try {
        await handle(job);
        await completeJob(job.id);
      } catch (e) {
        result.failed++;
        const dead = await failJob(job, e);
        if (dead) {
          result.dead++;
          await recordDeadJob(job, e);
        }
        console.error(`[worker] job ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts})${dead ? " — moved to failed jobs" : ""}`);
      }
    }
  }
  return result;
}

/** Make failures visible to the business: an activity entry they'll see on the dashboard. */
async function recordDeadJob(job: Job, e: unknown) {
  if (!job.orgId) return;
  const p = job.payload as Record<string, unknown>;
  if (job.type === "email.send" && p.messageId) {
    await systemDb().update(schema.messages).set({ status: "failed" }).where(eq(schema.messages.id, String(p.messageId)));
  }
  await systemDb()
    .insert(schema.activities)
    .values({
      orgId: job.orgId,
      type: "automation.failed",
      summary: `Automation task failed after ${job.attempts} attempts (${job.type}). See Workflows → Automation health.`,
      data: { jobId: job.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) },
    });
}

let lastDaily = 0;

/** Periodic housekeeping, once a minute. Cross-tenant scans use the owner role and filter explicitly. */
export async function tick(now = new Date()) {
  await recoverStaleJobs();
  await systemDb().transaction(async (tx) => {
    await scheduleDueReports(tx);
  });
  if (now.getTime() - lastDaily > 86_400_000) {
    lastDaily = now.getTime();
    await pruneRateLimits();
    const day = now.toISOString().slice(0, 10);
    const orgs = await systemDb().select({ id: schema.organizations.id }).from(schema.organizations);
    await systemDb().transaction(async (tx) => {
      for (const o of orgs) {
        await enqueue(tx, { orgId: o.id, type: "retention.purge", payload: {}, dedupeKey: `purge:${o.id}:${day}` });
      }
    });
  }
  // Expire trials: plans fall back automatically in effectivePlan(); mark the status for the UI.
  await systemDb().execute(sql`update organizations set subscription_status = 'trial_ended'
    where subscription_status = 'trialing' and trial_ends_at < now()`);
}
