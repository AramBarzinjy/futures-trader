import { and, eq, inArray } from "drizzle-orm";
import { schema, type TenantTx } from "@/lib/db";
import { sha256, signToken, verifySignedToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { normaliseEmail } from "@/modules/contacts/service";

/*
 * Suppression list. Stored as a hash of the address so that erasing a contact
 * (UK GDPR Art. 17) does not also erase the record that they asked us to stop.
 *
 * scope "marketing" blocks marketing messages only.
 * scope "all" blocks every automated or manual email to that address.
 */

export type SuppressionScope = "marketing" | "all";

export const emailHash = (email: string) => sha256(normaliseEmail(email) ?? "");

export async function isSuppressed(tx: TenantTx, email: string, kind: "transactional" | "marketing"): Promise<boolean> {
  const scopes: SuppressionScope[] = kind === "marketing" ? ["marketing", "all"] : ["all"];
  const row = await tx.query.suppressions.findFirst({
    where: and(eq(schema.suppressions.emailHash, emailHash(email)), inArray(schema.suppressions.scope, scopes)),
    columns: { id: true },
  });
  return !!row;
}

export async function addSuppression(tx: TenantTx, orgId: string, email: string, scope: SuppressionScope, reason: string) {
  await tx
    .insert(schema.suppressions)
    .values({ orgId, emailHash: emailHash(email), scope, reason })
    .onConflictDoNothing();
}

export async function removeSuppression(tx: TenantTx, email: string, scope: SuppressionScope) {
  await tx.delete(schema.suppressions).where(and(eq(schema.suppressions.emailHash, emailHash(email)), eq(schema.suppressions.scope, scope)));
}

/** Link placed in emails. Signed, so it can't be forged to unsubscribe someone else. */
export function unsubscribeUrl(orgId: string, email: string, scope: SuppressionScope): string {
  const token = signToken({ o: orgId, h: emailHash(email), s: scope });
  return `${env().APP_URL}/u/${token}`;
}

export function parseUnsubscribeToken(token: string): { orgId: string; hash: string; scope: SuppressionScope } | null {
  const p = verifySignedToken(token);
  if (!p || !p.o || !p.h || (p.s !== "marketing" && p.s !== "all")) return null;
  return { orgId: p.o, hash: p.h, scope: p.s };
}

/**
 * Can this message lawfully go to this contact? Returns a reason if not.
 * The marketing rule is conservative by default; see docs/COMPLIANCE.md.
 */
export async function sendBlockReason(
  tx: TenantTx,
  input: {
    toEmail: string | null;
    kind: "transactional" | "marketing";
    contact: { marketingConsent: string; erasedAt: Date | null } | null;
    marketingBasis: "consent_required" | "soft_opt_in";
  },
): Promise<string | null> {
  if (!input.toEmail) return "No email address for this contact.";
  if (input.contact?.erasedAt) return "This contact's data has been erased.";
  if (await isSuppressed(tx, input.toEmail, input.kind)) return "This address has opted out.";
  if (input.kind === "marketing") {
    if (input.contact?.marketingConsent === "withdrawn") return "Marketing consent was withdrawn.";
    if (input.marketingBasis === "consent_required" && input.contact?.marketingConsent !== "granted") {
      return "Marketing emails need recorded consent from this contact.";
    }
  }
  return null;
}
