import { desc, inArray } from "drizzle-orm";
import { Send } from "lucide-react";
import { requireApp } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { env } from "@/lib/env";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { MessageStatusBadge } from "@/components/status";
import { formatInZone } from "@/lib/time";
import { getOrganization } from "@/modules/orgs/service";

export const metadata = { title: "Simulated outbox" };

/** Every email "sent" in simulated mode, exactly as the customer would have received it. */
export default async function OutboxPage() {
  const { actor } = await requireApp();
  const org = await getOrganization(actor);
  const rows = await withTenant(actor, (tx) =>
    tx.select().from(schema.messages).where(inArray(schema.messages.status, ["sent", "failed", "uncertain"])).orderBy(desc(schema.messages.createdAt)).limit(100),
  );
  const simulated = rows.filter((r) => r.provider === "simulated" || r.status !== "sent");
  return (
    <>
      <PageHeader title="Simulated outbox" description="Emails the app would have sent. Nothing here reached a real inbox." />
      {env().EMAIL_PROVIDER !== "simulated" && <div className="mb-4"><Notice tone="warn">Real email sending is configured. Only past simulated messages are shown.</Notice></div>}
      {simulated.length === 0 ? (
        <Card><EmptyState icon={<Send size={20} />} title="Nothing sent yet" description="Send a reply or approve a follow-up to see it here." /></Card>
      ) : (
        <div className="space-y-4">
          {simulated.map((m) => (
            <Card key={m.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-500">To</span> <span className="font-medium">{m.toEmail}</span>
                <MessageStatusBadge status={m.status} />
                <span className="ml-auto text-xs text-ink-400">{formatInZone(m.sentAt ?? m.createdAt, org.timezone, "short")}</span>
              </div>
              <div className="mt-1 text-sm"><span className="text-ink-500">From</span> {org.name} · <span className="text-ink-500">Reply-to</span> {org.email ?? "—"}</div>
              <div className="mt-2 font-medium">{m.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-ink-700">{m.body}</pre>
              {m.error && <p className="mt-2 text-xs text-red-600">{m.error}</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

