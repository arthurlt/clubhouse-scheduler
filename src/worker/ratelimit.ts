import { nowIso } from "./util";

// Durable fixed-window rate limiter backed by D1 (the plan allows either the
// Workers Rate Limiting binding or durable counters; counters keep local dev
// self-contained and testable).
export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000,
  ).toISOString();
  const bucket = `${key}:${windowStart}`;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucket, nowIso())
    .first<{ count: number }>();

  return (row?.count ?? 1) <= limit;
}
