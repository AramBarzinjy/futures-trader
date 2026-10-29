# Costs

All figures are rough estimates in GBP at late-2026 list prices as I understand
them. **Check current pricing on each provider's site before committing.**

## Monthly running costs

| Item | 0–10 customers | ~100 customers | Notes |
|---|---|---|---|
| Web + worker hosting | £10–25 | £40–100 | Two small always-on services |
| Postgres with backups | £10–25 | £30–80 | Size grows slowly; text data |
| Email (Resend) | £0–20 | £20–80 | Free tier then volume plans |
| AI (Claude) | £1–10 | £50–250 | Depends on drafts/month and model; see below |
| Stripe | 1.5% + 20p per UK card payment | same | Plus Stripe Billing fee (~0.7% of billing volume) |
| Error monitoring / uptime | £0 | £0–25 | Free tiers go a long way |
| Domain, mailbox | ~£5 | ~£5 | |
| **Total (excl. Stripe %)** | **~£30–85** | **~£150–550** | |

## AI cost per draft (assumptions stated)

A draft request sends ~1,500 input tokens (instructions, business facts, enquiry,
last few emails) and gets ~400 output tokens, plus thinking.

- Claude Opus 5.5 ($4 / $20 per million tokens in / out): roughly 1.5–3p per draft.
- Claude Haiku 5.5 ($0.10 / $0.50): well under 0.1p per draft.

A Growth customer using all 600 drafts on Opus costs roughly £9–18/month in AI,
against £79 revenue. Plan limits cap the downside; switching model is one env var.

## Unit economics sketch (Growth plan)

| | per customer / month |
|---|---|
| Price | £79.00 |
| Stripe (~2.4% all-in) | –£1.90 |
| AI (typical, well under limit) | –£2–6 |
| Email, hosting share | –£1–3 |
| **Gross margin** | **~£68–74 (≈86–93%)** |

## Development cost

The MVP in this folder was built by an AI assistant in one session. Getting to a
sellable v1 still needs (see ROADMAP): mailbox OAuth, password reset, email
verification, legal docs, penetration test. Indicative external spend if you
buy help: legal templates/review £500–2,000; pen test £1,500–5,000; Google
restricted-scope security assessment (only if reading Gmail) roughly £1,000–6,000 per year.

## Costs that need your approval before they start

Resend (above free tier), Anthropic API credit, Stripe (only takes a percentage),
hosting, a domain, legal review, ICO data protection fee (£40–60/year for most small companies).
