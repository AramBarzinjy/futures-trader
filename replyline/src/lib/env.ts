import { z } from "zod";

/**
 * Server-only configuration. Never import this from a client component:
 * nothing here may reach the browser.
 */
const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  CRON_SECRET: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["simulated", "resend"]).default("simulated"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().optional(),
  ALLOW_REAL_EMAIL: z.string().optional(),
  INBOUND_EMAIL_SECRET: z.string().optional(),
  AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  BILLING_PROVIDER: z.enum(["dev", "stripe"]).default("dev"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report which keys are wrong, never their values.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${keys}. See .env.example.`);
  }
  const e = parsed.data;
  if (e.APP_ENV === "production" && e.BILLING_PROVIDER === "dev") {
    throw new Error("BILLING_PROVIDER=dev is not allowed in production.");
  }
  cached = e;
  return e;
}

export const isDevLike = () => ["development", "test"].includes(env().APP_ENV);

/** For tests that change process.env between cases. */
export function resetEnvCache() {
  cached = null;
}
