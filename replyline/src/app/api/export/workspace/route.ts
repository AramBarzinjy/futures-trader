import { requireApp } from "@/lib/auth/session";
import { exportOrganization } from "@/modules/compliance/data";
import { AppError } from "@/lib/errors";

export async function GET() {
  const { actor } = await requireApp();
  try {
    const data = await exportOrganization(actor);
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="workspace-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
