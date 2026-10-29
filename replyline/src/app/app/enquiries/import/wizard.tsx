"use client";

import { useActionState } from "react";
import Link from "next/link";
import { previewImportAction, runImportAction } from "../../actions";
import { Button, Card, CardHeader, Notice, Table, Td, Th } from "@/components/ui";
import type { ImportPreview } from "@/modules/enquiries/service";

const FIELDS = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["company", "Company"],
  ["subject", "Subject"],
  ["message", "Message"],
  ["source", "Source"],
  ["category", "Category"],
  ["priority", "Priority"],
] as const;

export function ImportWizard() {
  const [preview, previewAction, previewing] = useActionState(previewImportAction, {});
  const [result, importAction, importing] = useActionState(runImportAction, {});
  const p = preview.data?.preview as ImportPreview | undefined;
  const csv = preview.data?.csv as string | undefined;

  if (result.ok) {
    const errors = (result.data?.errors as { row: number; message: string }[]) ?? [];
    return (
      <div className="space-y-4">
        <Notice tone="success" title="Import complete">{result.message}</Notice>
        {errors.length > 0 && (
          <Card><CardHeader title="Skipped rows" /><ul className="px-5 py-3 text-sm">{errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul></Card>
        )}
        <Link href="/app/enquiries?view=all" className="text-sm font-medium text-brand-700">View enquiries →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form action={previewAction} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="file" className="mb-1.5 block text-sm font-medium">CSV file</label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
          </div>
          <Button type="submit" variant="secondary" disabled={previewing}>{previewing ? "Reading…" : "Preview"}</Button>
        </form>
        {preview.error && <div className="mt-3"><Notice tone="error">{preview.error}</Notice></div>}
      </Card>

      {p && csv && (
        <form action={importAction} className="space-y-6">
          <input type="hidden" name="csv" value={csv} />
          <Card>
            <CardHeader title="Match your columns" description={`${p.valid} rows ready · ${p.errors.length} with problems`} />
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              {FIELDS.map(([k, label]) => (
                <div key={k}>
                  <label htmlFor={`map_${k}`} className="mb-1 block text-sm font-medium">{label}</label>
                  <select id={`map_${k}`} name={`map_${k}`} defaultValue={p.mapping[k] ?? ""} className="h-9 w-full rounded-lg border-0 text-sm ring-1 ring-ink-300">
                    <option value="">— not imported —</option>
                    {p.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="First rows" />
            <Table>
              <thead className="bg-ink-50"><tr>{p.headers.map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.sample.map((r, i) => <tr key={i}>{p.headers.map((h) => <Td key={h}>{r[h]}</Td>)}</tr>)}
              </tbody>
            </Table>
          </Card>
          {p.errors.length > 0 && (
            <Notice tone="warn" title="These rows will be skipped">
              <ul className="list-disc pl-5">{p.errors.slice(0, 10).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
            </Notice>
          )}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="runAutomation" className="mt-0.5 rounded border-ink-300" />
            <span><strong>Start workflows for imported enquiries.</strong> Leave unticked for old leads — otherwise each one may get an acknowledgement and follow-ups.</span>
          </label>
          {result.error && <Notice tone="error">{result.error}</Notice>}
          <Button type="submit" disabled={importing || p.valid === 0}>{importing ? "Importing…" : `Import ${p.valid} enquiries`}</Button>
        </form>
      )}
    </div>
  );
}
