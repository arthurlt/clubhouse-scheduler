import { Hono } from "hono";
import type { HonoEnv } from "../context";
import type { CalendarDay, CalendarResponse, DayState } from "../../shared/types";
import { requireApproved } from "../auth";
import { getSettings } from "../settings";
import { horizonDays, todayInZone } from "../dates";

const calendar = new Hono<HonoEnv>();

// Calendar respects the privacy matrix: members see available/yours/unavailable/
// blocked only. `unavailable` never leaks identity or address.
calendar.get("/calendar", async (c) => {
  const user = requireApproved(c);
  const settings = await getSettings(c.env);
  const today = todayInZone(settings.timezone);
  const allDays = horizonDays(today, settings.horizonDays);
  const endDay = allDays[allDays.length - 1];

  const occupied = await c.env.DB.prepare(
    "SELECT day, kind, ref_id FROM calendar_days WHERE day >= ? AND day <= ?",
  )
    .bind(today, endDay)
    .all<{ day: string; kind: "booking" | "block"; ref_id: string }>();

  const mine = await c.env.DB.prepare(
    "SELECT day FROM bookings WHERE user_id = ? AND status = 'active' AND day >= ? AND day <= ?",
  )
    .bind(user.id, today, endDay)
    .all<{ day: string }>();

  const blocks = await c.env.DB.prepare(
    "SELECT day, message FROM blocked_dates WHERE day >= ? AND day <= ?",
  )
    .bind(today, endDay)
    .all<{ day: string; message: string | null }>();

  const mineSet = new Set((mine.results ?? []).map((r) => r.day));
  const blockMsg = new Map((blocks.results ?? []).map((r) => [r.day, r.message]));
  const occupiedMap = new Map((occupied.results ?? []).map((r) => [r.day, r.kind]));

  const days: CalendarDay[] = allDays.map((day) => {
    const kind = occupiedMap.get(day);
    let state: DayState = "available";
    let blockMessage: string | null | undefined;
    if (kind === "block") {
      state = "blocked";
      blockMessage = blockMsg.get(day) ?? null;
    } else if (kind === "booking") {
      state = mineSet.has(day) ? "yours" : "unavailable";
    }
    return { day, state, blockMessage };
  });

  const body: CalendarResponse = {
    today,
    horizonDays: settings.horizonDays,
    timezone: settings.timezone,
    days,
  };
  return c.json(body);
});

export { calendar };
