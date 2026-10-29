import { requireApp } from "@/lib/auth/session";
import { exportContactData } from "@/modules/compliance/data";
import { AppError } from "@/lib/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  try {
    const data = await exportContactData(actor, id);
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="contact-${id}.json"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "not_found" ? 404 : 403 });
    throw e;
  }
}
