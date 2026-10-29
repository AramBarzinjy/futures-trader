import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/** Rebuild the test database schema from the migrations once per test run. */
export default async function setup() {
  await import("./setup-env");
  const url = process.env.DATABASE_OWNER_URL!;
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("Refusing to reset a non-test database");
  const pool = new Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
}
