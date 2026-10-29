import { AppError } from "@/lib/errors";

export type Role = "owner" | "admin" | "member";

/**
 * Who may do what. Checked on the server in every service function; the UI
 * only uses this to decide what to show, never as the enforcement point.
 */
const MATRIX = {
  "enquiry.read": ["owner", "admin", "member"],
  "enquiry.write": ["owner", "admin", "member"],
  "enquiry.bulk": ["owner", "admin"],
  "enquiry.import": ["owner", "admin"],
  "enquiry.export": ["owner", "admin"],
  "message.send": ["owner", "admin", "member"],
  "template.write": ["owner", "admin"],
  "workflow.write": ["owner", "admin"],
  "workflow.authorise_autosend": ["owner"],
  "jobs.retry": ["owner", "admin"],
  "appointment.write": ["owner", "admin", "member"],
  "report.read": ["owner", "admin", "member"],
  "report.configure": ["owner", "admin"],
  "team.manage": ["owner", "admin"],
  "team.change_owner": ["owner"],
  "settings.write": ["owner", "admin"],
  "billing.manage": ["owner"],
  "data.export_all": ["owner"],
  "data.erase_contact": ["owner", "admin"],
  "org.delete": ["owner"],
  "audit.read": ["owner", "admin"],
  "integration.manage": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: Role | "system", permission: Permission): boolean {
  if (role === "system") return true;
  return (MATRIX[permission] as readonly Role[]).includes(role);
}

/** Identity for every service call. Built from the session, or `system` for the worker. */
export interface Actor {
  orgId: string;
  userId: string | null;
  role: Role | "system";
}

export function assertCan(actor: Actor, permission: Permission) {
  if (!can(actor.role, permission)) throw new AppError("You don't have permission to do that.", "forbidden");
}

export const systemActor = (orgId: string): Actor => ({ orgId, userId: null, role: "system" });
