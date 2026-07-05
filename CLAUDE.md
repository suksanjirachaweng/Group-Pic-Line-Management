# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Multi-tenant admin webapp for managing LINE-based group-photo registration across several
universities. Students register via a LINE LIFF form (not a Google Form), and admins define
condition-based rules that auto-send LINE messages. See `README.md` for the product overview
and the required manual external setup (LINE channels, LIFF apps, Neon, Google service account).

## Commands

```bash
npm run dev          # dev server (Next.js 16 + Turbopack) on :3000
npm run build        # production build (also runs full TypeScript typecheck)
npm run lint         # eslint — must pass clean before considering work done
npm run db:seed      # bootstrap a SUPERADMIN from SEED_ADMIN_EMAIL/PASSWORD (defaults admin@example.com / changeme123)

npx prisma migrate dev --name <name>   # create + apply a migration against DATABASE_URL
npx prisma generate                    # regenerate the client into src/generated/prisma (gitignored — run after clone)
```

There is **no automated test suite**. Verify changes by running the app and exercising the
real flow (the dev/preview server + `psql` against the local DB), or with a throwaway
`tsx some-script.ts` that imports from `@/lib/...`.

### Local Postgres (Homebrew, macOS)

`DATABASE_URL` points at a local Postgres db (`grouppic_dev`). Start the server with `LC_ALL`
set, or it fails with "postmaster became multithreaded":

```bash
LC_ALL="en_US.UTF-8" /usr/local/opt/postgresql@16/bin/pg_ctl \
  -D /usr/local/var/postgresql@16 -l /usr/local/var/log/postgresql@16.log start
```

## Critical gotchas

- **Never `rm -rf .next` while the dev server is running** — it corrupts the Turbopack cache
  and the server starts throwing `ENOENT`/`MODULE_NOT_FOUND`. Stop the server first, then clean.
- **Middleware lives in `src/proxy.ts`, not `middleware.ts`** — Next.js 16 renamed the
  convention. It only gates `/admin/*` at the auth level (redirect to `/login`).
- **Prisma client is custom-generated to `src/generated/prisma`** (gitignored). Import
  `PrismaClient` from `@/generated/prisma/client`, enum values/types from
  `@/generated/prisma/enums`, and the `Prisma` namespace (for `PrismaClientKnownRequestError`,
  `Prisma.JsonNull`) from `@/generated/prisma/client`. The shared singleton is `@/lib/prisma`
  and uses the `PrismaPg` driver adapter, so the same code runs against local Postgres and Neon.
- **The admin UI is light-theme only** with hardcoded Tailwind light backgrounds; `globals.css`
  pins dark text + a light background and sets explicit form-control colors (do not reintroduce
  a `prefers-color-scheme: dark` block — it made input text invisible).

## Architecture

### Multi-tenancy & channels

`University` ⇄ `Channel` is many-to-many through `UniversityChannelPool` (one channel can serve
several universities and vice-versa). A "Channel" is one LINE **Messaging API channel** — LINE
billing/quota is per-channel (the LINE *provider* is irrelevant), so the app spreads volume
across each channel's free tier. `monthlyFreeQuota` is admin-configurable per channel (LINE's
numbers change) and usage is tracked monthly in `ChannelUsageCounter` (`yearMonth` = `"YYYY-MM"`,
see `lib/quota.ts`). Channel access token + secret are encrypted at rest via `lib/crypto.ts`
(AES-256-GCM keyed off `ENCRYPTION_KEY`) and never rendered back to the UI.

### Registration flow (LIFF)

1. `app/register/[slug]/route.ts` — server redirect handler. Picks the pool channel with the
   most free-tier headroom this month (`pickChannelForUniversity` in `lib/quota.ts`), pins the
   choice in a short-lived cookie so a refresh doesn't re-roll, then 302s to
   `https://liff.line.me/<liffId>?university=<slug>&liffId=<liffId>`. **Distribute this link only
   through LINE-native surfaces** (rich menu / template button / in-app QR) — opening it outside
   LINE is unreliable and out of scope.
