-- Initial schema for the clubhouse scheduler.
-- All timestamps are stored as ISO-8601 UTC strings. Calendar days are stored
-- as community-timezone civil dates (YYYY-MM-DD), never UTC instants.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended','rejected')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  address_id TEXT REFERENCES addresses(id),
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- hash of the session secret (never the secret itself)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Server-side binding of OAuth state to the PKCE code_verifier.
CREATE TABLE auth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Allowlist of addresses eligible for membership.
CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- One occupied civil day, regardless of whether it is a booking or an admin block.
CREATE TABLE calendar_days (
  day TEXT PRIMARY KEY,          -- YYYY-MM-DD
  kind TEXT NOT NULL CHECK (kind IN ('booking','block')),
  ref_id TEXT NOT NULL,          -- bookings.id or blocked_dates.id
  created_at TEXT NOT NULL
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  address_id TEXT REFERENCES addresses(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_reason TEXT,
  cancelled_by_admin INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_by_admin IN (0,1))
);
CREATE INDEX idx_bookings_user ON bookings(user_id);
-- Partial unique index: at most one ACTIVE booking per day. Cancelled history
-- does not block rebooking the same day.
CREATE UNIQUE INDEX idx_bookings_active_day ON bookings(day) WHERE status = 'active';

CREATE TABLE blocked_dates (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL UNIQUE,
  message TEXT,                  -- public block message shown on the calendar
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  day TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

-- Source-of-truth outbox for outbound email. The queue is a delivery mechanism;
-- this table is authoritative for delivery status.
CREATE TABLE outbound_email_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT
);
CREATE INDEX idx_email_jobs_status ON outbound_email_jobs(status, created_at);

CREATE TABLE community_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL,
  horizon_days INTEGER NOT NULL
);

-- Append-only audit trail.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- Simple durable rate-limit counters (fixed window).
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);
