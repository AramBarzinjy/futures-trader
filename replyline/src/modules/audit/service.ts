import { desc, eq } from "drizzle-orm";
import { schema, withTenant, type TenantTx } from "@/lib/db";
import { assertCan, type Actor } from "@/modules/auth/permissions";

/** Record a sensitive action. Metadata must not contain message bodies or secrets. */
export async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  target?: { type: string; id: string },
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(schema.auditLogs).values({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action,
    targetType: target?.type,
    targetId: target?.id,
    metadata,
  });
}

export async function listAuditLog(actor: Actor, limit = 100) {
  assertCan(actor, "audit.read");
  return withTenant(actor, (tx) =>
    tx
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        targetType: schema.auditLogs.targetType,
        targetId: schema.auditLogs.targetId,
        metadata: schema.auditLogs.metadata,
        createdAt: schema.auditLogs.createdAt,
        actorName: schema.users.name,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit),
  );
}
