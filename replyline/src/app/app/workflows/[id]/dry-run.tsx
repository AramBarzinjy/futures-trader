"use client";

import { useActionState } from "react";
import { testWorkflowAction } from "../../actions";
import { Button, Notice } from "@/components/ui";

interface Step {
  index: number;
  dueAt: string;
  action: string;
  subject?: string;
  body?: string;
  missing?: string[];
  outcome: string;
}

export function DryRun({ workflowId, enquiries, tz }: { workflowId: string; enquiries: { id: string; subject: string }[]; tz: string }) {
  const [state, action, pending] = useActionState(testWorkflowAction, {});
  const result = state.data?.result as { steps: Step[]; stoppedBecause: string | null } | undefined;
  if (!enquiries.length) return <p className="text-sm text-ink-500">Add an enquiry to test against.</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={workflowId} />
      <label htmlFor="dry-enq" className="block text-sm font-medium">Enquiry</label>
      <select id="dry-enq" name="enquiryId" className="h-9 w-full rounded-lg border-0 text-sm ring-1 ring-ink-300">
        {enquiries.map((e) => <option key={e.id} value={e.id}>{e.subject}</option>)}
      </select>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Simulating…" : "Run dry run"}</Button>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {result && (
        <div className="space-y-3 pt-2">
          {result.stoppedBecause && <Notice tone="warn">For this enquiry right now, the workflow would stop: {result.stoppedBecause}.</Notice>}
          <ol className="space-y-3">
            {result.steps.map((s) => (
              <li key={s.index} className="rounded-lg bg-ink-50 p-3 text-sm">
                <div className="font-medium">Step {s.index + 1} · {new Date(s.dueAt).toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}</div>
                <div className="text-ink-600">{s.outcome}</div>
                {s.subject && <div className="mt-2 font-medium">{s.subject}</div>}
                {s.body && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs text-ink-600">{s.body}</pre>}
                {s.missing && s.missing.length > 0 && <div className="mt-1 text-xs text-amber-700">Missing: {s.missing.join(", ")}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </form>
  );
}
