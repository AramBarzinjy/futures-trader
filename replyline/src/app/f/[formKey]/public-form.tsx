"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";

export function PublicForm({ formKey, orgName }: { formKey: string; orgName: string }) {
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch(`/api/public/enquiries/${formKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, marketingConsent: fd.get("marketingConsent") === "on", elapsedMs: Date.now() - opened.current }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && json.ok) setState("done");
    else {
      setState("idle");
      setError(json.error ?? "Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return <div className="mt-6"><Notice tone="success" title="Thanks — your enquiry has been sent">{orgName} will be in touch soon.</Notice></div>;
  }
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <Field id="name" label="Your name"><Input id="name" name="name" required autoComplete="name" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="email" label="Email"><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
        <Field id="phone" label="Phone" hint="(optional)"><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
      </div>
      <Field id="subject" label="What's it about?" hint="(optional)"><Input id="subject" name="subject" /></Field>
      <Field id="message" label="Details"><Textarea id="message" name="message" rows={5} required minLength={5} /></Field>
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-3 text-sm text-ink-700">
        <input type="checkbox" name="marketingConsent" className="mt-0.5 rounded border-ink-300" />
        <span>I&apos;m happy for {orgName} to email me occasional news and offers. (Optional — you can unsubscribe any time.)</span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send enquiry"}</Button>
    </form>
  );
}
