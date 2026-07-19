# AGENTS.md

Project overview, standard commands, and architecture live in `README.md`. Read
it first. This file adds agent-specific, non-obvious guidance.

## Cursor Cloud specific instructions

### Services

There is a single service: one Cloudflare Worker that serves both the React SPA
and the `/api` (Hono) endpoints, backed by local Cloudflare D1, a Queue + DLQ,
and a Cron trigger. Everything runs inside `npm run dev` (Vite + the Cloudflare
plugin / Miniflare) on `http://localhost:5173`.

### Running & testing (see README for the full command list)

- Start dev: `npm run dev` (port 5173). Lint/typecheck/test/build: `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Before the app works locally you MUST apply migrations to the local D1:
  `npm run db:migrate:local`. Without this, every `/api` call that touches the DB
  fails. Optionally `npm run db:seed:local` to populate the address allowlist so
  onboarding has something to search.

### Non-obvious gotchas

- **Local auth uses dev-auth, not Google.** `DEV_AUTH=true` (default local var)
  exposes `POST /api/auth/dev/login` and a "Developer sign-in" form. Real Google
  OAuth requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` and is only used when
  `DEV_AUTH=false`. Do not expect to test Google OAuth locally without real creds.
- **First admin is automatic.** Signing in with an email in
  `BOOTSTRAP_ADMIN_EMAILS` (default `admin@example.com`) is elevated to admin +
  approved, but only while zero admins exist. After that it never re-elevates.
- **CSRF is same-origin only.** Every mutating (`POST/PUT/PATCH/DELETE`) request
  must send an `Origin` (or `Referer`) matching `APP_BASE_URL`
  (`http://localhost:5173` locally). `curl` does not do this by default — pass
  `-H "Origin: http://localhost:5173"` or you'll get HTTP 403.
- **Timezone matters for "today".** The calendar's `today` is computed in the
  community timezone (default `America/Denver`), so it can differ from the VM's
  UTC date by a day. Use the `today`/`days` values returned by `/api/calendar`
  rather than assuming UTC when scripting bookings.
- **Email delivery is asynchronous.** Admin cancel commits a `pending` row in
  `outbound_email_jobs` (source of truth) and enqueues delivery. The queue
  consumer runs on the batch timeout (~5s locally) and flips the row to `sent`;
  don't assert `sent` immediately after cancelling. Locally `EMAIL_PROVIDER=console`
  just logs the email to the dev server output.
- **Tests use a separate Wrangler config.** `@cloudflare/vitest-pool-workers`
  cannot parse the `assets` block, so tests point at `wrangler.test.jsonc`
  (no assets, no queue consumers). If you add bindings/vars the worker needs at
  runtime, mirror them there too. Migrations are auto-applied to the test D1 via
  `test/apply-migrations.ts`.
- **Regenerate types after editing `wrangler.jsonc`:** `npm run cf-typegen`
  (writes `worker-configuration.d.ts`, which is committed). Secret bindings are
  declared separately in `src/worker/secrets.d.ts`.
