# Roadmap

Ordered by what most improves the chance of a paying customer staying.

## Next release (v0.2) — make it safe to sell

1. **Move to its own repo** and set up CI (typecheck, lint, tests, build on every PR).
2. **Connect real email (Resend)** in a staging environment and send to your own addresses.
3. **Password reset + email verification** (uses the email provider).
4. **Invitation emails** (currently copy-the-link).
5. **Stripe in test mode end to end**, then live.
6. **Legal docs** in place of placeholders; ICO registration.
7. **Content-Security-Policy**, Sentry, uptime monitor.

## v0.3 — less manual work for the customer

1. **Microsoft 365 mailbox** (Graph `Mail.Send`, `Mail.ReadBasic`) — send from their own address, detect replies automatically. Microsoft's verification is lighter than Google's, and many trades use Outlook.
2. **Gmail** — send-only (`gmail.send`, a "sensitive" scope: verification but no paid assessment) first; reading replies (restricted scope) only if demand justifies the annual assessment.
3. **Calendar sync** (Google/Outlook): create events on booking; read free/busy for suggested slots.
4. **SMS reminders** (biggest single no-show reducer for trades) — Twilio/Vonage, with UK sender ID rules.

## v0.4 — growth features

- Custom field editor UI (model exists), multiple pipelines (Pro).
- Reusable industry template packs; property/recruitment-specific presets refined from interviews.
- Platform admin console (support, impersonation with audit, plan overrides).
- Agency/reseller plan: one login across many client workspaces (membership model already supports it).
- Usage add-ons and paid onboarding checkout.

## Deliberately not planned

Bulk cold-email campaigns, purchased lists, deliverability tricks.
