import { requireApp } from "@/lib/auth/session";
import { getAppointment, toIcs } from "@/modules/appointments/service";
import { getOrganization } from "@/modules/orgs/service";
import { AppError } from "@/lib/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  try {
    const { appt, contact } = await getAppointment(actor, id);
    const org = await getOrganization(actor);
    return new Response(toIcs(appt, { orgName: org.name, contactName: contact.name }), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="appointment.ics"` } });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
