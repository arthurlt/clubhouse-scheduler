import { Hono } from "hono";
import type { HonoEnv } from "../context";
import type { Booking } from "../../shared/types";
import { HttpError, requireApproved } from "../auth";
import { getSettings } from "../settings";
import { auditStatement } from "../audit";
import { checkRateLimit } from "../ratelimit";
import { isDayInFutureOrToday, isValidDay, isWithinHorizon, todayInZone } from "../dates";
import { newId, nowIso, readJson } from "../util";

const bookings = new Hono<HonoEnv>();

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE|constraint/i.test(msg);
}

bookings.get("/bookings/mine", async (c) => {
  const user = requireApproved(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, day, status, created_at, cancelled_at, cancelled_reason, cancelled_by_admin
     FROM bookings WHERE user_id = ? ORDER BY day DESC`,
  )
    .bind(user.id)
    .all<{
      id: string;
      day: string;
      status: "active" | "cancelled";
      created_at: string;
      cancelled_at: string | null;
      cancelled_reason: string | null;
      cancelled_by_admin: number;
    }>();

  const result: Booking[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    day: r.day,
    status: r.status,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    cancelledReason: r.cancelled_reason,
    cancelledByAdmin: r.cancelled_by_admin === 1,
  }));
  return c.json({ bookings: result });
});

bookings.post("/bookings", async (c) => {
  const user = requireApproved(c);
  const ok = await checkRateLimit(c.env, `booking-write:${user.id}`, 30, 60);
  if (!ok) throw new HttpError(429, "rate_limited", "Too many requests");

  const body = await readJson<{ day?: string }>(c);
  const day = (body.day ?? "").trim();
  if (!isValidDay(day)) throw new HttpError(400, "invalid_day", "Invalid day");

  const settings = await getSettings(c.env);
  const today = todayInZone(settings.timezone);
  if (!isWithinHorizon(day, today, settings.horizonDays)) {
    throw new HttpError(422, "out_of_horizon", "That day is outside the booking window");
  }

  const bookingId = newId();
  const now = nowIso();
  try {
    // calendar_days PK + partial unique index enforce single occupancy per day.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO bookings (id, day, user_id, address_id, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      ).bind(bookingId, day, user.id, user.addressId, now),
      c.env.DB.prepare(
        "INSERT INTO calendar_days (day, kind, ref_id, created_at) VALUES (?, 'booking', ?, ?)",
      ).bind(day, bookingId, now),
      auditStatement(c.env, {
        actorUserId: user.id,
        action: "booking.create",
        targetType: "booking",
        targetId: bookingId,
        detail: { day },
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "day_taken", "That day is no longer available");
    }
    throw err;
  }

  return c.json({ ok: true, booking: { id: bookingId, day, status: "active" } }, 201);
});

// Member self-cancel: allowed while active and the day is today or later. Audit
// only, no email blast (per product decisions).
bookings.delete("/bookings/:id", async (c) => {
  const user = requireApproved(c);
  const id = c.req.param("id");
  const booking = await c.env.DB.prepare(
    "SELECT id, day, user_id, status FROM bookings WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; day: string; user_id: string; status: string }>();

  if (!booking || booking.user_id !== user.id) {
    throw new HttpError(404, "not_found", "Booking not found");
  }
  if (booking.status !== "active") {
    throw new HttpError(409, "not_active", "Booking is not active");
  }
  const settings = await getSettings(c.env);
  const today = todayInZone(settings.timezone);
  if (!isDayInFutureOrToday(booking.day, today)) {
    throw new HttpError(422, "past_day", "Past bookings cannot be cancelled");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by_admin = 0 WHERE id = ?",
    ).bind(nowIso(), id),
    c.env.DB.prepare(
      "DELETE FROM calendar_days WHERE day = ? AND kind = 'booking' AND ref_id = ?",
    ).bind(booking.day, id),
    auditStatement(c.env, {
      actorUserId: user.id,
      action: "booking.cancel_self",
      targetType: "booking",
      targetId: id,
      detail: { day: booking.day },
    }),
  ]);

  return c.json({ ok: true });
});

// Assisted rebooking: next available days within the horizon (never auto-books).
bookings.get("/rebook/suggestions", async (c) => {
  const user = requireApproved(c);
  void user;
  const settings = await getSettings(c.env);
  const today = todayInZone(settings.timezone);
  const rows = await c.env.DB.prepare(
    "SELECT day FROM calendar_days WHERE day >= ?",
  )
    .bind(today)
    .all<{ day: string }>();
  const occupied = new Set((rows.results ?? []).map((r) => r.day));

  const suggestions: string[] = [];
  const start = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i <= settings.horizonDays && suggestions.length < 3; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (!occupied.has(d)) suggestions.push(d);
  }
  return c.json({ suggestions });
});

export { bookings };
