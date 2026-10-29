# Replyline

**Never lose track of an enquiry.** A multi-tenant SaaS that captures enquiries,
drafts replies, runs follow-ups that stop when the customer answers, sends
appointment reminders and produces a weekly prospect report — for small UK
service businesses.

> "Replyline" is a working name (the brief called it EnquiryFlow AI). It lives in
> `src/config/brand.ts`; renaming is a one-line change. Check trademarks and
> domains before committing to any name.

This folder is self-contained. It sits inside the `futures-trader` repository
only because that is where the work was started; it shares nothing with the
trading research and should move to its own repository (see `docs/STATUS.md`).

## Run it locally

You need Node 22+ and PostgreSQL 16 (any 14+ should work).

```bash
cd replyline
npm install
cp .env.example .env        # then fill in the values — see docs/SETUP.md
```

Create the two database roles once (as a Postgres superuser):

```bash
psql -c "CREATE ROLE replyline_owner LOGIN PASSWORD 'choose-one'"
psql -c "CREATE ROLE replyline_app LOGIN PASSWORD 'choose-another' NOBYPASSRLS"
psql -c "CREATE DATABASE replyline OWNER replyline_owner"
```

```bash
npm run db:migrate          # create tables + row-level security
npm run db:seed             # optional: demo workspace
npm run dev                 # http://localhost:3000
npm run worker              # in a second terminal: background jobs
```

Demo sign-in after seeding: `demo@replyline.test` / `demo-password-123`.

Everything works with no external accounts: email is **simulated** (see the
in-app Outbox), AI is a **local mock**, billing is a **test provider**.

## Checks

```bash
npm run typecheck
npm run lint
npm test                    # 77 unit + integration tests (needs Postgres; uses <db>_test)
npm run build
npm run test:e2e            # browser journey; needs `npm start` running
```

## Documentation

| Doc | What's in it |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | **Start here.** What works, what's simulated, blockers, what needs you |
| [docs/PRD.md](docs/PRD.md) | Product requirements, MVP scope, segment choice, user journeys |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack decisions, modules, data model, job queue, tenancy |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, security review checklist |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | UK GDPR / PECR design and items needing legal review |
| [docs/SETUP.md](docs/SETUP.md) | Environment variables and local setup in detail |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Step-by-step: Resend, Anthropic, Stripe, inbound email |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting, worker, backups, monitoring, production checklist |
| [docs/COSTS.md](docs/COSTS.md) | Monthly running cost estimates and unit economics |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Prioritised next releases |
| [docs/VALIDATION.md](docs/VALIDATION.md) | How to find out if anyone will pay, before spending more |
