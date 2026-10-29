# Security

## What we protect, from whom

| Asset | Threat | Main control |
|---|---|---|
| One business's customer data | Another tenant (bug or malicious user) | Postgres RLS on every tenant table + per-function permission checks |
| Accounts | Credential stuffing, session theft | scrypt hashes, per-IP and per-email rate limits, HttpOnly SameSite cookies, hashed session tokens |
| Customers' inboxes | The product being used to spam, or a bug double-sending | Approval by default, idempotent sends, suppression list, consent rules, monthly email caps |
| AI | Prompt injection via enquiry text | No tools, no cross-record data in prompts, schema validation, content checks, human sends |
| Billing | Forged webhooks, browser-claimed plans | HMAC signature + timestamp tolerance, event-id idempotency, plan read from DB only |
| Secrets | Leakage to browser or logs | Server-only `env()`, no secrets in `NEXT_PUBLIC_*`, errors logged without bodies |

## Controls in place

- **Tenant isolation** — two DB roles; app role is RLS-bound and can't bypass.
  Services re-check ownership; cross-tenant ids return "not found". Tests:
  `tests/integration/tenancy.test.ts`, e2e step 10.
- **Authorisation** — permission matrix in `src/modules/auth/permissions.ts`;
  `assertCan` in every service. Owner-only: billing, auto-send authorisation,
  workspace export/delete, ownership changes. UI hiding is cosmetic only.
- **Membership re-checked on every request** — removed users lose access immediately.
- **Server actions** — Next.js checks Origin on server actions (CSRF); every
  action re-authenticates.
- **Input validation** — Zod on all inputs; email subjects stripped of newlines
  (header injection); template rendering is single-pass (no template injection).
- **Output encoding** — React escapes by default; no `dangerouslySetInnerHTML`.
  CSV export neutralises spreadsheet formulas.
- **Public endpoints** — rate-limited in Postgres (multi-instance safe);
  honeypot + timing + link-count spam checks; same response for spam and real
  submissions; never return stored data.
- **Webhooks** — Stripe HMAC with 5-minute tolerance and replay protection;
  inbound email and cron require bearer secrets compared in constant time.
- **Unsubscribe links** — HMAC-signed tokens; GET shows a confirm button (mail
  scanners pre-fetch links), POST acts.
- **Secrets at rest** — integration tokens column is AES-256-GCM (`lib/crypto.ts`).
- **Headers** — HSTS, nosniff, referrer policy, permissions policy,
  `X-Frame-Options: DENY` except the embeddable form at `/f/*`.
- **Audit log** — auto-send authorisation, plan changes, settings for AI
  sharing / marketing basis / retention, exports, erasures, bulk deletes,
  imports, team changes, job retries.
- **Safe failure** — `publicMessage()` shows only deliberate messages; other
  errors are logged as type + message, without request data.

## Before launch — checklist

- [ ] Run an external penetration test focused on tenant isolation and auth.
- [ ] Add a Content-Security-Policy (start in report-only mode).
- [ ] Add password reset and optional 2FA (TOTP) for owners.
- [ ] Add email verification on sign-up (prevents squatting others' addresses).
- [ ] Rotate `ENCRYPTION_KEY` procedure (re-encrypt `integrations.encrypted_tokens`).
- [ ] Dependency scanning (GitHub Dependabot) and secret scanning on the repo.
- [ ] Error monitoring (e.g. Sentry) with PII scrubbing configured.
- [ ] Confirm the production `replyline_app` role has `NOBYPASSRLS` and does not own tables.
- [ ] Backups encrypted, restore tested (see DEPLOYMENT.md).
- [ ] Session lifetime and idle timeout reviewed (currently 30 days absolute).

## Known limitations

- Sign-in throttling is per IP and per email; there's no CAPTCHA.
- No email verification yet — an attacker could create an account using
  someone else's email address (they couldn't access anything of that person's).
- The simulated outbox shows full email bodies to every member of a workspace.
