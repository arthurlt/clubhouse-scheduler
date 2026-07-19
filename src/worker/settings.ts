import type { CommunitySettings } from "../shared/types";

// Reads community settings singleton, falling back to env defaults and seeding
// the row on first read.
export async function getSettings(env: Env): Promise<CommunitySettings> {
  const row = await env.DB.prepare(
    "SELECT timezone, horizon_days FROM community_settings WHERE id = 1",
  ).first<{ timezone: string; horizon_days: number }>();

  if (row) {
    return { timezone: row.timezone, horizonDays: row.horizon_days };
  }

  const timezone = env.DEFAULT_TIMEZONE || "America/Denver";
  const horizonDays = Number(env.DEFAULT_HORIZON_DAYS || "90");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO community_settings (id, timezone, horizon_days) VALUES (1, ?, ?)",
  )
    .bind(timezone, horizonDays)
    .run();
  return { timezone, horizonDays };
}

export async function updateSettings(
  env: Env,
  settings: CommunitySettings,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO community_settings (id, timezone, horizon_days) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone, horizon_days = excluded.horizon_days`,
  )
    .bind(settings.timezone, settings.horizonDays)
    .run();
}
