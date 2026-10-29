"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Lightbulb, ListChecks, Send, Sparkles, Wand2 } from "lucide-react";
import { aiAction, composeAction, templateIntoComposerAction } from "../../actions";
import type { ActionState } from "@/lib/actions";
import { Button, Notice } from "@/components/ui";

interface Template {
  key: string;
  name: string;
  subject: string;
  body: string;
  kind: string;
}

type Draft = { subject: string; body: string; needsConfirmation: string[]; flags: string[] };

/**
 * Reply composer. AI and templates only ever fill the text boxes — sending is
 * always a separate, explicit click, and the server re-checks consent,
 * suppression and placeholders before anything is queued.
 */
export function Composer({ enquiryId, templates, canSend, blockedReason, aiExternal }: { enquiryId: string; templates: Template[]; canSend: boolean; blockedReason: string | null; aiExternal: boolean }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("transactional");
  const [templateKey, setTemplateKey] = useState("");
  const [aiGenerated, setAiGenerated] = useState(false);
  const [flags, setFlags] = useState<string[]>([]);
  const [confirmations, setConfirmations] = useState<string[]>([]);
  const [insight, setInsight] = useState<React.ReactNode>(null);
  const [status, setStatus] = useState<ActionState>({});
  const [pending, start] = useTransition();

  const fd = (extra: Record<string, string>) => {
    const f = new FormData();
    f.set("id", enquiryId);
    f.set("subject", subject);
    f.set("body", body);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  const applyDraft = (d: Draft, labels?: string[]) => {
    setSubject(d.subject);
    setBody(d.body);
    setFlags(labels ?? []);
    setConfirmations(d.needsConfirmation ?? []);
  };

  const runAi = (op: string) =>
    start(async () => {
      setStatus({});
      const r = await aiAction({}, fd({ op }));
      if (r.error) return setStatus(r);
      const data = r.data ?? {};
      if (data.draft) {
        applyDraft(data.draft as Draft, data.flagLabels as string[]);
        setAiGenerated(true);
        setTemplateKey("");
      }
      if (data.questions) setInsight(<><strong>Questions to ask:</strong><ul className="mt-1 list-disc pl-5">{(data.questions as string[]).map((q) => <li key={q}>{q}</li>)}</ul></>);
      if (data.summary) {
        const s = data.summary as { summary: string; keyPoints: string[] };
        setInsight(<><strong>Summary:</strong> {s.summary}{s.keyPoints.length > 0 && <ul className="mt-1 list-disc pl-5">{s.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul>}</>);
      }
      if (data.next) {
        const n = data.next as { action: string; reason: string };
        setInsight(<><strong>Suggested next step:</strong> {n.action.replace(/_/g, " ")} — {n.reason}</>);
      }
    });

  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    start(async () => {
      const r = await templateIntoComposerAction({}, fd({ subject: t.subject, body: t.body, templateKey: t.key, kind: t.kind }));
      if (r.error) return setStatus(r);
      applyDraft(r.data!.draft as Draft);
      setTemplateKey(t.key);
      setKind(t.kind);
      setAiGenerated(false);
    });
  };

  const submit = (intent: "send" | "draft") =>
    start(async () => {
      const r = await composeAction({}, fd({ intent, kind, templateKey, aiGenerated: String(aiGenerated) }));
      setStatus(r);
      if (r.ok) {
        setSubject("");
        setBody("");
        setFlags([]);
        setConfirmations([]);
        setAiGenerated(false);
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="tpl" className="sr-only">Start from a template</label>
        <select id="tpl" value="" onChange={(e) => applyTemplate(e.target.value)} className="h-9 rounded-lg border-0 text-sm ring-1 ring-ink-300" disabled={pending}>
          <option value="">Start from a template…</option>
          {templates.map((t) => <option key={t.key} value={t.key}>{t.name}{t.kind === "marketing" ? " (marketing)" : ""}</option>)}
        </select>
        <Button type="button" variant="secondary" size="sm" onClick={() => runAi("draft")} disabled={pending}><Sparkles size={16} aria-hidden /> Draft with AI</Button>
        <label htmlFor="tone" className="sr-only">Rewrite</label>
        <select id="tone" value="" onChange={(e) => e.target.value && runAi(e.target.value)} className="h-9 rounded-lg border-0 text-sm ring-1 ring-ink-300" disabled={pending || !body}>
          <option value="">Rewrite…</option>
          <option value="friendly">More friendly</option>
          <option value="professional">More professional</option>
          <option value="warm">Warmer</option>
          <option value="concise">More concise</option>
          <option value="shorter">Shorter</option>
          <option value="more_detailed">More detailed</option>
        </select>
        <Button type="button" variant="ghost" size="sm" onClick={() => runAi("questions")} disabled={pending}><ListChecks size={16} aria-hidden /> Questions</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => runAi("summary")} disabled={pending}><Wand2 size={16} aria-hidden /> Summarise</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => runAi("next")} disabled={pending}><Lightbulb size={16} aria-hidden /> Next step</Button>
      </div>
      {aiExternal && <p className="text-xs text-ink-400">AI buttons send this enquiry&apos;s text to the AI provider configured for your workspace.</p>}

      {insight && <div className="rounded-lg bg-violet-50 p-3 text-sm text-violet-900 ring-1 ring-violet-200">{insight} <span className="mt-1 block text-xs text-violet-700">AI suggestion — check before acting on it.</span></div>}

      <div>
        <label htmlFor="c-subject" className="sr-only">Subject</label>
        <input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="block h-10 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600" />
      </div>
      <div>
        <label htmlFor="c-body" className="sr-only">Message</label>
        <textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} placeholder="Write your reply, or start from a template or AI draft." className="block w-full rounded-lg border-0 px-3 py-2 text-sm leading-6 ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600" />
      </div>

      {(flags.length > 0 || confirmations.length > 0) && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} aria-hidden /> Check before sending</div>
          <ul className="mt-1 list-disc pl-5">
            {flags.map((f) => <li key={f}>{f}</li>)}
            {confirmations.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={kind === "marketing"} onChange={(e) => setKind(e.target.checked ? "marketing" : "transactional")} className="rounded border-ink-300" />
          This is marketing (adds unsubscribe link; needs consent)
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" onClick={() => submit("draft")} disabled={pending || !subject || !body}>Save draft</Button>
          <Button type="button" onClick={() => submit("send")} disabled={pending || !subject || !body || !canSend} title={blockedReason ?? undefined}>
            <Send size={16} aria-hidden /> {pending ? "Working…" : "Send"}
          </Button>
        </div>
      </div>
      {blockedReason && <Notice tone="warn">{blockedReason}</Notice>}
      {status.error && <Notice tone="error">{status.error}</Notice>}
      {status.ok && status.message && <Notice tone="success">{status.message}</Notice>}
    </div>
  );
}
