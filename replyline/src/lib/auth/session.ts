import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { listUserOrgs, resolveSession, SESSION_DAYS } from "@/modules/auth/service";
import type { Actor, Role } from "@/modules/auth/permissions";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "rl_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().APP_ENV === "production" || env().APP_ENV === "staging",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token);
});

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/sign-in");
  return s;
}

export interface AppContext {
  actor: Actor;
  user: { id: string; name: string; email: string };
  orgs: { orgId: string; role: Role; name: string }[];
  orgName: string;
  role: Role;
}

/**
 * The tenant context for a signed-in request. Membership is re-checked on
 * every call, so removing someone from a workspace takes effect immediately.
 */
export const requireApp = cache(async (): Promise<AppContext> => {
  const s = await requireUser();
  const orgs = await listUserOrgs(s.user.id);
  if (!orgs.length) redirect("/onboarding");
  const current = orgs.find((o) => o.orgId === s.activeOrgId) ?? orgs[0];
  return {
    actor: { orgId: current.orgId, userId: s.user.id, role: current.role },
    user: s.user,
    orgs,
    orgName: current.name,
    role: current.role,
  };
});

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}
