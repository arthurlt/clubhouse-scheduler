import { Hono } from "hono";
import type { HonoEnv } from "../context";
import type {
  AdminBookingView,
  AdminMember,
  CommunitySettings,
  EmailJobView,
  UserStatus,
} from "../../shared/types";
import { HttpError, requireAdmin } from "../auth";
import { auditStatement, writeAudit } from "../audit";
import { getSettings, updateSettings } from "../settings";
import { enqueueEmail, insertEmailJobStatement } from "../email";
import { isValidDay } from "../dates";
import { newId, nowIso, readJson } from "../util";

const admin = new Hono<HonoEnv>();

// ---- Members / roles ----

admin.get("/members", async (c) => {
  requireAdmin(c);
  const status = c.req.query("status");
  const base = `SELECT u.id, u.email, u.name, u.status, u.is_admin, u.rejection_reason,
                       u.created_at, a.label AS address_label
                FROM users u LEFT JOIN addresses a ON a.id = u.address_id`;
  const stmt = status
    ? c.env.DB.prepare(`${base} WHERE u.status = ? ORDER BY u.created_at DESC`).bind(status)
    : c.env.DB.prepare(`${base} ORDER BY u.created_at DESC`);
  const rows = await stmt.all<{
    id: string;
    email: string;
    name: string | null;
    status: UserStatus;
    is_admin: number;
    rejection_reason: string | null;
    created_at: string;
    address_label: string | null;
  }>();
  const members: AdminMember[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    status: r.status,
    isAdmin: r.is_admin === 1,
    addressLabel: r.address_label,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
  }));
  return c.json({ members });
});

admin.post("/members/:id/approve", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  await setStatus(c.env, id, "approved", null);
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "member.approve",
    targetType: "user",
    targetId: id,
  });
  return c.json({ ok: true });
});

admin.post("/members/:id/reject", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  // Last-admin before self so rejecting the sole admin (including self) yields
  // 409 last_admin rather than a generic self error.
  await ensureNotLastAdminIfAdmin(c.env, id);
  if (id === actor.id) throw new HttpError(400, "self", "You cannot reject yourself");
  const body = await readJson<{ reason?: string }>(c);
  const reason = (body.reason ?? "").trim() || "Not eligible";
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!target) throw new HttpError(404, "not_found", "User not found");
  await c.env.DB.prepare(
    "UPDATE users SET status = 'rejected', rejection_reason = ?, is_admin = 0, updated_at = ? WHERE id = ?",
  )
    .bind(reason, nowIso(), id)
    .run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "member.reject",
    targetType: "user",
    targetId: id,
    detail: { reason },
  });
  return c.json({ ok: true });
});

admin.post("/members/:id/suspend", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  if (id === actor.id) throw new HttpError(400, "self", "You cannot suspend yourself");
  await ensureNotLastAdminIfAdmin(c.env, id);
  await c.env.DB.prepare(
    "UPDATE users SET status = 'suspended', is_admin = 0, updated_at = ? WHERE id = ?",
  )
    .bind(nowIso(), id)
    .run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "member.suspend",
    targetType: "user",
    targetId: id,
  });
  return c.json({ ok: true });
});

admin.post("/members/:id/reinstate", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  await setStatus(c.env, id, "approved", null);
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "member.reinstate",
    targetType: "user",
    targetId: id,
  });
  return c.json({ ok: true });
});

admin.post("/members/:id/promote", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT status FROM users WHERE id = ?")
    .bind(id)
    .first<{ status: UserStatus }>();
  if (!target) throw new HttpError(404, "not_found", "User not found");
  if (target.status !== "approved") {
    throw new HttpError(409, "invalid_state", "Only approved members can be admins");
  }
  await c.env.DB.prepare("UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "member.promote",
    targetType: "user",
    targetId: id,
  });
  return c.json({ ok: true });
});

admin.post("/members/:id/demote", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  await ensureNotLastAdminIfAdmin(c.env, id);
  await c.env.DB.prepare("UPDATE users SET is_admin = 0, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "member.demote",
    targetType: "user",
    targetId: id,
  });
  return c.json({ ok: true });
});

// ---- Bookings (identity view + admin cancel) ----

