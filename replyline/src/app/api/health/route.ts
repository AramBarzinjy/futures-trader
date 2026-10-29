import { sql } from "drizzle-orm";
import { systemDb } from "@/lib/db";

/** Liveness + database check for uptime monitoring. Reveals nothing else. */
export async function GET() {
  try {
    await systemDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
