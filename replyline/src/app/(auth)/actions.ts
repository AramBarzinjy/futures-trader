"use server";

import { redirect } from "next/navigation";
import { attempt, str, type ActionState } from "@/lib/actions";
import { clearSessionCookie, clientIp, getSession, requireUser, setSessionCookie } from "@/lib/auth/session";
import { destroySession, signIn, signUp, setActiveOrg } from "@/modules/auth/service";
import { acceptInvite } from "@/modules/team/service";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { token } = await signUp({ name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") }, await clientIp());
    await setSessionCookie(token);
    const qs = new URLSearchParams({ industry: str(fd, "industry"), plan: str(fd, "plan") });
    redirect(str(fd, "next") ? safeNext(str(fd, "next")) : `/onboarding?${qs}`);
  });
}

export async function signInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { token } = await signIn(str(fd, "email"), str(fd, "password"), await clientIp());
    await setSessionCookie(token);
    redirect(safeNext(str(fd, "next") || "/app"));
  });
}

export async function signOutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
  redirect("/sign-in");
}

export async function acceptInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const s = await requireUser();
    const orgId = await acceptInvite(str(fd, "token"), s.user);
    await setActiveOrg(s.tokenHash, s.user.id, orgId);
    redirect("/app");
  });
}

export async function switchOrgAction(fd: FormData) {
  const s = await getSession();
  if (!s) redirect("/sign-in");
  await setActiveOrg(s.tokenHash, s.user.id, str(fd, "orgId"));
  redirect("/app");
}
