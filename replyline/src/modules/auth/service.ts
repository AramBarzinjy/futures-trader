import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { systemDb, withUser, schema } from "@/lib/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Role } from "./permissions";

/*
 * Email + password authentication with database-backed sessions.
 * The cookie holds a random token; only its sha256 is stored, so a database
 * leak does not reveal usable sessions. Passwords are hashed with scrypt.
 * Auth tables are read with the owner role because there is no tenant yet.
 */

export const SESSION_DAYS = 30;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export async function signUp(input: z.input<typeof signUpSchema>, ip = "unknown") {
  const data = signUpSchema.parse(input);
  await checkRateLimit(`signup:${ip}`, 10, 3600);
  const existing = await systemDb().query.users.findFirst({ where: eq(schema.users.email, data.email) });
  if (existing) throw new AppError("An account with that email already exists. Try signing in.", "conflict");
  const [user] = await systemDb()
    .insert(schema.users)
    .values({ name: data.name, email: data.email, passwordHash: await hashPassword(data.password) })
    .returning({ id: schema.users.id });
  return { userId: user.id, ...(await createSession(user.id)) };
}

export async function signIn(emailRaw: string, password: string, ip = "unknown") {
  const email = emailRaw.trim().toLowerCase();
  await checkRateLimit(`signin:${ip}`, 30, 900);
  await checkRateLimit(`signin:${email}`, 10, 900);
  const user = await systemDb().query.users.findFirst({ where: eq(schema.users.email, email) });
  // Same message and similar work either way, so the form doesn't reveal which emails exist.
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH);
  if (!user || !ok) throw new AppError("Email or password is incorrect.", "unauthenticated");
  return { userId: user.id, ...(await createSession(user.id)) };
}

const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export async function createSession(userId: string, activeOrgId?: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await systemDb()
    .insert(schema.sessions)
    .values({ tokenHash: sha256(token), userId, expiresAt, activeOrgId: activeOrgId ?? null });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await systemDb().delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export interface SessionInfo {
  tokenHash: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  activeOrgId: string | null;
}

export async function resolveSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const tokenHash = sha256(token);
  const rows = await systemDb()
    .select({
      tokenHash: schema.sessions.tokenHash,
      activeOrgId: schema.sessions.activeOrgId,
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      isPlatformAdmin: schema.users.isPlatformAdmin,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    tokenHash: r.tokenHash,
    activeOrgId: r.activeOrgId,
    user: { id: r.id, name: r.name, email: r.email, isPlatformAdmin: r.isPlatformAdmin },
  };
}

/** Workspaces the user belongs to, read through RLS as that user. */
export async function listUserOrgs(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({ orgId: schema.memberships.orgId, role: schema.memberships.role, name: schema.organizations.name })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
      .where(eq(schema.memberships.userId, userId)),
  ) as Promise<{ orgId: string; role: Role; name: string }[]>;
}

export async function setActiveOrg(tokenHash: string, userId: string, orgId: string) {
  const orgs = await listUserOrgs(userId);
  if (!orgs.some((o) => o.orgId === orgId)) throw new AppError("You are not a member of that workspace.", "forbidden");
  await systemDb().update(schema.sessions).set({ activeOrgId: orgId }).where(eq(schema.sessions.tokenHash, tokenHash));
}
