import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runDueJobs, tick } from "@/worker/process";

/*
 * For hosts without an always-on worker: call this every minute from a
 * scheduler (e.g. Vercel Cron) with "Authorization: Bearer <CRON_SECRET>".
 * It runs the same code as `npm run worker`.
 */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  await tick();
  const r = await runDueJobs(200);
  return Response.json(r);
}
