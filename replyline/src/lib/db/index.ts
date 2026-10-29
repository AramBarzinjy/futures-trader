import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction already scoped to one tenant via app.org_id. */
export type TenantTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

declare global {
  var __replylinePools: { app?: Pool; owner?: Pool } | undefined;
}
// Reuse pools across Next.js hot reloads in development.
const pools = (globalThis.__replylinePools ??= {});

function appPool() {
  return (pools.app ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 }));
}
function ownerPool() {
  return (pools.owner ??= new Pool({ connectionString: env().DATABASE_OWNER_URL, max: 5 }));
}

let appDb: DB | null = null;
let sysDb: DB | null = null;

/**
 * Database handle for the RLS-enforced application role.
 * Prefer withTenant(); querying tenant tables outside it returns no rows.
 */
export function db(): DB {
  return (appDb ??= drizzle(appPool(), { schema }));
}

/**
 * Owner-role handle that BYPASSES row-level security. Restricted to:
 * authentication lookups, resolving a public form key, the job worker's claim
 * step, payment webhooks and rate limiting. Every use must filter explicitly.
 */
export function systemDb(): DB {
  return (sysDb ??= drizzle(ownerPool(), { schema }));
}

export interface TenantContext {
  orgId: string;
  userId?: string | null;
}

/** Run `fn` in a transaction where row-level security is scoped to one organisation. */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** Scoped to a user but no organisation — only that user's memberships are visible. */
export async function withUser<T>(userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', '', true), set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  await Promise.all([pools.app?.end(), pools.owner?.end()]);
  pools.app = undefined;
  pools.owner = undefined;
  appDb = null;
  sysDb = null;
}

export { schema };
