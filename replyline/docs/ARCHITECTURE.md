# Architecture

## Decisions and why

| Decision | Choice | Why (in plain English) | Alternative considered |
|---|---|---|---|
| Shape | **Modular monolith**: one Next.js app + one worker process, same codebase | One thing to deploy and debug. Modules have clear boundaries so they can be split later if ever needed. | Microservices — more cost and failure modes, no benefit at this size |
| Language | TypeScript everywhere | One language front and back; the compiler catches mistakes | — |
| Web framework | Next.js 16 (App Router, server actions), React 19 | Server-rendered pages, forms that work without JS, mature hosting options | Remix, separate SPA + API |
| Styling | Tailwind CSS 4 + a small in-house component set (`src/components/ui.tsx`) | Consistent look with no heavy UI dependency | shadcn/ui, MUI |
| Database | **PostgreSQL** (plain — works on Supabase, Neon, Railway, RDS…) | Row-level security, transactions, `SKIP LOCKED` queues. Not tied to one vendor. | Supabase-specific client (would tie auth + data to Supabase) |
| Data access | Drizzle ORM + hand-written SQL migrations for security policies | Type-safe queries, plain SQL migrations you can read | Prisma (less natural with RLS session variables) |
| Auth | Own email + password with scrypt, DB sessions (hashed tokens), HttpOnly cookies | Small, auditable, no third-party dependency for the core security boundary | Auth.js / Clerk / Supabase Auth — reasonable later, e.g. for Google sign-in |
| Background jobs | **Postgres-backed queue** (`jobs` table) + worker | Durable, no Redis to run or pay for, transactional with the data it schedules | pg-boss, BullMQ+Redis, Inngest |
| Time | Luxon, all scheduling in the business's timezone | Correct across the clock changes; tested | date-fns-tz |
| Validation | Zod at every boundary (forms, API, AI output) | One way to validate everything | — |
| Providers | Interfaces for email, AI, billing with simulated implementations | MVP runs with no accounts; real providers drop in | — |
| AI | Claude via the official Anthropic SDK, structured outputs | Schema-guaranteed JSON, strong instruction following | — |

## Module map

```
src/
  config/        plans.ts (prices, limits, features) · industries.ts (presets) · brand.ts
  lib/           db (pools, withTenant), env, crypto, time, csv, rate-limit, auth/session, actions
  modules/
    auth/        sign-up/in, sessions, permission matrix
    orgs/        workspaces, onboarding, settings, statuses
    contacts/    matching, normalisation, consent
    enquiries/   CRUD, listing, bulk, CSV; intake.ts = public form + inbound email
    templates/   rendering, validation, preview
    email/       provider interface (simulated, Resend), messages, approval, delivery, inbound
    ai/          provider interface (mock, Anthropic), prompts, schemas, output checks
    automation/  queue.ts (jobs), engine.ts (follow-ups), workflows.ts (settings, dry run)
    appointments/ booking, reminders, .ics
    reports/     weekly metrics + suggestions, schedule
    billing/     entitlements.ts (enforcement), service.ts (dev/Stripe, webhooks)
    compliance/  suppression, unsubscribe tokens, export, erasure, retention
    team/        members, invitations
    audit/       audit log
    dashboard/   dashboard metrics
  worker/        process.ts (job dispatch, tick) · run.ts (long-running worker)
  app/           pages, server actions, API routes
```

Rule: pages and API routes call module functions; modules never import from
`app/`. Every module function takes an `Actor` (`{orgId, userId, role}`) and
checks permissions itself.

## Tenancy: two database roles

- `replyline_app` — used by every web request. **Row-level security applies.**
  `withTenant(actor, fn)` opens a transaction and sets `app.org_id`; policies
  only expose rows with that `org_id`. Outside `withTenant`, tenant tables return
  nothing. It cannot read `users.password_hash`, `sessions`, `rate_limits` or
  `billing_events` at all.
- `replyline_owner` — owns the tables and bypasses RLS. Used only for:
  migrations, sign-in lookups, resolving a public form key, claiming jobs,
  Stripe webhooks, rate limiting, and the cross-tenant report scheduler. Each
  use filters explicitly.

So a forgotten `WHERE org_id = …` in application code returns no data rather
than another customer's data. `tests/integration/tenancy.test.ts` asserts RLS is
on for every table with an `org_id`.

## Data model (main tables)

```
organizations ─┬─ memberships ── users ── sessions
               ├─ pipeline_statuses
               ├─ contacts ─── enquiries ─┬─ notes
               │                          ├─ messages (outbound + inbound; idempotency_key unique per org)
               │                          ├─ activities (timeline)
               │                          └─ workflow_runs ── workflows
               ├─ appointments (version bumps on every change)
               ├─ email_templates
               ├─ suppressions (email hash + scope)
               ├─ jobs (durable queue; dedupe_key unique)
               ├─ reports (unique per period)
               ├─ usage_counters (org, YYYY-MM, metric)
               ├─ audit_logs
               ├─ invitations, custom_field_definitions, integrations (encrypted tokens)
platform: rate_limits, billing_events
```

Full definitions: `src/lib/db/schema.ts`. Migrations: `drizzle/` (0000 tables,
0001 row-level security).

## The follow-up engine

1. `createEnquiryTx` → `startEnquiryWorkflows`: for each enabled enquiry
   workflow whose conditions match, insert a `workflow_runs` row (unique per
   workflow+enquiry, so it can't start twice) and enqueue step 0 at
   `applyDelay(now, step.delay, businessHours, tz)`.
2. When due, `executeWorkflowStep` locks the run row, checks `next_step`
   matches (so a duplicate job is a no-op), then **re-evaluates stop rules
   against current data** — reply since start, team reply, booking, status,
   opt-out, closed.
3. Email steps render the template; any missing variable forces approval. The
   message's idempotency key is `wf:<run>:<step>`, so the same step can never
   create two messages.
4. Approval-required messages wait in Follow-ups; otherwise `email.send` is queued.
5. `deliverMessage` moves `queued → sending` with a compare-and-set, sends, then
   `sending → sent`. If a worker dies in between, the next attempt sees `sending`
   and marks it **uncertain** instead of risking a duplicate.

## Job queue

`jobs(status, run_at, attempts, max_attempts, dedupe_key, locked_at…)`.
Workers claim with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`.
Failure → retry at 30s, 1m, 2m, 4m… (capped 1h, jittered). After 5 attempts →
`dead`, an activity is logged, and it appears in Workflows → Automation health
with a Retry button. Stale `running` jobs (worker crash) are re-queued after 10
minutes. Run the worker as `npm run worker`, or call `/api/cron/tick` every
minute from a scheduler.

## Appointments and time

Reminders are scheduled per offset with the appointment's `version`. Any
reschedule or cancellation bumps the version; old reminder jobs find a
mismatch and do nothing. Whole-day offsets are calendar days in the local
timezone (a 10:00 appointment's "1 day before" is 10:00 the previous day, even
across a clock change). Times that don't exist (the skipped hour in March) are
rejected at entry.
