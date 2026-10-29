import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getWorkflow, recentEnquiriesForTest } from "@/modules/automation/workflows";
import { getOrganization } from "@/modules/orgs/service";
import { effectivePlan } from "@/modules/billing/entitlements";
import { can } from "@/modules/auth/permissions";
import { WORKFLOW_SEEDS } from "@/config/industries";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Checkbox, Notice, Table, Td, Th } from "@/components/ui";
import { formatInZone } from "@/lib/time";
import { stopRunAction, updateWorkflowAction } from "../../actions";
import { DryRun } from "./dry-run";

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireApp();
  let data;
  try {
    data = await getWorkflow(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { workflow: w, runs, templates, statuses } = data;
  const org = await getOrganization(actor);
  const plan = effectivePlan(org);
  const seed = WORKFLOW_SEEDS.find((s) => s.templateKey === w.templateKey);
  const locked = seed?.requiresFeature ? !plan.features[seed.requiresFeature] : false;
  const customRules = plan.features.customWorkflowRules;
  const canAuthorise = can(actor.role, "workflow.authorise_autosend");
  const testEnquiries = await recentEnquiriesForTest(actor);
  const tz = org.timezone;

  return (
    <>
      <Link href="/app/workflows" className="text-sm text-ink-500 hover:text-ink-800">← Workflows</Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{w.name}</h1>
      <p className="mt-1 max-w-2xl text-ink-600">{w.purpose}</p>
      {locked && <div className="mt-4"><Notice tone="warn" title="Not included in your plan">Multi-step follow-up sequences are part of Growth and Pro. <Link className="underline" href="/app/billing">Upgrade</Link> to turn this on.</Notice></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Settings" />
            <ActionForm action={updateWorkflowAction} className="space-y-6 p-5">
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="stepCount" value={customRules ? w.steps.length : 0} />
              <div className="space-y-3">
                <Checkbox id="enabled" name="enabled" defaultChecked={w.enabled} disabled={locked} label="Workflow is on" />
                {w.trigger !== "weekly_schedule" && (
                  <Checkbox
                    id="autoSend"
                    name="autoSend"
                    defaultChecked={!w.requireApproval}
                    disabled={!canAuthorise && w.requireApproval}
                    label="Send automatically, without approval"
                    description={canAuthorise ? "Messages with any missing detail are still held for you. Marketing templates can never be sent automatically." : "Only the workspace owner can turn this on."}
                  />
                )}
                {w.steps.length > 0 && <Checkbox id="businessHoursOnly" name="businessHoursOnly" defaultChecked={w.businessHoursOnly} label="Only send during business hours" />}
                {w.steps.length === 0 && <input type="hidden" name="businessHoursOnly" value={w.businessHoursOnly ? "on" : ""} />}
              </div>

              {w.steps.length > 0 && (
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink-900">Steps</legend>
                  {!customRules && <p className="mb-2 text-xs text-ink-500">Editing steps and rules is available on Growth and Pro.</p>}
                  <ol className="space-y-3">
                    {w.steps.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 p-3 text-sm">
                        <span className="font-medium">Step {i + 1}:</span>
                        <span>wait</span>
                        <input aria-label={`Step ${i + 1} delay`} name={`step${i}_amount`} type="number" min={0} max={365} defaultValue={s.delay.amount} disabled={!customRules} className="h-8 w-16 rounded border-ink-300 text-sm" />
                        <select aria-label={`Step ${i + 1} unit`} name={`step${i}_unit`} defaultValue={s.delay.unit} disabled={!customRules} className="h-8 rounded border-ink-300 text-sm">
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                          <option value="business_days">business days</option>
                        </select>
                        <span>then</span>
                        <input type="hidden" name={`step${i}_action`} value={s.action} />
                        {s.action === "email" ? (
                          <select aria-label={`Step ${i + 1} template`} name={`step${i}_template`} defaultValue={s.templateKey} disabled={!customRules} className="h-8 rounded border-ink-300 text-sm">
                            {templates.map((t) => <option key={t.key} value={t.key}>send “{t.name}”</option>)}
                          </select>
                        ) : (
                          <span>mark urgent and flag for the team</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </fieldset>
              )}

              {w.trigger === "enquiry_created" && customRules && (
                <fieldset className="space-y-2">
                  <input type="hidden" name="hasRules" value="1" />
                  <legend className="mb-2 text-sm font-semibold text-ink-900">Stop when…</legend>
                  <Checkbox id="stopReply" name="stopReply" defaultChecked={w.stopRules.onCustomerReply} label="the customer replies" />
                  <Checkbox id="stopTeamReply" name="stopTeamReply" defaultChecked={w.stopRules.onBusinessReply} label="someone on the team replies" />
                  <Checkbox id="stopBooked" name="stopBooked" defaultChecked={w.stopRules.onAppointmentBooked} label="an appointment is booked" />
                  <div className="pt-1 text-sm text-ink-700">…or the status becomes:</div>
                  <div className="flex flex-wrap gap-3">
                    {statuses.map((s) => <Checkbox key={s.key} id={`ss-${s.key}`} name="stopStatus" value={s.key} defaultChecked={w.stopRules.onStatusKeys.includes(s.key)} label={s.label} />)}
                  </div>
                  <p className="text-xs text-ink-500">Opt-outs and closed enquiries always stop a workflow.</p>
                  <div className="pt-3 text-sm font-semibold text-ink-900">Only for enquiries from <span className="font-normal text-ink-500">(none ticked = all sources)</span></div>
                  <div className="flex flex-wrap gap-3">
                    {[...new Set([...org.settings.enquirySources, "Website form", "Email"])].map((src) => (
                      <Checkbox key={src} id={`cs-${src}`} name="condSource" value={src} defaultChecked={w.conditions.sources?.includes(src)} label={src} />
                    ))}
                  </div>
                </fieldset>
              )}
              <SubmitButton>Save workflow</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Execution history" description="Last 50 runs" />
            {runs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">No runs yet.</p>
            ) : (
              <Table>
                <thead className="bg-ink-50"><tr><Th>Enquiry</Th><Th>Status</Th><Th>Started</Th><Th /></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <Td>{r.enquiryId ? <Link className="text-brand-700" href={`/app/enquiries/${r.enquiryId}`}>{r.subject ?? "Enquiry"}</Link> : "—"}</Td>
                      <Td><Badge tone={r.status === "running" ? "blue" : r.status === "completed" ? "green" : r.status === "failed" ? "red" : "slate"}>{r.status}</Badge>{r.stopReason && <div className="text-xs text-ink-500">{r.stopReason}</div>}</Td>
                      <Td className="whitespace-nowrap">{formatInZone(r.startedAt, tz, "short")}</Td>
                      <Td>
                        {r.status === "running" && (
                          <ActionForm action={stopRunAction} showSuccess={false}>
                            <input type="hidden" name="runId" value={r.id} />
                            <input type="hidden" name="id" value={w.id} />
                            <SubmitButton size="sm" variant="ghost">Stop</SubmitButton>
                          </ActionForm>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        {w.steps.length > 0 && (
          <div>
            <Card>
              <CardHeader title="Test (dry run)" description="See exactly what would happen for a real enquiry. Nothing is sent or saved." />
              <div className="p-5"><DryRun workflowId={w.id} enquiries={testEnquiries} tz={tz} /></div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
