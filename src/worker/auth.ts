import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "./context";
import type { SessionUser, UserStatus } from "../shared/types";
import { addSeconds, newId, nowIso, randomToken, sha256Hex } from "./util";

const IDLE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days idle
const ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days absolute

function isHttps(env: Env): boolean {
  return (env.APP_BASE_URL || "").startsWith("https://");
}

function cookieName(env: Env): string {
  // __Host- prefix requires Secure + Path=/ + host-only, which needs https.
  return isHttps(env) ? "__Host-session" : "session";
}

export function setSessionCookie(c: Context<HonoEnv>, secret: string): void {
  const secure = isHttps(c.env);
  setCookie(c, cookieName(c.env), secret, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: ABSOLUTE_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, cookieName(c.env), { path: "/" });
}

// Create a session, storing only the hash of the secret. Returns the secret to
// place in the cookie.
export async function createSession(env: Env, userId: string): Promise<string> {
  const secret = randomToken(32);
  const id = await sha256Hex(secret);
  const now = new Date();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      now.toISOString(),
      now.toISOString(),
      addSeconds(now, ABSOLUTE_TTL_SECONDS).toISOString(),
    )
    .run();
  return secret;
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function revokeAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

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

function toSessionUser(row: UserRow): SessionUser {
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

// Loads the session user from the request cookie. Enforces absolute + idle TTL,
// updates last_seen_at, and returns null when unauthenticated/expired.
export const loadUser: MiddlewareHandler<HonoEnv> = async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);

  const secret = getCookie(c, cookieName(c.env));
  if (secret) {
    const sessionId = await sha256Hex(secret);
    const session = await c.env.DB.prepare(
      "SELECT id, user_id, last_seen_at, expires_at FROM sessions WHERE id = ?",
    )
      .bind(sessionId)
      .first<{ id: string; user_id: string; last_seen_at: string; expires_at: string }>();

    if (session) {
      const now = new Date();
      const absoluteOk = new Date(session.expires_at) > now;
      const idleOk =
        new Date(session.last_seen_at).getTime() + IDLE_TTL_SECONDS * 1000 > now.getTime();

      if (!absoluteOk || !idleOk) {
        await revokeSession(c.env, sessionId);
        clearSessionCookie(c);
      } else {
        const row = await c.env.DB.prepare(
          `SELECT u.id, u.email, u.name, u.picture, u.status, u.is_admin, u.address_id,
                  u.rejection_reason, a.label AS address_label
           FROM users u LEFT JOIN addresses a ON a.id = u.address_id
           WHERE u.id = ?`,
        )
          .bind(session.user_id)
          .first<UserRow>();
        if (row) {
          await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
            .bind(nowIso(), sessionId)
            .run();
          c.set("user", toSessionUser(row));
          c.set("sessionId", sessionId);
        }
      }
    }
  }

  await next();
};

// CSRF defense: same-origin only for mutating requests.
export const csrfProtection: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  const appOrigin = new URL(c.env.APP_BASE_URL).origin;
  const origin = c.req.header("Origin");
  const referer = c.req.header("Referer");
  const candidate = origin ?? (referer ? new URL(referer).origin : null);
  if (candidate !== appOrigin) {
    return c.json({ error: "csrf", message: "Cross-origin request rejected" }, 403);
  }
  return next();
};

export function requireUser(c: Context<HonoEnv>): SessionUser {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in required");
  return user;
}

export function requireApproved(c: Context<HonoEnv>): SessionUser {
  const user = requireUser(c);
  if (user.status !== "approved") {
    throw new HttpError(403, "not_approved", "Your membership is not approved");
  }
  return user;
}

export function requireAdmin(c: Context<HonoEnv>): SessionUser {
  const user = requireUser(c);
  if (!user.isAdmin || user.status !== "approved") {
    throw new HttpError(403, "forbidden", "Admin access required");
  }
  return user;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Reloads the user row after a role/status change and rotates the session so the
// new privileges take effect immediately.
export async function rotateSession(
  c: Context<HonoEnv>,
  userId: string,
): Promise<void> {
  const oldSessionId = c.get("sessionId");
  if (oldSessionId) await revokeSession(c.env, oldSessionId);
  const secret = await createSession(c.env, userId);
  setSessionCookie(c, secret);
  const newId = await sha256Hex(secret);
  c.set("sessionId", newId);
}

export { newId };