2. `app/liff/register/` — client page (`LiffRegisterClient.tsx` wrapped in Suspense because it
   uses `useSearchParams`). Runs `liff.init`/`getProfile`/`getFriendship`, fetches the dynamic
   field list, submits to `/api/register`.
3. `app/api/register/route.ts` — validates the channel belongs to the university's active pool,
   enforces required fields, **strips any keys not defined in `FormFieldDefinition`**, upserts
   the `Registrant` on `(universityId, lineUserId)`, then best-effort fires on-registration rules.

`Registrant.data` is a JSONB blob keyed by `FormFieldDefinition.key` (fields differ per
university), validated in the API layer, never by the DB. New universities are seeded with a
default field set mirroring the original Google Form (`DEFAULT_FORM_FIELDS` in
`lib/actions/universities.ts`).

### Rule engine & message pipeline (decoupled)

- `lib/rules/evaluate.ts` — pure recursive AND/OR condition-tree interpreter + `{{field}}`
  template interpolation. No dynamic SQL.
- Triggers: `lib/rules/trigger.ts` (`ON_REGISTRATION`, called from `/api/register`) and
  `lib/rules/scheduledTick.ts` (`SCHEDULED_TICK`, date-relative reminders via
  `scheduleConfig.{relativeToField,offsetMinutes}`).
- **Idempotency is enforced only** by the `RuleExecution` unique `(ruleId, registrantId)` +
  catching Prisma `P2002` — never a check-then-insert. A matched rule enqueues a `MessageJob`.
- `MessageJob` is a DB-backed queue (no external queue service). `app/api/cron/process-message-jobs`
  claims a batch with raw `FOR UPDATE SKIP LOCKED`, checks quota (`ChannelUsageCounter` vs
  `monthlyFreeQuota`/`allowOverage`), pushes via `lib/line.ts`, then updates job +
  `RuleExecution` + writes `MessageLog` + increments the usage counter in one transaction.
  Manual admin sends flow through the same `MessageJob` table with `source=MANUAL` (no
  `ruleExecutionId`). Throughput ≈ 50 msgs/min at `BATCH_SIZE=50` + 1-min cron; tune those
  before reaching for a real queue.

### Cron & webhooks

- Cron routes are guarded by `lib/cronAuth.ts` (`CRON_SECRET` bearer token; open when unset
  for local dev): `process-message-jobs` (target: 1 min), `evaluate-scheduled-rules` (15 min),
  `sync-sheets` (hourly). **Not scheduled via `vercel.json`** — Vercel's Hobby plan caps its
  own cron feature at once/day, which is too coarse for `process-message-jobs`. Instead an
  external scheduler (e.g. cron-job.org) hits each route on the target cadence with header
  `Authorization: Bearer <CRON_SECRET>`. Revisit `vercel.json` crons if the project ever
  upgrades to Vercel Pro.
- `app/api/webhook/[channelId]/route.ts` verifies `x-line-signature` against **that specific
  channel's own decrypted secret** (looked up by URL param — not a single global secret) and
  keeps `Registrant.isFriend` in sync on follow/unfollow.
- `lib/sheets.ts` is a one-way DB→Sheet mirror (full overwrite per university, single batched
  write); the Sheet is a read-only reporting view, the DB is the source of truth.

### Auth & authorization (two layers, both required)

NextAuth v4 Credentials, JWT sessions carrying `role` (`SUPERADMIN` / `UNIVERSITY_ADMIN`) and
`universityIds` (see `lib/auth.ts`, types in `src/types/next-auth.d.ts`). Every admin **page**
must gate access itself (`getServerSession` + `canAccessUniversity`/role check → `redirect` or
`notFound`), AND every **server action** in `lib/actions/*` must call `requireSuperadmin` /
`requireUniversityAccess` from `lib/authz.ts`. Page guards alone are not enough — actions are
independently invokable.
