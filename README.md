# clubhouse-scheduler

Mobile-first HOA clubhouse scheduler. A React SPA and a TypeScript API run in a
single Cloudflare Worker, backed by Cloudflare D1, with a Queue + dead-letter
queue and a Cron trigger for reliable outbound email.

Members reserve the clubhouse for a full day; the HOA board manages membership,
blocks dates, and cancels/rebooks when needed.

## Tech stack

- **Runtime:** one Cloudflare Worker serving both UI and `/api`
- **Frontend:** React 19 + Vite 7 + React Router (`src/react-app`)
- **API:** Hono (`src/worker`)
- **Data:** Cloudflare D1 (SQLite) with numbered migrations (`migrations/`)
- **Email:** `outbound_email_jobs` outbox → Cloudflare Queue → Resend, with a
  dead-letter queue and a Cron sweeper
- **Tooling:** TypeScript, ESLint, Vitest (`@cloudflare/vitest-pool-workers`)

## Quick start (local development)

```bash
npm install
cp .dev.vars.example .dev.vars        # secrets for local dev (safe defaults)
npm run db:migrate:local              # apply D1 migrations to the local database
npm run db:seed:local                 # seed the address allowlist (optional)
npm run dev                           # http://localhost:5173
```

Local dev uses **dev-auth** (`DEV_AUTH=true`): the sign-in page shows a
"Developer sign-in" form that creates a session for any email, bypassing Google.
The email listed in `BOOTSTRAP_ADMIN_EMAILS` (default `admin@example.com`)
becomes the first admin automatically on first sign-in.

### Common scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (Worker + SPA) on port 5173 |
| `npm run build` | Type-check and build the client + Worker bundle |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Vitest (domain + Worker integration tests) |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run db:seed:local` | Seed the address allowlist locally |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` |

## Architecture notes

- The Worker exports `fetch` (Hono), `queue` (email delivery + DLQ), and
  `scheduled` (Cron outbox sweeper).
- `assets.run_worker_first = ["/api/*"]` so the API is served by the Worker and
  everything else falls back to the SPA (`not_found_handling = "single-page-application"`).
- Calendar days are stored as community-timezone civil dates (`YYYY-MM-DD`).
  `calendar_days` enforces one occupied day (booking **or** block); a partial
  unique index keeps cancelled bookings from blocking rebooking.
- Admin cancel is transactional: it cancels the booking, frees the day, writes an
  in-app notification, and inserts a **pending** outbox row in a single D1
  `batch()`. The queue send happens after commit; the Cron sweeper re-enqueues
  stuck pending rows; the DLQ consumer marks permanently failed rows so admins
  can resend.

## Environments & deployment

Staging and production are separate Wrangler environments with distinct Worker
names, D1 databases, and queues (see `wrangler.jsonc`).

```bash
# One-time per environment: create D1 + queues, paste database_id into
# env.staging / env.production in wrangler.jsonc (not the top-level block),
# and set secrets (SESSION_SECRET, GOOGLE_CLIENT_SECRET, RESEND_API_KEY):
wrangler d1 create clubhouse_scheduler_staging   # skip if it already exists
wrangler d1 info clubhouse_scheduler_staging     # copy database_id into wrangler.jsonc
wrangler queues create clubhouse-email-staging
wrangler queues create clubhouse-email-dlq-staging
wrangler secret put SESSION_SECRET --env staging
wrangler secret put GOOGLE_CLIENT_SECRET --env staging
wrangler secret put RESEND_API_KEY --env staging

npm run db:migrate:staging
npm run deploy:staging
```

Production migrations must be **expand-only / backward-compatible**. Capture a D1
Time Travel bookmark before every staging/production migrate.

## Operational runbooks

- **First-admin bootstrap:** set `BOOTSTRAP_ADMIN_EMAILS`; the first sign-in with
  that email is elevated only while zero admins exist. Promote a second board
  member via **Admin → Members → Make admin** before go-live. The last admin
  cannot be demoted/suspended.
- **Approve / reject members:** Admin → Approvals.
- **Suspend a member:** Admin → Members → Suspend (existing future bookings
  remain until an admin cancels them).
- **Cancel + rebook:** Admin → Bookings → Cancel (sends notification + email with
  a rebook link). Members rebook via the in-app link.
- **Email failure resend:** Admin → Email → Resend (re-enqueues the outbox row).
- **Rollback:** app-only issues → roll back the Worker version; bad
  migration/data → restore via D1 Time Travel to the pre-migrate bookmark.
