"use client";

import { useActionState, useState } from "react";
import { bulkAction } from "../actions";
import { Notice } from "@/components/ui";

/**
 * Bulk actions for the selected rows. Checkboxes in the table point at this
 * form via form="bulk-form". Deleting asks for the count to be typed back.
 */
export function BulkBar({ statuses, members }: { statuses: { key: string; label: string }[]; members: { id: string; name: string }[] }) {
  const [state, action] = useActionState(bulkAction, {});
  const [op, setOp] = useState("status");
  return (
    <form id="bulk-form" action={action} className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-sm">
      <span className="text-ink-500">With selected:</span>
      <label className="sr-only" htmlFor="bulk-op">Action</label>
      <select id="bulk-op" name="op" value={op} onChange={(e) => setOp(e.target.value)} className="h-8 rounded-md border-ink-200 text-sm">
        <option value="status">Set status</option>
        <option value="priority">Set priority</option>
        <option value="assign">Assign</option>
        <option value="delete">Delete</option>
      </select>
      {op === "status" && (
        <select name="value" aria-label="Status" className="h-8 rounded-md border-ink-200 text-sm">
          {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      )}
      {op === "priority" && (
        <select name="value" aria-label="Priority" className="h-8 rounded-md border-ink-200 text-sm">
          {["urgent", "high", "normal", "low"].map((p) => <option key={p}>{p}</option>)}
        </select>
      )}
      {op === "assign" && (
        <select name="value" aria-label="Assignee" className="h-8 rounded-md border-ink-200 text-sm">
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}
      {op === "delete" && (
        <input name="confirmCount" inputMode="numeric" placeholder="Type how many to confirm" aria-label="Confirm count" className="h-8 w-48 rounded-md border-ink-200 text-sm" />
      )}
      <button className={`h-8 rounded-md px-3 font-medium text-white ${op === "delete" ? "bg-red-600" : "bg-ink-900"}`}>Apply</button>
      {state.error && <div className="w-full"><Notice tone="error">{state.error}</Notice></div>}
      {state.ok && state.message && <span className="text-emerald-700">{state.message}</span>}
    </form>
  );
}
