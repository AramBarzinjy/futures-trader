import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { hostname } from "node:os";
import { schema, systemDb, withTenant, type TenantTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor } from "@/modules/auth/permissions";
import { audit } from "@/modules/audit/service";

/*
 * Durable job queue in Postgres. Delayed tasks survive restarts and never
 * depend on a browser being open. Claiming uses FOR UPDATE SKIP LOCKED so
 * several workers can run without taking the same job.
 *
 * Delivery is at-least-once; every handler is written to be idempotent.
 */

export type JobType = "workflow.step" | "email.send" | "appointment.message" | "report.weekly" | "retention.purge";
export type Job = typeof schema.jobs.$inferSelect;

export interface EnqueueInput {
  orgId: string;
  type: JobType;
  payload: Record<string, unknown>;
  runAt?: Date;
  /** Same key twice → second enqueue is ignored. */
  dedupeKey?: string;
  maxAttempts?: number;
}

export async function enqueue(tx: TenantTx, job: EnqueueInput) {
  await tx
    .insert(schema.jobs)
    .values({
      orgId: job.orgId,
      type: job.type,
      payload: job.payload,
      runAt: job.runAt ?? new Date(),
      dedupeKey: job.dedupeKey,
      maxAttempts: job.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: schema.jobs.dedupeKey });
}

export const WORKER_ID = `${hostname()}:${process.pid}`;
export const STALE_LOCK_MINUTES = 10;

/** Claim up to `limit` due jobs. Owner role: this is the one place the worker crosses tenants. */
export async function claimDueJobs(limit = 10, workerId = WORKER_ID): Promise<Job[]> {
  const res = await systemDb().execute(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs where status = 'queued' and run_at <= now()
      order by run_at for update skip locked limit ${limit}
    )
    returning id`);
  const ids = res.rows.map((r) => (r as { id: string }).id);
  if (!ids.length) return [];
  return systemDb().select().from(schema.jobs).where(inArray(schema.jobs.id, ids));
}

/** A worker that died mid-job leaves it "running". Put such jobs back in the queue. */
export async function recoverStaleJobs() {
  await systemDb().execute(sql`
    update jobs set status = 'queued', locked_at = null, locked_by = null, updated_at = now(),
      last_error = coalesce(last_error, '') || ' [recovered after worker stopped]'
    where status = 'running' and locked_at < now() - (${STALE_LOCK_MINUTES} || ' minutes')::interval`);
}

export async function completeJob(id: string) {
  await systemDb().update(schema.jobs).set({ status: "succeeded", lockedAt: null, updatedAt: new Date() }).where(eq(schema.jobs.id, id));
}

/** Exponential backoff: 30s, 1m, 2m, 4m … capped at 1h, with jitter. */
export function backoffMs(attempts: number) {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
  return base + Math.floor(Math.random() * 5_000);
}

export async function failJob(job: Job, error: unknown, opts: { permanent?: boolean } = {}) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const dead = opts.permanent || job.attempts >= job.maxAttempts;
  await systemDb()
    .update(schema.jobs)
    .set({
      status: dead ? "dead" : "queued",
      runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: message,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));
  return dead;
}

// ------------------------------------------------------------ tenant-facing

export async function listJobs(actor: Actor, status?: "dead" | "queued" | "running" | "succeeded", limit = 50) {
  assertCan(actor, "workflow.write");
  return withTenant(actor, (tx) =>
    tx
      .select()
      .from(schema.jobs)
      .where(status ? eq(schema.jobs.status, status) : undefined)
      .orderBy(desc(schema.jobs.updatedAt))
      .limit(limit),
  );
}

export async function jobHealth(actor: Actor) {
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({ status: schema.jobs.status, n: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(sql`${schema.jobs.updatedAt} > now() - interval '7 days' or ${schema.jobs.status} in ('dead','queued')`)
      .groupBy(schema.jobs.status);
    const out = { queued: 0, running: 0, succeeded: 0, dead: 0 };
    for (const r of rows) out[r.status as keyof typeof out] = r.n;
    return out;
  });
}

/** Put a dead job back in the queue. The handler's idempotency makes this safe. */
export async function retryJob(actor: Actor, jobId: string) {
  assertCan(actor, "jobs.retry");
  await withTenant(actor, async (tx) => {
    const [row] = await tx
      .update(schema.jobs)
      .set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "dead")))
      .returning({ id: schema.jobs.id, type: schema.jobs.type });
    if (!row) throw new AppError("That job isn't in the failed list.", "not_found");
    if (row.type === "email.send") {
      // Re-arm a failed email. "uncertain" ones are left alone: they may already have been delivered.
      const job = await tx.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
      const messageId = String((job?.payload as { messageId?: string })?.messageId ?? "");
      if (messageId) {
        await tx.update(schema.messages).set({ status: "queued", error: null }).where(and(eq(schema.messages.id, messageId), eq(schema.messages.status, "failed")));
      }
    }
    await audit(tx, actor, "job.retried", { type: "job", id: jobId }, { jobType: row.type });
  });
}
