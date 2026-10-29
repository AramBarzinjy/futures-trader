import { env } from "@/lib/env";

/*
 * Email provider abstraction. The app only ever talks to `EmailProvider`.
 * - simulated: nothing leaves the server. The default everywhere.
 * - resend:    real delivery through Resend's HTTP API. Implemented and unit
 *              tested against a mocked API; NOT yet verified against a live
 *              account. Refuses to run unless ALLOW_REAL_EMAIL=true.
 */

export interface OutgoingEmail {
  to: string;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  /** Used by providers that support it so a retried HTTP call can't send twice. */
  idempotencyKey: string;
  headers?: Record<string, string>;
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    /** Safe to try again (e.g. 429 / 5xx before acceptance). */
    public retryable: boolean,
    /** We can't tell whether the provider accepted it (e.g. timeout). Never auto-retry these. */
    public ambiguous = false,
  ) {
    super(message);
    this.name = "EmailProviderError";
  }
}

export interface EmailProvider {
  readonly name: string;
  readonly isReal: boolean;
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** In-process provider for development, demos and tests. */
export class SimulatedEmailProvider implements EmailProvider {
  readonly name = "simulated";
  readonly isReal = false;
  static sent: OutgoingEmail[] = [];
  private static failures: EmailProviderError[] = [];

  /** Test hook: make the next N sends fail with the given error. */
  static failNext(err: EmailProviderError, times = 1) {
    for (let i = 0; i < times; i++) this.failures.push(err);
  }
  static reset() {
    this.sent = [];
    this.failures = [];
  }

  async send(email: OutgoingEmail) {
    const f = SimulatedEmailProvider.failures.shift();
    if (f) throw f;
    SimulatedEmailProvider.sent.push(email);
    return { providerMessageId: `sim_${email.idempotencyKey}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly isReal = true;
  constructor(
    private apiKey: string,
    private fromAddress: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(email: OutgoingEmail) {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": email.idempotencyKey,
        },
        body: JSON.stringify({
          from: `${sanitiseDisplayName(email.fromName)} <${this.fromAddress}>`,
          to: [email.to],
          reply_to: email.replyTo ? [email.replyTo] : undefined,
          subject: email.subject,
          text: email.text,
          headers: email.headers,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Network failure or timeout: the request may or may not have been accepted.
      throw new EmailProviderError("Email provider did not respond", false, true);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { providerMessageId: json.id ?? "unknown" };
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new EmailProviderError(`Email provider rejected the message (HTTP ${res.status})`, retryable);
  }
}

function sanitiseDisplayName(n: string) {
  return n.replace(/[<>"\r\n]/g, "").slice(0, 80);
}

let override: EmailProvider | null = null;
/** Tests can inject a provider. */
export function setEmailProviderForTests(p: EmailProvider | null) {
  override = p;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  const e = env();
  if (e.EMAIL_PROVIDER === "resend") {
    if (e.ALLOW_REAL_EMAIL !== "true") {
      throw new Error("EMAIL_PROVIDER=resend but ALLOW_REAL_EMAIL is not 'true'. Real sending is disabled.");
    }
    if (!e.RESEND_API_KEY || !e.EMAIL_FROM_ADDRESS) throw new Error("RESEND_API_KEY and EMAIL_FROM_ADDRESS are required.");
    return new ResendEmailProvider(e.RESEND_API_KEY, e.EMAIL_FROM_ADDRESS);
  }
  return new SimulatedEmailProvider();
}
