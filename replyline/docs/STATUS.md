# Status — what works, what's simulated, what's blocked

Last updated at the end of the first build session. "Verified" means covered by
an automated test that passed, or exercised in the browser journey test.

## Working and verified

| Area | Verified by |
|---|---|
| Sign-up, sign-in, sessions, sign-out, rate-limited login | integration tests + e2e |
| Workspace creation with industry presets (5 industries) | e2e (onboarding) |
| Tenant isolation: row-level security on every tenant table; services reject cross-tenant ids; app DB role can't read password hashes or sessions | `tests/integration/tenancy.test.ts`, e2e step 10 |
| Roles (owner / admin / member) enforced server-side | unit + integration |
| Enquiries: create, edit, status, priority, assign, notes, timeline, search, filters, sort, pagination, pipeline board | integration + e2e |
| Contact matching by email/phone; never overwrites stored details; conflicts logged | integration |
| Duplicate detection (flag only) and resolution | integration |
| CSV import (preview, column mapping, row errors, automation off by default) and export (formula-injection safe) | unit + integration |
| Bulk status / priority / assign / delete (delete needs count typed back) | integration |
| Templates: variables, missing-variable detection, injection-safe rendering, preview | unit |
| Approval queue: automated messages wait for a person by default | integration + e2e |
| Follow-up engine: delays in business days and hours, DST-safe; stops on reply, booking, status, opt-out, closure | unit + integration |
| Idempotent sending: duplicate jobs / restarts never double-send; interrupted sends become "uncertain" not resent | integration |
| Durable job queue: retries with backoff, failed-job list, safe manual retry, multi-worker safe | integration |
| Dry-run of any workflow against a real enquiry | integration |
| Appointments: confirmation, reminders, reschedule (old reminders void), cancel; timezone + clock-change handling; .ics download | unit + integration + e2e |
| Weekly report: exact counts, by source, quiet prospects, won/lost, upcoming, rule-based suggestions, emailed to recipients | integration + e2e |
| Plan entitlements: seats, features, monthly AI / automation / email limits, trial expiry fallback | integration |
| Dev billing: plan change without payment; simulated payment failure / cancellation | integration |
| Stripe webhook: signature verification, replay protection, idempotency, plan mapping, payment-failure downgrade | unit + integration (signed test payloads) |
| Suppression list, STOP replies, signed unsubscribe links, marketing-consent rule | integration |
| Contact data export (subject access), erasure, retention purge, workspace export / delete | integration |
| Public website form: honeypot, timing check, link-spam check, rate limits, never echoes data | integration + e2e |
| Inbound email webhook (shared-secret auth) threads replies and stops follow-ups | integration |
| AI drafting safety: only this enquiry's data is sent; output schema-validated; prices / links / contacts / promises flagged | unit + integration |
| Marketing site, pricing from config, FAQ, industry pages, legal placeholders | e2e |
| Production build, lint, typecheck | `npm run build`, `lint`, `typecheck` |

## Implemented but NOT verified against the real service

These need your accounts. The code follows each provider's documented API and
has tests against mocked responses, but has never talked to the live service.

| Integration | What's needed from you | Guide |
|---|---|---|
| Real email via **Resend** | Resend account, verified sending domain, API key | INTEGRATIONS.md §1 |
| **Claude** for AI drafting | Anthropic API key | INTEGRATIONS.md §2 |
| **Stripe** subscriptions | Stripe account, 6 prices, webhook secret | INTEGRATIONS.md §3 |
| **Inbound email** forwarding | An email provider with inbound parsing (e.g. Postmark / Resend inbound) | INTEGRATIONS.md §4 |

## Simulated (by design, for development and demos)

- Email: `EMAIL_PROVIDER=simulated` records every message in the in-app Outbox.
- AI: `AI_PROVIDER=mock` returns deterministic drafts built only from stored data.
- Billing: `BILLING_PROVIDER=dev` changes plans instantly. Refused in production.

## Not built yet (labelled honestly in the app)

- Gmail / Microsoft 365 mailbox connection (send-as and reading replies) — needs
  Google/Microsoft OAuth verification; see ROADMAP.
- Google / Outlook calendar sync — `.ics` download covers the MVP.
- Team invitation emails — the invite link is shown to copy and send yourself.
- Password reset by email.
- Custom field editor UI (the data model and API support custom fields).
- Usage-based add-ons, agency/reseller plans, onboarding-fee checkout.

## Blockers and decisions that need you

1. **Move to its own repository.** This lives in `futures-trader/replyline`.
   Create an empty GitHub repo (e.g. `replyline`) and I can move it with history.
2. **Name.** Replyline is a placeholder; check trademark (UK IPO) and domain.
3. **Accounts** (only when you want real sending/payments): Resend, Anthropic, Stripe, a host. See COSTS.md.
4. **Legal review** before taking money: privacy policy, terms, DPA, sub-processor list. See COMPLIANCE.md.
5. **ICO registration** (data protection fee) for the operating company.
