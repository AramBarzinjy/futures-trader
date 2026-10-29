import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { listReports } from "@/modules/reports/service";
import { getOrganization } from "@/modules/orgs/service";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatInZone } from "@/lib/time";
import { generateReportAction } from "../actions";

export const metadata = { title: "Reports" };
const DAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function ReportsPage() {
  const { actor } = await requireApp();
  const reports = await listReports(actor);
  const org = await getOrganization(actor);
  const r = org.settings.report;
  return (
    <>
      <PageHeader
        title="Weekly prospect reports"
        description={`Generated every ${DAY[r.weekday]} at ${String(r.hour).padStart(2, "0")}:00${r.emailEnabled && r.recipients.length ? ` and emailed to ${r.recipients.join(", ")}` : ""}. Change this in Settings.`}
        actions={<ActionForm action={generateReportAction}><SubmitButton variant="secondary" pendingText="Generating…">Generate now (last 7 days)</SubmitButton></ActionForm>}
      />
      <Card>
        {reports.length === 0 ? (
          <EmptyState icon={<BarChart3 size={20} />} title="No reports yet" description="Your first report arrives on the next scheduled day, or generate one now." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {reports.map((x) => (
              <li key={x.id}>
                <Link href={`/app/reports/${x.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-ink-50">
                  <span className="font-medium text-ink-900">{x.metrics.periodLabel}</span>
                  <span className="text-sm text-ink-500">{x.metrics.newEnquiries} new · generated {formatInZone(x.createdAt, org.timezone, "short")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