admin.get("/bookings", async (c) => {
  requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.day, b.status, b.created_at, b.cancelled_at, b.cancelled_reason,
            b.cancelled_by_admin, u.name AS user_name, u.email AS user_email,
            a.label AS address_label
     FROM bookings b JOIN users u ON u.id = b.user_id
     LEFT JOIN addresses a ON a.id = b.address_id
     ORDER BY b.day DESC LIMIT 500`,
  ).all<{
    id: string;
    day: string;
    status: "active" | "cancelled";
    created_at: string;
    cancelled_at: string | null;
    cancelled_reason: string | null;
    cancelled_by_admin: number;
    user_name: string | null;
    user_email: string;
    address_label: string | null;
  }>();
  const result: AdminBookingView[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    day: r.day,
    status: r.status,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    cancelledReason: r.cancelled_reason,
    cancelledByAdmin: r.cancelled_by_admin === 1,
    userName: r.user_name,
    userEmail: r.user_email,
    addressLabel: r.address_label,
  }));
  return c.json({ bookings: result });
});

// Admin cancel: cancel booking, free the day, notify in-app + queue email with a
// rebook deep link. Outbox row is committed in the same batch; queue send after.
admin.post("/bookings/:id/cancel", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  const body = await readJson<{ reason?: string }>(c);
  const reason = (body.reason ?? "").trim() || "Cancelled by the board";

  const emailJobId = await cancelBookingAsAdmin(c.env, id, actor.id, reason);
  if (emailJobId) await enqueueEmail(c.env, emailJobId);
  return c.json({ ok: true });
});

// ---- Blocks ----

admin.get("/blocks", async (c) => {
  requireAdmin(c);
  const rows = await c.env.DB.prepare(
    "SELECT day, message FROM blocked_dates ORDER BY day",
  ).all<{ day: string; message: string | null }>();
  return c.json({ blocks: rows.results ?? [] });
});

admin.post("/blocks", async (c) => {
  const actor = requireAdmin(c);
  const body = await readJson<{ day?: string; message?: string }>(c);
  const day = (body.day ?? "").trim();
  if (!isValidDay(day)) throw new HttpError(400, "invalid_day", "Invalid day");
  const message = (body.message ?? "").trim() || null;
  const blockId = newId();
  const now = nowIso();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO blocked_dates (id, day, message, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(blockId, day, message, actor.id, now),
      c.env.DB.prepare(
        "INSERT INTO calendar_days (day, kind, ref_id, created_at) VALUES (?, 'block', ?, ?)",
      ).bind(day, blockId, now),
      auditStatement(c.env, {
        actorUserId: actor.id,
        action: "block.create",
        targetType: "day",
        targetId: day,
        detail: { message },
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|constraint/i.test(msg)) {
      throw new HttpError(409, "day_taken", "That day is already booked or blocked");
    }
    throw err;
  }
  return c.json({ ok: true }, 201);
});

admin.delete("/blocks/:day", async (c) => {
  const actor = requireAdmin(c);
  const day = c.req.param("day");
  const block = await c.env.DB.prepare("SELECT id FROM blocked_dates WHERE day = ?")
    .bind(day)
    .first<{ id: string }>();
  if (!block) throw new HttpError(404, "not_found", "No block on that day");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM blocked_dates WHERE day = ?").bind(day),
    c.env.DB.prepare(
      "DELETE FROM calendar_days WHERE day = ? AND kind = 'block' AND ref_id = ?",
    ).bind(day, block.id),
    auditStatement(c.env, {
      actorUserId: actor.id,
      action: "block.remove",
      targetType: "day",
      targetId: day,
    }),
  ]);
  return c.json({ ok: true });
});

// Confirmed two-step: cancel an existing booking, then block the day. Both
// mutations remain separately audited.
admin.post("/cancel-then-block", async (c) => {
  const actor = requireAdmin(c);
  const body = await readJson<{ day?: string; message?: string }>(c);
  const day = (body.day ?? "").trim();
  if (!isValidDay(day)) throw new HttpError(400, "invalid_day", "Invalid day");
  const message = (body.message ?? "").trim() || null;

  const booking = await c.env.DB.prepare(
    "SELECT id FROM bookings WHERE day = ? AND status = 'active'",
  )
    .bind(day)
    .first<{ id: string }>();

  let emailJobId: string | null = null;
  if (booking) {
    emailJobId = await cancelBookingAsAdmin(
      c.env,
      booking.id,
      actor.id,
      message ? `Blocked: ${message}` : "The board reserved this day",
    );
  }

  const blockId = newId();
  const now = nowIso();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO blocked_dates (id, day, message, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(blockId, day, message, actor.id, now),
      c.env.DB.prepare(
        "INSERT INTO calendar_days (day, kind, ref_id, created_at) VALUES (?, 'block', ?, ?)",
      ).bind(day, blockId, now),
      auditStatement(c.env, {
        actorUserId: actor.id,
        action: "block.create_after_cancel",
        targetType: "day",
        targetId: day,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|constraint/i.test(msg)) {
      throw new HttpError(409, "day_taken", "Day already blocked");
    }
    throw err;
  }
  if (emailJobId) await enqueueEmail(c.env, emailJobId);
  return c.json({ ok: true });
});

// ---- Addresses ----

admin.get("/addresses", async (c) => {
  requireAdmin(c);
  const rows = await c.env.DB.prepare(
    "SELECT id, label FROM addresses ORDER BY label",
  ).all<{ id: string; label: string }>();
  return c.json({ addresses: rows.results ?? [] });
});

admin.post("/addresses", async (c) => {
  const actor = requireAdmin(c);
  const body = await readJson<{ label?: string }>(c);
  const label = (body.label ?? "").trim();
  if (!label) throw new HttpError(400, "invalid", "label required");
  const id = newId();
  try {
    await c.env.DB.prepare(
      "INSERT INTO addresses (id, label, created_at) VALUES (?, ?, ?)",
    )
      .bind(id, label, nowIso())
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) throw new HttpError(409, "exists", "Address already exists");
    throw err;
  }
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "address.add",
    targetType: "address",
    targetId: id,
    detail: { label },
  });
  return c.json({ ok: true, id }, 201);
});

admin.delete("/addresses/:id", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  const inUse = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE address_id = ?",
  )
    .bind(id)
    .first<{ n: number }>();
  if ((inUse?.n ?? 0) > 0) {
    throw new HttpError(409, "in_use", "Address is assigned to a member");
  }
  await c.env.DB.prepare("DELETE FROM addresses WHERE id = ?").bind(id).run();
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "address.remove",
    targetType: "address",
    targetId: id,
  });
  return c.json({ ok: true });
});

// ---- Settings ----

admin.get("/settings", async (c) => {
  requireAdmin(c);
  return c.json(await getSettings(c.env));
});

admin.put("/settings", async (c) => {
  const actor = requireAdmin(c);
  const body = await readJson<Partial<CommunitySettings>>(c);
  const current = await getSettings(c.env);
  const timezone = (body.timezone ?? current.timezone).trim();
  const horizonDays = Number(body.horizonDays ?? current.horizonDays);
  if (!isValidTimezone(timezone)) {
    throw new HttpError(400, "invalid_timezone", "Unknown timezone");
  }
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 730) {
    throw new HttpError(400, "invalid_horizon", "Horizon must be 1-730 days");
  }
  await updateSettings(c.env, { timezone, horizonDays });
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "settings.update",
    detail: { timezone, horizonDays },
  });
  return c.json({ ok: true, timezone, horizonDays });
});

// ---- Audit ----

admin.get("/audit", async (c) => {
  requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, actor_user_id, action, target_type, target_id, detail, created_at
     FROM audit_log ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return c.json({ entries: rows.results ?? [] });
});

// ---- Email delivery failures ----

admin.get("/email-jobs", async (c) => {
  requireAdmin(c);
  const status = c.req.query("status");
  const base = `SELECT id, to_email, subject, status, attempts, last_error, created_at, sent_at, failed_at
                FROM outbound_email_jobs`;
  const stmt = status
    ? c.env.DB.prepare(`${base} WHERE status = ? ORDER BY created_at DESC LIMIT 200`).bind(status)
    : c.env.DB.prepare(`${base} ORDER BY created_at DESC LIMIT 200`);
  const rows = await stmt.all<{
    id: string;
    to_email: string;
    subject: string;
    status: "pending" | "sent" | "failed";
    attempts: number;
    last_error: string | null;
    created_at: string;
    sent_at: string | null;
    failed_at: string | null;
  }>();
  const jobs: EmailJobView[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    toEmail: r.to_email,
    subject: r.subject,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    failedAt: r.failed_at,
  }));
  return c.json({ jobs });
});

admin.post("/email-jobs/:id/resend", async (c) => {
  const actor = requireAdmin(c);
  const id = c.req.param("id");
  const job = await c.env.DB.prepare(
    "SELECT id, status FROM outbound_email_jobs WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!job) throw new HttpError(404, "not_found", "Email job not found");
  await c.env.DB.prepare(
    "UPDATE outbound_email_jobs SET status = 'pending', failed_at = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(nowIso(), id)
    .run();
  await enqueueEmail(c.env, id);
  await writeAudit(c.env, {
    actorUserId: actor.id,
    action: "email.resend",
    targetType: "email_job",
    targetId: id,
  });
  return c.json({ ok: true });
});

// ---- helpers ----

async function setStatus(
  env: Env,
  userId: string,
  status: UserStatus,
  rejectionReason: string | null,
): Promise<void> {
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string }>();
  if (!target) throw new HttpError(404, "not_found", "User not found");
  await env.DB.prepare(
    "UPDATE users SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?",
  )
    .bind(status, rejectionReason, nowIso(), userId)
    .run();
}

async function ensureNotLastAdminIfAdmin(env: Env, userId: string): Promise<void> {
  const target = await env.DB.prepare("SELECT is_admin FROM users WHERE id = ?")
    .bind(userId)
    .first<{ is_admin: number }>();
  if (!target) throw new HttpError(404, "not_found", "User not found");
  if (target.is_admin !== 1) return;
  const admins = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE is_admin = 1",
  ).first<{ n: number }>();
  if ((admins?.n ?? 0) <= 1) {
    throw new HttpError(409, "last_admin", "Cannot remove the last admin");
  }
}

// Shared admin-cancel transaction. Returns the queued email job id (or null).
async function cancelBookingAsAdmin(
  env: Env,
  bookingId: string,
  actorId: string,
  reason: string,
): Promise<string | null> {
  const booking = await env.DB.prepare(
    "SELECT id, day, user_id, status FROM bookings WHERE id = ?",
  )
    .bind(bookingId)
    .first<{ id: string; day: string; user_id: string; status: string }>();
  if (!booking) throw new HttpError(404, "not_found", "Booking not found");
  if (booking.status !== "active") {
    throw new HttpError(409, "not_active", "Booking is not active");
  }

  const member = await env.DB.prepare("SELECT email, name FROM users WHERE id = ?")
    .bind(booking.user_id)
    .first<{ email: string; name: string | null }>();

  const rebookUrl = `${new URL(env.APP_BASE_URL).origin}/rebook?day=${booking.day}`;
  const emailBody =
    `Hello${member?.name ? " " + member.name : ""},\n\n` +
    `Your clubhouse reservation for ${booking.day} has been cancelled by the board.\n` +
    `Reason: ${reason}\n\n` +
    `You can pick a new day here: ${rebookUrl}\n\n` +
    `— Clubhouse Scheduler`;

  const { id: emailJobId, statement: emailStmt } = insertEmailJobStatement(env, {
    userId: booking.user_id,
    toEmail: member?.email ?? "",
    subject: "Your clubhouse reservation was cancelled",
    body: emailBody,
  });

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ?, cancelled_by_admin = 1 WHERE id = ?",
    ).bind(nowIso(), reason, bookingId),
    env.DB.prepare(
      "DELETE FROM calendar_days WHERE day = ? AND kind = 'booking' AND ref_id = ?",
    ).bind(booking.day, bookingId),
    env.DB.prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, day, created_at)
       VALUES (?, ?, 'booking_cancelled', ?, ?, ?, ?)`,
    ).bind(
      newId(),
      booking.user_id,
      "Reservation cancelled",
      `Your ${booking.day} reservation was cancelled: ${reason}`,
      booking.day,
      nowIso(),
    ),
    emailStmt,
    auditStatement(env, {
      actorUserId: actorId,
      action: "booking.cancel_admin",
      targetType: "booking",
      targetId: bookingId,
      detail: { day: booking.day, reason },
    }),
  ]);

  return member?.email ? emailJobId : null;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export { admin };
