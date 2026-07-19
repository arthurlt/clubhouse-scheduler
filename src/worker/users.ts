import type { SessionUser, UserStatus } from "../shared/types";
import { newId, nowIso } from "./util";
import { writeAudit } from "./audit";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  status: UserStatus;
  is_admin: number;
  address_id: string | null;
  rejection_reason: string | null;
  address_label: string | null;
}

export function rowToSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    status: row.status,
    isAdmin: row.is_admin === 1,
    addressId: row.address_id,
    addressLabel: row.address_label,
    rejectionReason: row.rejection_reason,
  };
}

export async function getUserById(env: Env, id: string): Promise<SessionUser | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, u.status, u.is_admin, u.address_id,
            u.rejection_reason, a.label AS address_label
     FROM users u LEFT JOIN addresses a ON a.id = u.address_id
     WHERE u.id = ?`,
  )
    .bind(id)
    .first<UserRow>();
  return row ? rowToSessionUser(row) : null;
}

// Upsert a user by identity provider subject. For dev-auth we key by email only.
export async function upsertUser(
  env: Env,
  params: {
    provider: string;
    subject: string;
    email: string;
    name: string | null;
    picture: string | null;
  },
): Promise<string> {
  const email = params.email.toLowerCase();
  const existingByProvider = await env.DB.prepare(
    "SELECT user_id FROM oauth_accounts WHERE provider = ? AND subject = ?",
  )
    .bind(params.provider, params.subject)
    .first<{ user_id: string }>();

  if (existingByProvider) {
    await env.DB.prepare(
      "UPDATE users SET name = ?, picture = ?, updated_at = ? WHERE id = ?",
    )
      .bind(params.name, params.picture, nowIso(), existingByProvider.user_id)
      .run();
    return existingByProvider.user_id;
  }

  const existingByEmail = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  let userId: string;
  if (existingByEmail) {
    userId = existingByEmail.id;
    await env.DB.prepare(
      "UPDATE users SET name = ?, picture = ?, updated_at = ? WHERE id = ?",
    )
      .bind(params.name, params.picture, nowIso(), userId)
      .run();
  } else {
    userId = newId();
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, picture, status, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
      .bind(userId, email, params.name, params.picture, now, now)
      .run();
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO oauth_accounts (provider, subject, user_id, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(params.provider, params.subject, userId, nowIso())
    .run();

  return userId;
}

// One-time first-admin bootstrap: elevate an allowlisted email ONLY while zero
// admins exist. Never re-elevates, and never elevates a suspended user.
export async function maybeBootstrapAdmin(env: Env, userId: string): Promise<void> {
  const bootstrapEmails = (env.BOOTSTRAP_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (bootstrapEmails.length === 0) return;

  const user = await env.DB.prepare(
    "SELECT email, status, is_admin FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ email: string; status: UserStatus; is_admin: number }>();
  if (!user) return;
  if (user.status === "suspended") return;
  if (!bootstrapEmails.includes(user.email.toLowerCase())) return;

  const admins = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE is_admin = 1",
  ).first<{ n: number }>();
  if ((admins?.n ?? 0) > 0) return; // an admin already exists; never re-elevate

  await env.DB.prepare(
    "UPDATE users SET is_admin = 1, status = 'approved', updated_at = ? WHERE id = ?",
  )
    .bind(nowIso(), userId)
    .run();
  await writeAudit(env, {
    actorUserId: null,
    action: "admin.bootstrap",
    targetType: "user",
    targetId: userId,
    detail: { email: user.email },
  });
}
