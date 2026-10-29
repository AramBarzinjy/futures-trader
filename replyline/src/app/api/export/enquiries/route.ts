import { requireApp } from "@/lib/auth/session";
import { exportEnquiriesCsv } from "@/modules/enquiries/service";
import { AppError } from "@/lib/errors";

export async function GET() {
  const { actor } = await requireApp();
  try {
    const csv = await exportEnquiriesCsv(actor);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="enquiries-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
