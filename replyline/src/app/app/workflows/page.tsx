import Link from "next/link";
import { Lock, Zap } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { listWorkflows } from "@/modules/automation/workflows";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Workflows" };

const TRIGGER: Record<string, string> = {
  enquiry_created: "When an enquiry arrives",
  appointment_scheduled: "When an appointment is booked",
  weekly_schedule: "Every week",
};

export default async function WorkflowsPage() {
  const { actor } = await requireApp();
  const wfs = await listWorkflows(actor);
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Automations built from ready-made templates. Each one shows exactly when it runs, what it sends and what stops it."
        actions={<ButtonLink href="/app/workflows/health" variant="secondary">Automation health</ButtonLink>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {wfs.map((w) => (
          <Link key={w.id} href={`/app/workflows/${w.id}`} className="group">
            <Card className="h-full p-5 transition group-hover:ring-brand-500">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Zap size={18} className={w.enabled ? "text-brand-600" : "text-ink-300"} aria-hidden />
                  <h2 className="font-semibold text-ink-900">{w.name}</h2>
                </div>
                {w.locked ? <Badge tone="amber"><Lock size={12} aria-hidden /> Upgrade</Badge> : <Badge tone={w.enabled ? "green" : "slate"}>{w.enabled ? "On" : "Off"}</Badge>}
              </div>
              <p className="mt-2 text-sm text-ink-600">{w.purpose}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Badge>{TRIGGER[w.trigger] ?? w.trigger}</Badge>
                {w.trigger !== "weekly_schedule" && <Badge tone={w.requireApproval ? "blue" : "violet"}>{w.requireApproval ? "Needs approval" : "Sends automatically"}</Badge>}
                {w.steps.length > 0 && <Badge>{w.steps.length} step{w.steps.length === 1 ? "" : "s"}</Badge>}
                {(w.counts.running ?? 0) > 0 && <Badge tone="blue">{w.counts.running} running</Badge>}
                {(w.counts.failed ?? 0) > 0 && <Badge tone="red">{w.counts.failed} failed</Badge>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
