import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { CalendarPlus } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getAppointment } from "@/modules/appointments/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, ButtonLink, Card, CardHeader, Checkbox, Field, Input } from "@/components/ui";
import { MessageStatusBadge } from "@/components/status";
import { formatInZone, reminderTime } from "@/lib/time";
import { appointmentStatusAction, rescheduleAction } from "../../actions";

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  let data;
  try {
    data = await getAppointment(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { appt, contact, messages } = data;
  const tz = appt.timezone;
  const local = DateTime.fromJSDate(appt.startsAt, { zone: tz });
  const scheduled = appt.status === "scheduled";

  return (
    <>
      <Link href="/app/appointments" className="text-sm text-ink-500 hover:text-ink-800">← Appointments</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{appt.title}</h1>
        <Badge tone={scheduled ? "teal" : appt.status === "cancelled" ? "red" : "slate"}>{appt.status.replace("_", "-")}</Badge>
      </div>
      <p className="mt-1 text-ink-600">{formatInZone(appt.startsAt, tz)} ({tz}) · {appt.durationMinutes} minutes · with <Link className="text-brand-700" href={`/app/contacts/${contact.id}`}>{contact.name}</Link></p>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" action={<ButtonLink size="sm" variant="secondary" href={`/api/appointments/${appt.id}/ics`} prefetch={false}><CalendarPlus size={14} aria-hidden /> Add to calendar</ButtonLink>} />
            <dl className="grid gap-3 p-5 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-500">Location</dt><dd>{appt.location ?? "—"}</dd></div>
              <div><dt className="text-ink-500">Video link</dt><dd>{appt.meetingLink ? <a className="text-brand-700" href={appt.meetingLink}>{appt.meetingLink}</a> : "—"}</dd></div>
              <div><dt className="text-ink-500">Reminders</dt><dd>{appt.reminderOffsetsMinutes.map((m) => formatInZone(reminderTime(appt.startsAt, m, tz), tz, "short")).join(", ") || "None"}</dd></div>
              {appt.enquiryId && <div><dt className="text-ink-500">Enquiry</dt><dd><Link className="text-brand-700" href={`/app/enquiries/${appt.enquiryId}`}>Open enquiry</Link></dd></div>}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Messages for this appointment" />
            {messages.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">None yet. Reminders appear here when they fall due.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {messages.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>{m.subject}</span>
                    <span className="flex items-center gap-2"><MessageStatusBadge status={m.status} /><span className="text-xs text-ink-400">{formatInZone(m.sentAt ?? m.createdAt, tz, "short")}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {scheduled && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Reschedule" description="Reminders for the old time are cancelled automatically." />
              <ActionForm action={rescheduleAction} className="space-y-3 p-5">
                <input type="hidden" name="id" value={appt.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field id="date" label="Date"><Input id="date" name="date" type="date" defaultValue={local.toISODate() ?? ""} required /></Field>
                  <Field id="time" label="Time"><Input id="time" name="time" type="time" defaultValue={local.toFormat("HH:mm")} required /></Field>
                </div>
                <Checkbox id="notifyR" name="notifyCustomer" defaultChecked label="Tell the customer" />
                <SubmitButton size="sm">Reschedule</SubmitButton>
              </ActionForm>
            </Card>
            <Card>
              <CardHeader title="Update status" />
              <div className="space-y-3 p-5">
                <ActionForm action={appointmentStatusAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={appt.id} />
                  <SubmitButton size="sm" variant="secondary" name="status" value="completed">Mark completed</SubmitButton>
                  <SubmitButton size="sm" variant="secondary" name="status" value="no_show">No-show</SubmitButton>
                </ActionForm>
                <ActionForm action={appointmentStatusAction} className="space-y-2 border-t border-ink-100 pt-3">
                  <input type="hidden" name="id" value={appt.id} />
                  <input type="hidden" name="status" value="cancelled" />
                  <Checkbox id="notifyC" name="notifyCustomer" defaultChecked label="Send the customer a cancellation email" />
                  <SubmitButton size="sm" variant="danger" confirm="Cancel this appointment?">Cancel appointment</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
