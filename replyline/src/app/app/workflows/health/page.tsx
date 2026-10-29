import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { jobHealth, listJobs } from "@/modules/automation/queue";
import { getOrganization } from "@/modules/orgs/service";
import { can } from "@/modules/auth/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { formatInZone } from "@/lib/time";
import { retryJobAction } from "../../actions";

export const metadata = { title: "Automation health" };

const LABEL: Record<string, string> = {
  "workflow.step": "Workflow step",
  "email.send": "Send email",
  "appointment.message": "Appointment email",
  "report.weekly": "Weekly report",
  "retention.purge": "Data retention clean-up",
};

export default async function HealthPage() {
  const { actor } = await requireApp();
  const [health, dead, queued, org] = [await jobHealth(actor), await listJobs(actor, "dead"), await listJobs(actor, "queued", 20), await getOrganization(actor)];
  const tz = org.timezone;
  return (
    <>
      <Link href="/app/workflows" className="text-sm text-ink-500 hover:text-ink-800">← Workflows</Link>
      <PageHeader title="Automation health" description="Background tasks run by the worker. Failed tasks are retried automatically with increasing delays; after 5 attempts they stop here for you to look at." />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Completed (7 days)" value={health.succeeded} />
        <Stat label="Scheduled" value={health.queued} />
        <Stat label="Running" value={health.running} />
        <Stat label="Failed" value={health.dead} tone={health.dead ? "bad" : undefined} />
      </div>
      <Card className="mb-6">
        <CardHeader title="Failed tasks" description="Retrying is safe: emails are never sent twice. An email marked “delivery uncertain” is not resent automatically." />
        {dead.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={20} />} title="No failures" description="Everything is running normally." />
        ) : (
          <Table>
            <thead className="bg-ink-50"><tr><Th>Task</Th><Th>Error</Th><Th>Attempts</Th><Th>Last tried</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {dead.map((j) => (
                <tr key={j.id}>
                  <Td>{LABEL[j.type] ?? j.type}</Td>
                  <Td className="max-w-sm text-red-700">{j.lastError}</Td>
                  <Td>{j.attempts}</Td>
                  <Td className="whitespace-nowrap">{formatInZone(j.updatedAt, tz, "short")}</Td>
                  <Td>
                    {can(actor.role, "jobs.retry") && (
                      <ActionForm action={retryJobAction}>
                        <input type="hidden" name="jobId" value={j.id} />
                        <SubmitButton size="sm" variant="secondary">Retry</SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Coming up" description="Next 20 scheduled tasks" />
        {queued.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">Nothing scheduled.</p>
        ) : (
          <Table>
            <thead className="bg-ink-50"><tr><Th>Task</Th><Th>Due</Th><Th>Attempts</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {[...queued].sort((a, b) => a.runAt.getTime() - b.runAt.getTime()).map((j) => (
                <tr key={j.id}><Td>{LABEL[j.type] ?? j.type}</Td><Td>{formatInZone(j.runAt, tz, "short")}</Td><Td>{j.attempts ? <Badge tone="amber">retry {j.attempts}</Badge> : "—"}</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
