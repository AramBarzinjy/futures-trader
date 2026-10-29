# Local setup in detail

## 1. Prerequisites

- Node.js 22 or newer (`node -v`)
- PostgreSQL 14+ running locally (macOS: Postgres.app or `brew install postgresql@16`; Windows: the EDB installer)

## 2. Database

Two roles are required (see ARCHITECTURE.md → Tenancy). As a superuser:

```sql
CREATE ROLE replyline_owner LOGIN PASSWORD 'owner-password';
CREATE ROLE replyline_app   LOGIN PASSWORD 'app-password' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE replyline      OWNER replyline_owner;
CREATE DATABASE replyline_test OWNER replyline_owner;   -- for npm test
```

The app role **must** be named `replyline_app` (migrations grant to that name).

On **Supabase**: run the same `CREATE ROLE` statements in the SQL editor, use the
database's own owner for `DATABASE_OWNER_URL`, and connect `DATABASE_URL` as
`replyline_app`. Use the session-mode pooler or direct connection (transaction-mode
pooling is fine too: every tenant setting is transaction-scoped).

## 3. Environment

`cp .env.example .env`, then:

| Variable | Required | Notes |
|---|---|---|
| `APP_ENV` | yes | `development` locally; `production` on the live site |
| `APP_URL` | yes | Used in links in emails |
| `DATABASE_OWNER_URL` / `DATABASE_URL` | yes | The two roles above |
| `ENCRYPTION_KEY` | yes | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | if using `/api/cron/tick` | Any long random string |
| `INBOUND_EMAIL_SECRET` | if using inbound email | Any long random string |
| `EMAIL_PROVIDER`, `ALLOW_REAL_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | for real email | INTEGRATIONS.md §1 |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | for real AI | INTEGRATIONS.md §2 |
| `BILLING_PROVIDER`, `STRIPE_*` | for real payments | INTEGRATIONS.md §3 |

Never commit `.env` (it's in `.gitignore`). Keep separate values for
development, staging and production.

## 4. Run

```bash
npm install
npm run db:migrate
npm run db:seed        # optional demo data
npm run dev            # web app on :3000
npm run worker         # background jobs (follow-ups, reminders, reports)
```

Without the worker, emails you send or approve still go out (the app processes
due jobs straight after those actions), but *delayed* follow-ups, reminders and
weekly reports only run while a worker (or the cron endpoint) is running.

## 5. Tests

`npm test` rebuilds `<your database>_test` from the migrations and runs 77 tests.
It refuses to reset any database whose name doesn't end in `_test`.

For the browser test: `npm run build && npm start`, then `npm run test:e2e`.
It needs Chromium + Playwright installed globally (`npx playwright install chromium` if not).

## 6. Changing the schema

Edit `src/lib/db/schema.ts`, then `npm run db:generate` to create a migration in
`drizzle/`, review the SQL, and `npm run db:migrate`. **Any new table with an
`org_id` must get RLS policies** in a migration (copy the pattern in
`drizzle/0001_rls.sql`) and be added to `TENANT_TABLES` — a test fails if you forget.
