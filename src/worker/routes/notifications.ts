import { Hono } from "hono";
import type { HonoEnv } from "../context";
import type { AppNotification } from "../../shared/types";
import { requireUser } from "../auth";
import { nowIso } from "../util";

const notifications = new Hono<HonoEnv>();

notifications.get("/notifications", async (c) => {
  const user = requireUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, title, body, day, read_at, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all<{
      id: string;
      kind: string;
      title: string;
      body: string;
      day: string | null;
      read_at: string | null;
      created_at: string;
    }>();
  const result: AppNotification[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    day: r.day,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
  return c.json({ notifications: result });
});

notifications.post("/notifications/:id/read", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
  )
    .bind(nowIso(), c.req.param("id"), user.id)
    .run();
  return c.json({ ok: true });
});

notifications.post("/notifications/read-all", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
  )
    .bind(nowIso(), user.id)
    .run();
  return c.json({ ok: true });
});

export { notifications };
