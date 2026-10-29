import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Small, consistent component set. Server-component safe (no client hooks). */

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const BTN = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-ink-800 ring-1 ring-inset ring-ink-200 hover:bg-ink-50",
  ghost: "text-ink-700 hover:bg-ink-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
} as const;
const SIZE = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" } as const;

type BtnProps = { variant?: keyof typeof BTN; size?: keyof typeof SIZE };
const btnClass = (v: keyof typeof BTN = "primary", s: keyof typeof SIZE = "md", extra?: string) =>
  cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap", BTN[v], SIZE[s], extra);

export function Button({ variant, size, className, ...p }: ComponentProps<"button"> & BtnProps) {
  return <button className={btnClass(variant, size, className)} {...p} />;
}

export function ButtonLink({ variant, size, className, ...p }: ComponentProps<typeof Link> & BtnProps) {
  return <Link className={btnClass(variant, size, className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl bg-white ring-1 ring-ink-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)} {...p} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  slate: "bg-ink-100 text-ink-700 ring-ink-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  teal: "bg-brand-50 text-brand-700 ring-brand-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, className }: { tone?: Tone | string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[(tone as Tone) in TONES ? (tone as Tone) : "slate"], className)}>
      {children}
    </span>
  );
}

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-800">
      {children}
      {hint && <span className="ml-1 font-normal text-ink-500">{hint}</span>}
    </label>
  );
}

const field = "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-600 focus:outline-none disabled:bg-ink-50";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(field, "h-10", className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(field, "min-h-24", className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(field, "h-10 pr-8", className)} {...p} />;
}

export function Field({ id, label, hint, children }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function Checkbox({ id, name, label, description, defaultChecked, disabled, value }: { id: string; name: string; label: ReactNode; description?: ReactNode; defaultChecked?: boolean; disabled?: boolean; value?: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input id={id} name={name} type="checkbox" value={value} defaultChecked={defaultChecked} disabled={disabled} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600" />
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description && <span className="block text-sm text-ink-500">{description}</span>}
      </span>
    </label>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-ink-100 p-3 text-ink-500">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, href, tone, hint }: { label: string; value: ReactNode; href?: string; tone?: "warn" | "bad" | "good"; hint?: string }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "text-ink-950";
  const body = (
    <>
      <div className="text-sm text-ink-500">{label}</div>
      <div className={cx("mt-1 text-3xl font-semibold tabular-nums tracking-tight", color)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl bg-white p-5 ring-1 ring-ink-200/80 transition hover:ring-brand-500">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl bg-white p-5 ring-1 ring-ink-200/80">{body}</div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "success" | "error"; title?: string; children: ReactNode }) {
  const c = {
    info: "bg-blue-50 text-blue-900 ring-blue-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    error: "bg-red-50 text-red-900 ring-red-200",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg px-4 py-3 text-sm ring-1 ring-inset", c)}>
      {title && <div className="font-semibold">{title}</div>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-ink-100 text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cx("px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500", className)}>
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx("px-4 py-3 align-top text-ink-700", className)}>{children}</td>;
