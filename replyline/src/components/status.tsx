import { Badge } from "./ui";

export type StatusDef = { key: string; label: string; color: string; isClosed: boolean };

export function StatusBadge({ statusKey, statuses }: { statusKey: string; statuses: StatusDef[] }) {
  const s = statuses.find((x) => x.key === statusKey);
  return <Badge tone={s?.color ?? "slate"}>{s?.label ?? statusKey}</Badge>;
}

const PRIORITY_TONE = { urgent: "red", high: "orange", normal: "slate", low: "slate" } as const;
export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal") return null;
  return <Badge tone={PRIORITY_TONE[priority as keyof typeof PRIORITY_TONE] ?? "slate"}>{priority[0].toUpperCase() + priority.slice(1)}</Badge>;
}

export function MessageStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    draft: ["slate", "Draft"],
    pending_approval: ["amber", "Awaiting approval"],
    queued: ["blue", "Queued"],
    sending: ["blue", "Sending"],
    sent: ["green", "Sent"],
    received: ["violet", "Received"],
    failed: ["red", "Failed"],
    uncertain: ["red", "Delivery uncertain"],
    cancelled: ["slate", "Cancelled"],
  };
  const [tone, label] = map[status] ?? ["slate", status];
  return <Badge tone={tone}>{label}</Badge>;
}
