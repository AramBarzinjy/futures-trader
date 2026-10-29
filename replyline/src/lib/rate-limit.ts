import { sql } from "drizzle-orm";
import { systemDb } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limit stored in Postgres, so it holds across multiple
 * server instances. Throws a rate_limited AppError when the window is full.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const result = await systemDb().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  if (Number(result.rows[0]?.count ?? 0) > limit) {
    throw new AppError("Too many attempts. Please wait a few minutes and try again.", "rate_limited");
  }
}

/** Housekeeping: drop expired windows. Called by the worker. */
export async function pruneRateLimits() {
  await systemDb().execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
}
