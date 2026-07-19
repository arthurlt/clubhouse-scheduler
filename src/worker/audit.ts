import { newId, nowIso } from "./util";

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: unknown;
}

// Build a D1 prepared statement for an append-only audit row so it can be
// included in a batch() alongside the mutation it describes.
export function auditStatement(env: Env, entry: AuditEntry): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId(),
    entry.actorUserId,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
    nowIso(),
  );
}

export async function writeAudit(env: Env, entry: AuditEntry): Promise<void> {
  await auditStatement(env, entry).run();
}
