import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, systemDb, withTenant } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor, type Role } from "@/modules/auth/permissions";
import { assertSeatAvailable } from "@/modules/billing/entitlements";
import { audit } from "@/modules/audit/service";

export async function listMembers(actor: Actor) {
  assertCan(actor, "enquiry.read");
  return withTenant(actor, async (tx) => {
    const members = await tx
      .select({ id: schema.memberships.id, userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, joinedAt: schema.memberships.createdAt })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.orgId, actor.orgId));
    const invites = await tx.query.invitations.findMany({ where: and(isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())) });
    const workload = await tx
      .select({ userId: schema.enquiries.assignedUserId, n: sql<number>`count(*)::int` })
      .from(schema.enquiries)
      .where(isNull(schema.enquiries.closedAt))
      .groupBy(schema.enquiries.assignedUserId);
    return {
      members: members.map((m) => ({ ...m, openEnquiries: workload.find((w) => w.userId === m.userId)?.n ?? 0 })),
      unassigned: workload.find((w) => w.userId === null)?.n ?? 0,
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
    };
  });
}

export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "member"]) });

/** Returns the invitation link. In production it would be emailed; in development it is shown on screen. */
export async function inviteMember(actor: Actor, input: z.input<typeof inviteSchema>) {
  assertCan(actor, "team.manage");
  const data = inviteSchema.parse(input);
  return withTenant(actor, async (tx) => {
    const pending = await tx.query.invitations.findMany({ where: and(isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())) });
    await assertSeatAvailable(tx, actor.orgId, pending.length);
    if (pending.some((p) => p.email === data.email)) throw new AppError("That person already has a pending invitation.", "conflict");
    const token = randomToken();
    await tx.insert(schema.invitations).values({
      orgId: actor.orgId,
      email: data.email,
      role: data.role,
      tokenHash: sha256(token),
      invitedBy: actor.userId,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    await audit(tx, actor, "team.invited", undefined, { role: data.role });
    return `${env().APP_URL}/invite/${token}`;
  });
}

export async function revokeInvite(actor: Actor, inviteId: string) {
  assertCan(actor, "team.manage");
  await withTenant(actor, (tx) => tx.delete(schema.invitations).where(eq(schema.invitations.id, inviteId)));
}

/** Look up an invitation by token (no tenant yet, so owner role). */
export async function findInvite(token: string) {
  const inv = await systemDb().query.invitations.findFirst({
    where: and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())),
  });
  if (!inv) return null;
  const org = await systemDb().query.organizations.findFirst({ where: eq(schema.organizations.id, inv.orgId), columns: { name: true } });
  return { ...inv, orgName: org?.name ?? "" };
}

export async function acceptInvite(token: string, user: { id: string; email: string }) {
  const inv = await findInvite(token);
  if (!inv) throw new AppError("This invitation has expired or was already used.", "not_found");
  if (inv.email !== user.email.toLowerCase()) throw new AppError(`This invitation is for ${inv.email}. Sign in with that address.`, "forbidden");
  await withTenant({ orgId: inv.orgId, userId: user.id }, async (tx) => {
    await assertSeatAvailable(tx, inv.orgId);
    await tx.insert(schema.memberships).values({ orgId: inv.orgId, userId: user.id, role: inv.role }).onConflictDoNothing();
    await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, inv.id));
    await audit(tx, { orgId: inv.orgId, userId: user.id, role: inv.role as Role }, "team.joined");
  });
  return inv.orgId;
}

export async function changeRole(actor: Actor, membershipId: string, role: Role) {
  assertCan(actor, "team.manage");
  await withTenant(actor, async (tx) => {
    const m = await tx.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.orgId, actor.orgId)) });
    if (!m) throw new AppError("Member not found", "not_found");
    if (m.role === "owner" || role === "owner") assertCan(actor, "team.change_owner");
    if (m.role === "owner" && role !== "owner") {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(and(eq(schema.memberships.orgId, actor.orgId), eq(schema.memberships.role, "owner")));
      if (n <= 1) throw new AppError("A workspace needs at least one owner.", "conflict");
    }
    await tx.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, membershipId));
    await audit(tx, actor, "team.role_changed", { type: "membership", id: membershipId }, { from: m.role, to: role });
  });
}

export async function removeMember(actor: Actor, membershipId: string) {
  assertCan(actor, "team.manage");
  await withTenant(actor, async (tx) => {
    const m = await tx.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.orgId, actor.orgId)) });
    if (!m) throw new AppError("Member not found", "not_found");
    if (m.role === "owner") throw new AppError("Transfer ownership before removing an owner.", "conflict");
    await tx.update(schema.enquiries).set({ assignedUserId: null }).where(eq(schema.enquiries.assignedUserId, m.userId));
    await tx.delete(schema.memberships).where(eq(schema.memberships.id, membershipId));
    await audit(tx, actor, "team.removed", { type: "membership", id: membershipId });
  });
  // No session clean-up needed: every request re-checks membership (see lib/auth/session.ts).
}
