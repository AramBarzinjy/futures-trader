import { existsSync } from "node:fs";

// Test configuration. Uses the database URLs from .env, but always against a
// separate "<name>_test" database, so tests can never touch development data.
if (existsSync(".env")) process.loadEnvFile(".env");

function toTestDb(url: string | undefined) {
  if (!url) throw new Error("Set DATABASE_URL and DATABASE_OWNER_URL (see .env.example) before running tests.");
  const u = new URL(url);
  if (!u.pathname.endsWith("_test")) u.pathname = `${u.pathname}_test`;
  return u.toString();
}

process.env.DATABASE_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? toTestDb(process.env.DATABASE_OWNER_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? toTestDb(process.env.DATABASE_URL);
process.env.APP_ENV = "test";
process.env.APP_URL = "http://localhost:3000";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.EMAIL_PROVIDER = "simulated";
process.env.AI_PROVIDER = "mock";
process.env.BILLING_PROVIDER = "dev";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.STRIPE_PRICE_GROWTH_MONTHLY = "price_growth_m";
process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
process.env.INBOUND_EMAIL_SECRET = "inbound_test_secret";
