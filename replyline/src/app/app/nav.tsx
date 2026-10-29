"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Menu,
  Plug,
  Send,
  Settings,
  Users,
  Workflow,
  X,
  Contact,
} from "lucide-react";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/app/enquiries", label: "Enquiries", icon: Inbox },
  { href: "/app/contacts", label: "Contacts", icon: Contact },
  { href: "/app/follow-ups", label: "Follow-ups", icon: ListTodo, badgeKey: "followUps" },
  { href: "/app/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/app/workflows", label: "Workflows", icon: Workflow, badgeKey: "failed" },
  { href: "/app/templates", label: "Email templates", icon: FileText },
  { href: "/app/reports", label: "Reports", icon: BarChart3 },
  { href: "/app/integrations", label: "Integrations", icon: Plug },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings", label: "Settings", icon: Settings },
] as const;

export function AppNav({ badges, showOutbox }: { badges: Record<string, number>; showOutbox: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = showOutbox ? [...NAV, { href: "/app/outbox", label: "Simulated outbox", icon: Send } as const] : NAV;
  const list = (
    <ul className="space-y-0.5">
      {items.map((n) => {
        const active = "exact" in n && n.exact ? path === n.href : path.startsWith(n.href);
        const badge = "badgeKey" in n ? badges[n.badgeKey] : 0;
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-white/10 text-white" : "text-ink-300 hover:bg-white/5 hover:text-white"}`}
            >
              <n.icon size={18} aria-hidden />
              <span className="flex-1">{n.label}</span>
              {badge > 0 && (
                <span className={`rounded-full px-1.5 text-xs ${"badgeKey" in n && n.badgeKey === "failed" ? "bg-red-500 text-white" : "bg-brand-500 text-white"}`}>{badge}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-ink-700 lg:hidden" aria-label="Open menu">
        <Menu size={22} />
      </button>
      <nav aria-label="App" className="hidden lg:block">{list}</nav>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-ink-950 p-4">
            <button type="button" onClick={() => setOpen(false)} className="mb-4 rounded-md p-2 text-ink-300" aria-label="Close menu">
              <X size={22} />
            </button>
            <nav aria-label="App">{list}</nav>
          </div>
        </div>
      )}
    </>
  );
}
