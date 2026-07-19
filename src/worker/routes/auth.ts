import { Hono } from "hono";
import type { HonoEnv } from "../context";
import type { MeResponse } from "../../shared/types";
import {
  clearSessionCookie,
  createSession,
  requireUser,
  revokeSession,
  setSessionCookie,
} from "../auth";
import { getSettings } from "../settings";
import { checkRateLimit } from "../ratelimit";
import { addSeconds, pkceChallenge, randomToken, readJson } from "../util";
import { getUserById, maybeBootstrapAdmin, upsertUser } from "../users";

const auth = new Hono<HonoEnv>();

auth.get("/me", async (c) => {
  const settings = await getSettings(c.env);
  const body: MeResponse = {
    user: c.get("user"),
    devAuth: c.env.DEV_AUTH === "true",
    timezone: settings.timezone,
    horizonDays: settings.horizonDays,
  };
  return c.json(body);
});

auth.post("/logout", async (c) => {
  const sessionId = c.get("sessionId");
  if (sessionId) await revokeSession(c.env, sessionId);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// Revoke all sessions for the current user.
auth.post("/logout-all", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// ---- Google OAuth (confidential client + PKCE) ----

auth.get("/google/start", async (c) => {
  const ok = await checkRateLimit(c.env, `oauth-start:${clientIp(c)}`, 30, 60);
  if (!ok) return c.json({ error: "rate_limited" }, 429);

  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const challenge = await pkceChallenge(codeVerifier);
  const now = new Date();
  await c.env.DB.prepare(
    `INSERT INTO auth_states (state, code_verifier, redirect_to, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      state,
      codeVerifier,
      c.req.query("redirect_to") ?? "/",
      now.toISOString(),
      addSeconds(now, 600).toISOString(),
    )
    .run();

  const redirectUri = `${new URL(c.env.APP_BASE_URL).origin}/api/auth/google/callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");
  return c.redirect(authUrl.toString());
});

auth.get("/google/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!state || !code) return c.redirect("/?auth_error=missing_params");

  const stateRow = await c.env.DB.prepare(
    "SELECT code_verifier, redirect_to, expires_at FROM auth_states WHERE state = ?",
  )
    .bind(state)
    .first<{ code_verifier: string; redirect_to: string | null; expires_at: string }>();
  // single-use
  await c.env.DB.prepare("DELETE FROM auth_states WHERE state = ?").bind(state).run();
  if (!stateRow || new Date(stateRow.expires_at) < new Date()) {
    return c.redirect("/?auth_error=bad_state");
  }

  const redirectUri = `${new URL(c.env.APP_BASE_URL).origin}/api/auth/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      code_verifier: stateRow.code_verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return c.redirect("/?auth_error=token_exchange");
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return c.redirect("/?auth_error=no_id_token");

  const claims = decodeJwtPayload(tokens.id_token);
  if (!claims || claims.aud !== c.env.GOOGLE_CLIENT_ID || !claims.sub) {
    return c.redirect("/?auth_error=bad_token");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return c.redirect("/?auth_error=email_unverified");
  }

  const userId = await upsertUser(c.env, {
    provider: "google",
    subject: String(claims.sub),
    email: String(claims.email),
    name: (claims.name as string) ?? null,
    picture: (claims.picture as string) ?? null,
  });
  await maybeBootstrapAdmin(c.env, userId);

  const secret = await createSession(c.env, userId);
  setSessionCookie(c, secret);
  return c.redirect(safeRedirect(stateRow.redirect_to));
});

// ---- Dev auth (local only; enabled via DEV_AUTH var) ----

auth.post("/dev/login", async (c) => {
  if (c.env.DEV_AUTH !== "true") return c.json({ error: "disabled" }, 404);
  const body = await readJson<{ email?: string; name?: string }>(c);
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return c.json({ error: "invalid_email" }, 400);
  }
  const userId = await upsertUser(c.env, {
    provider: "dev",
    subject: `dev:${email}`,
    email,
    name: body.name?.trim() || email.split("@")[0],
    picture: null,
  });
  await maybeBootstrapAdmin(c.env, userId);
  const secret = await createSession(c.env, userId);
  setSessionCookie(c, secret);
  const user = await getUserById(c.env, userId);
  return c.json({ ok: true, user });
});

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "local";
}

function safeRedirect(target: string | null): string {
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}

interface JwtClaims {
  sub?: string;
  aud?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

function decodeJwtPayload(jwt: string): JwtClaims | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export { auth };
