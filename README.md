# Group Pic Registration — LINE Bot Management Webapp

Admin webapp for managing LINE-based group-photo registration across multiple
universities: a LIFF registration form (replacing Google Forms), a rule engine
that auto-sends LINE messages based on admin-defined conditions, multi-channel
LINE support to spread message volume across several channels' free tiers, and
a one-way export mirror to each university's Google Sheet.

See the full architecture/plan this was built from for context on *why* things
are structured this way (channel-pool routing, idempotent rule engine, DB as
source of truth vs. Sheets as a read-only mirror, etc.).

## Prerequisites

- Node.js 20+
- A Postgres database (local for dev, [Neon](https://neon.tech) recommended for
  production via Vercel's Neon integration)

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up a local Postgres database. If you don't already have one:
   ```bash
   brew install postgresql@16
   LC_ALL="en_US.UTF-8" /usr/local/opt/postgresql@16/bin/pg_ctl \
     -D /usr/local/var/postgresql@16 -l /usr/local/var/log/postgresql@16.log start
   /usr/local/opt/postgresql@16/bin/createdb grouppic_dev
   ```

3. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (and generate real
   values for `NEXTAUTH_SECRET` / `ENCRYPTION_KEY` — see comments in the file):
   ```bash
   cp .env.example .env
   ```

4. Run migrations and generate the Prisma client:
   ```bash
   npx prisma migrate dev
   ```

5. Seed a superadmin account (reads `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
   from `.env`, defaults to `admin@example.com` / `changeme123`):
   ```bash
   npm run db:seed
   ```

6. Start the dev server:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000/login` and sign in with the seeded account.

## Manual setup required outside this codebase

These are one-time steps the operator (not the app) must do per environment:

- **Database (production)**: provision a Neon Postgres database via Vercel's
  dashboard (Storage → create → Neon). Use the pooled connection string as
  `DATABASE_URL` to avoid serverless connection exhaustion.
- **Per LINE channel** (each university may share a channel with others, or
  have its own — see the `Channel` / `UniversityChannelPool` admin screens):
  1. Create a Messaging API channel in the [LINE Developers Console](https://developers.line.biz/console/).
  2. Register a LIFF app under that channel pointing its endpoint URL at
     `https://<your-deployment>/liff/register` (all channels share this same
     endpoint URL — the LIFF ID passed in the query string is what
     distinguishes which channel a registrant is bound to).
  3. Copy the channel access token, channel secret, and LIFF ID into this
     app's Channel admin screen (`/admin/channels/new`) — they're encrypted
     at rest using `ENCRYPTION_KEY` before being stored. Note the generated
     channel's id (from the URL of its detail page, `/admin/channels/<id>`).
  4. In the LINE Developers Console, set that channel's webhook URL to
     `https://<your-deployment>/api/webhook/<channel-id>` (the app's own
     internal id from the previous step, not LINE's channel id) and enable
     webhooks. This keeps `Registrant.isFriend` in sync when someone
     follows/unfollows or blocks the OA.
  5. Distribute the registration link for each university as
     `https://<your-deployment>/register/<university-slug>` **only through
     LINE-native surfaces** (OA rich menu, a template message button, or a QR
     code scanned via LINE's in-app scanner) — opening it from outside the
     LINE app isn't guaranteed to work (see the plan for details) and is out
     of scope for v1.
- **Per university Google Sheet**: create the sheet, then share it with your
  Google service account's email as Editor. The service account JSON key goes
  in `GOOGLE_SERVICE_ACCOUNT_JSON`. Then set the sheet's ID (from its URL) in
  the university's admin page under "Google Sheet export" — this is a
  **one-way, read-only mirror**: the app's database is the source of truth,
  and the sheet is fully overwritten on every sync. Anyone editing the sheet
  directly will have their changes silently discarded on the next sync.
- **Cron workers** (all scheduled via `vercel.json`, protect with
  `CRON_SECRET` in production so only Vercel's invocations are accepted):
  - `/api/cron/process-message-jobs` (every minute) — drains queued messages
    (from rules or manual sends) and pushes them via each registrant's bound
    LINE channel.
  - `/api/cron/evaluate-scheduled-rules` (every 15 min) — fires
    date-relative reminder rules (e.g. "1 day before photo slot"). Load-tested
    against 4,000 synthetic registrants: matching + enqueueing all 4,000 took
    ~11s (well within a serverless function timeout), and a repeat run
    correctly matched 0 (idempotent).
  - Throughput note: draining measured ~350-400ms/message in practice
    (dominated by the LINE API round-trip), i.e. ~50 messages/minute at the
    current `BATCH_SIZE=50` + 1-run/minute cron cadence — a full 4,000-message
    burst (e.g. a reminder rule firing for an entire university at once) would
    take roughly 80 minutes to fully drain. That's fine for non-urgent
    reminders; if faster delivery is ever needed, raise `BATCH_SIZE` in
    `app/api/cron/process-message-jobs/route.ts` and/or the cron frequency in
    `vercel.json` before introducing an external queue.
  - `/api/cron/sync-sheets` (hourly) — pushes the latest registrant data to
    each configured Google Sheet.

## Project structure

- `prisma/schema.prisma` — full data model (universities, channels, channel
  pools, registrants, rules, message jobs/logs, admin users, sheet export
  config).
- `src/lib/prisma.ts` — shared Prisma client (uses the `pg` driver adapter, so
  it works against both local Postgres and Neon without code changes).
- `src/lib/crypto.ts` — AES-256-GCM helpers for encrypting LINE channel
  secrets and the Google service account key at rest.
- `src/lib/auth.ts` — NextAuth Credentials config; sessions carry `role`
  (`SUPERADMIN` / `UNIVERSITY_ADMIN`) and `universityIds` for scoping.
- `src/app/admin/` — admin dashboard (gated by `src/proxy.ts`, the Next.js 16
  middleware/proxy convention).
- `src/app/login/` — admin login page.

## Deploying

Deploy to Vercel as usual (`vercel` CLI or Git integration). Set the same env
vars from `.env` in the Vercel project settings, using the Neon pooled
connection string for `DATABASE_URL`.
