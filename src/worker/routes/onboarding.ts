import { Hono } from "hono";
import type { HonoEnv } from "../context";
import type { AddressOption } from "../../shared/types";
import { HttpError, requireUser, rotateSession } from "../auth";
import { checkRateLimit } from "../ratelimit";
import { writeAudit } from "../audit";
import { nowIso, readJson } from "../util";

const onboarding = new Hono<HonoEnv>();

// Authenticated, rate-limited address allowlist search. Never an anonymous dump.
onboarding.get("/addresses/search", async (c) => {
  const user = requireUser(c);
  const ok = await checkRateLimit(c.env, `addr-search:${user.id}`, 60, 60);
  if (!ok) throw new HttpError(429, "rate_limited", "Too many searches");

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ addresses: [] as AddressOption[] });

  const rows = await c.env.DB.prepare(
    "SELECT id, label FROM addresses WHERE label LIKE ? ORDER BY label LIMIT 20",
  )
    .bind(`%${q}%`)
    .all<{ id: string; label: string }>();
  return c.json({ addresses: (rows.results ?? []) as AddressOption[] });
});

// Claim an allowlisted address. Membership remains pending until a board admin
// approves. Rejected members may change address and resubmit.
onboarding.post("/onboarding/claim", async (c) => {
  const user = requireUser(c);
  if (user.status === "approved" || user.status === "suspended") {
    throw new HttpError(409, "invalid_state", "Address is already set for your account");
  }
  const ok = await checkRateLimit(c.env, `addr-claim:${user.id}`, 10, 60);
  if (!ok) throw new HttpError(429, "rate_limited", "Too many attempts");

  const body = await readJson<{ addressId?: string }>(c);
  if (!body.addressId) throw new HttpError(400, "invalid", "addressId required");

  const address = await c.env.DB.prepare("SELECT id, label FROM addresses WHERE id = ?")
    .bind(body.addressId)
    .first<{ id: string; label: string }>();
  if (!address) throw new HttpError(404, "not_found", "Address not on the allowlist");

  await c.env.DB.prepare(
    "UPDATE users SET address_id = ?, status = 'pending', rejection_reason = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(address.id, nowIso(), user.id)
    .run();
  await writeAudit(c.env, {
    actorUserId: user.id,
    action: "onboarding.claim_address",
    targetType: "address",
    targetId: address.id,
    detail: { label: address.label },
  });

  // Refresh privileges/status in the current session view.
  await rotateSession(c, user.id);
  return c.json({ ok: true });
});

export { onboarding };
