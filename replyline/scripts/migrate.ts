import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Runs as the OWNER role. Usage: npm run db:migrate
async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
