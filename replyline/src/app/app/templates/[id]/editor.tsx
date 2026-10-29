"use client";

import { useActionState, useRef, useState } from "react";
import { deleteTemplateAction, previewTemplateAction, resetTemplateAction, saveTemplateAction } from "../../actions";
import { Button, Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";

interface T {
  id: string;
  name: string;
  purpose: string;
  kind: string;
  subject: string;
  body: string;
  builtIn: boolean;
}

export function TemplateEditor({ template, variables, enquiries, canEdit }: { template: T | null; variables: string[]; enquiries: { id: string; subject: string }[]; canEdit: boolean }) {
  const [saved, save, saving] = useActionState(saveTemplateAction, {});
  const [preview, runPreview, previewing] = useActionState(previewTemplateAction, {});
  const [reset, runReset] = useActionState(resetTemplateAction, {});
  const [del, runDelete] = useActionState(deleteTemplateAction, {});
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const p = preview.data?.preview as { subject: string; body: string; missing: string[]; errors: string[] } | undefined;

  const insert = (v: string) => {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setBody(body + token);
    const start = el.selectionStart ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(el.selectionEnd ?? start));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Edit" />
        <form action={save} className="space-y-4 p-5">
          <input type="hidden" name="id" value={template?.id ?? ""} />
          <Field id="name" label="Name"><Input id="name" name="name" defaultValue={template?.name} required disabled={!canEdit} /></Field>
          <Field id="purpose" label="When it's used"><Input id="purpose" name="purpose" defaultValue={template?.purpose} disabled={!canEdit} /></Field>
          <Field id="kind" label="Type">
            <Select id="kind" name="kind" defaultValue={template?.kind ?? "transactional"} disabled={!canEdit}>
              <option value="transactional">About the customer&apos;s own enquiry or appointment</option>
              <option value="marketing">Marketing (needs consent, adds unsubscribe link)</option>
            </Select>
          </Field>
          <Field id="subject" label="Subject"><Input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required disabled={!canEdit} /></Field>
          <Field id="body" label="Message"><Textarea ref={bodyRef} id="body" name="body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} required disabled={!canEdit} className="font-mono text-[13px]" /></Field>
          {canEdit && (
            <div>
              <div className="mb-1 text-xs font-medium text-ink-600">Insert a variable</div>
              <div className="flex flex-wrap gap-1">
                {variables.map((v) => <button type="button" key={v} onClick={() => insert(v)} className="rounded bg-ink-100 px-2 py-0.5 font-mono text-xs text-ink-700 hover:bg-brand-100">{v}</button>)}
              </div>
            </div>
          )}
          {saved.error && <Notice tone="error">{saved.error}</Notice>}
          {saved.ok && <Notice tone="success">{saved.message}</Notice>}
          {canEdit && <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>}
        </form>
        {canEdit && template && (
          <div className="flex gap-2 border-t border-ink-100 px-5 py-3">
            {template.builtIn ? (
              <form action={runReset}><Button variant="ghost" size="sm" type="submit" onClick={(e) => { if (!confirm("Reset to the default wording?")) e.preventDefault(); }}>Reset to default</Button><input type="hidden" name="id" value={template.id} /></form>
            ) : (
              <form action={runDelete}><Button variant="ghost" size="sm" type="submit" onClick={(e) => { if (!confirm("Delete this template?")) e.preventDefault(); }}>Delete</Button><input type="hidden" name="id" value={template.id} /></form>
            )}
            {(reset.message || reset.error || del.error) && <span className="text-sm text-ink-600">{reset.message ?? reset.error ?? del.error}</span>}
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Preview" description="With sample data, or a real enquiry's details." />
        <form action={runPreview} className="flex gap-2 p-5 pb-0">
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="body" value={body} />
          <label htmlFor="pv-enq" className="sr-only">Preview with</label>
          <select id="pv-enq" name="enquiryId" className="h-9 flex-1 rounded-lg border-0 text-sm ring-1 ring-ink-300">
            <option value="">Sample customer</option>
            {enquiries.map((e) => <option key={e.id} value={e.id}>{e.subject}</option>)}
          </select>
          <Button type="submit" variant="secondary" size="sm" disabled={previewing}>Preview</Button>
        </form>
        <div className="p-5">
          {p ? (
            <div className="space-y-3">
              {p.errors.length > 0 && <Notice tone="error">{p.errors.join(" ")}</Notice>}
              {p.missing.length > 0 && <Notice tone="warn">Missing for this customer: {p.missing.join(", ")}. A message like this would wait for approval.</Notice>}
              <div className="rounded-lg ring-1 ring-ink-200">
                <div className="border-b border-ink-100 px-4 py-2 text-sm font-medium">{p.subject}</div>
                <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm text-ink-700">{p.body}</pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-500">Click Preview to see the rendered email.</p>
          )}
          {preview.error && <Notice tone="error">{preview.error}</Notice>}
        </div>
      </Card>
    </div>
  );
}
