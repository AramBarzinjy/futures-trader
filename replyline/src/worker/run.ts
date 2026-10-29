import { closeDb } from "@/lib/db";
import { runDueJobs, tick } from "./process";

/*
 * Long-running background worker: `npm run worker`.
 * Deploy it as a separate always-on process next to the web app (see docs/DEPLOYMENT.md).
 * Several copies can run safely; jobs are claimed with SKIP LOCKED.
 */

const POLL_MS = 5_000;
const TICK_MS = 60_000;
let stopping = false;
let lastTick = 0;

async function loop() {
  console.log("[worker] started");
  while (!stopping) {
    try {
      if (Date.now() - lastTick >= TICK_MS) {
        lastTick = Date.now();
        await tick();
      }
      const r = await runDueJobs(200);
      if (r.processed) console.log(`[worker] processed ${r.processed} job(s), ${r.failed} failed, ${r.dead} moved to failed list`);
    } catch (e) {
      console.error("[worker] loop error:", e instanceof Error ? e.message : e);
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  await closeDb();
  console.log("[worker] stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
  });
}

loop();
