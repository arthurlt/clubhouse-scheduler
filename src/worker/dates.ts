// Timezone- and horizon-aware date helpers. Calendar days are community-timezone
// civil dates (YYYY-MM-DD), never UTC instants.
import { formatInTimeZone } from "date-fns-tz";
import { addDays, isAfter, isBefore, parseISO } from "date-fns";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && formatUtcDay(d) === day;
}

function formatUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayInZone(timezone: string, now: Date = new Date()): string {
  return formatInTimeZone(now, timezone, "yyyy-MM-dd");
}

// Enumerate civil days from today through today+horizonDays (inclusive).
export function horizonDays(today: string, horizon: number): string[] {
  const start = parseISO(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i <= horizon; i++) {
    out.push(formatUtcDay(addDays(start, i)));
  }
  return out;
}

// Bookable iff today <= day <= today + horizon.
export function isWithinHorizon(day: string, today: string, horizon: number): boolean {
  const d = parseISO(`${day}T00:00:00Z`);
  const t = parseISO(`${today}T00:00:00Z`);
  const end = addDays(t, horizon);
  return !isBefore(d, t) && !isAfter(d, end);
}

// Member cancel allowed when the booked day is today or later (community TZ).
export function isDayInFutureOrToday(day: string, today: string): boolean {
  const d = parseISO(`${day}T00:00:00Z`);
  const t = parseISO(`${today}T00:00:00Z`);
  return !isBefore(d, t);
}
