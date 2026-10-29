# Deployment

## Recommended first setup (simple, ~£30–60/month)

| Piece | Suggestion | Notes |
|---|---|---|
| Web app | Railway, Render or Fly.io (Node service: `npm run build` → `npm start`) | UK/EU region |
| Worker | Second service from the same repo: `npm run worker` | Always on, 1 small instance is plenty to start |
| Database | Managed Postgres (Railway/Render/Neon/Supabase) in UK/EU, with daily backups + PITR | Create the two roles (SETUP.md §2) |
| Email | Resend | INTEGRATIONS.md §1 |
| Errors | Sentry (free tier) | Scrub request bodies |
| Uptime | Better Stack / UptimeRobot on `/api/health` | |

**Vercel** also works for the web app; it has no always-on worker, so either run
the worker elsewhere or add a Vercel Cron hitting `/api/cron/tick` every minute
with `Authorization: Bearer $CRON_SECRET`.

## Release steps

1. Set environment variables for the environment (staging and production are separate projects with separate databases and keys).
2. `npm ci && npm run db:migrate` (with `DATABASE_OWNER_URL`).
3. Deploy web and worker.
4. Smoke test: `/api/health`, sign in, create an enquiry with your own email.

## Backups and recovery

- Enable daily automated backups and point-in-time recovery on the database.
- Monthly: restore the latest backup into a scratch database and run `npm test` against it (point `TEST_DATABASE_*` at it) to prove backups work.
- Recovery objective to aim for: lose ≤ 24h of data (RPO), back online ≤ 4h (RTO). Tighten with PITR.
- The job queue is in the database, so a restore restores scheduled follow-ups too. After a restore, check Automation health for anything stuck and messages in "uncertain".

## Monitoring

- `/api/health` every minute.
- Alert if the count of `jobs` with `status='dead'` grows, or `queued` jobs with `run_at` more than 10 minutes in the past exist (worker down):
  ```sql
  select count(*) from jobs where status='queued' and run_at < now() - interval '10 minutes';
  ```
- Watch email bounce/complaint rates in Resend; complaint rate over 0.1% needs action.

## Production checklist

- [ ] `APP_ENV=production`, `BILLING_PROVIDER=stripe` (dev billing refuses to run in production)
- [ ] `ENCRYPTION_KEY`, `CRON_SECRET`, `INBOUND_EMAIL_SECRET` are unique per environment
- [ ] App role is `NOBYPASSRLS` and not the table owner
- [ ] HTTPS only; `APP_URL` uses https
- [ ] Backups + restore tested
- [ ] Legal pages replaced (COMPLIANCE.md)
- [ ] SECURITY.md pre-launch checklist done
- [ ] Support inbox monitored (`BRAND.supportEmail` in `src/config/brand.ts`)

## Support and administration

Today, support runs through the database owner role (read-only queries) and the
in-app audit log. A platform-admin screen is on the roadmap; `users.is_platform_admin`
exists for it.
