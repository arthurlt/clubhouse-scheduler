import { newId, nowIso } from "./util";

export interface EmailJobInput {
  id?: string;
  userId: string | null;
  toEmail: string;
  subject: string;
  body: string;
}

export interface EmailQueueMessage {
  jobId: string;
}

// Builds a prepared statement inserting a pending outbox row so it can be part
// of the same D1 batch() as the mutation that triggered it. The outbox row is
// the source of truth for delivery status; the queue is only a delivery channel.
export function insertEmailJobStatement(
  env: Env,
  job: EmailJobInput,
): { id: string; statement: D1PreparedStatement } {
  const id = job.id ?? newId();
  const now = nowIso();
  const statement = env.DB.prepare(
    `INSERT INTO outbound_email_jobs
       (id, user_id, to_email, subject, body, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).bind(id, job.userId, job.toEmail, job.subject, job.body, now, now);
  return { id, statement };
}

// Enqueue delivery after the outbox row is committed. Queue send failures are
// tolerated: the Cron sweeper re-enqueues stuck pending rows.
export async function enqueueEmail(env: Env, jobId: string): Promise<void> {
  try {
    await env.EMAIL_QUEUE.send({ jobId } satisfies EmailQueueMessage);
  } catch (err) {
    console.error("email enqueue failed (sweeper will retry)", jobId, err);
  }
}

interface JobRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
}

// Attempt delivery of a single job. Throws on transient failure so the queue can
// retry; returns quietly when the job is already terminal.
export async function deliverEmailJob(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare(
    "SELECT id, to_email, subject, body, status, attempts FROM outbound_email_jobs WHERE id = ?",
  )
    .bind(jobId)
    .first<JobRow>();

  if (!job) {
    console.warn("email job not found", jobId);
    return;
  }
  if (job.status === "sent") return; // idempotent: already delivered

  try {
    await sendViaProvider(env, job);
    await env.DB.prepare(
      "UPDATE outbound_email_jobs SET status = 'sent', attempts = attempts + 1, sent_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(nowIso(), nowIso(), job.id)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      "UPDATE outbound_email_jobs SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?",
    )
      .bind(message, nowIso(), job.id)
      .run();
    throw err; // let the queue retry -> eventually DLQ
  }
}

// DLQ handler: the message exhausted retries. Mark the source-of-truth row
// failed so admins can see and resend it.
export async function failEmailJob(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE outbound_email_jobs
     SET status = 'failed', failed_at = ?, updated_at = ?,
         last_error = COALESCE(last_error, 'delivery exhausted retries')
     WHERE id = ? AND status != 'sent'`,
  )
    .bind(nowIso(), nowIso(), jobId)
    .run();
}

async function sendViaProvider(env: Env, job: JobRow): Promise<void> {
  const provider = env.EMAIL_PROVIDER || "console";

  if (provider === "console") {
    console.log(
      `[email:console] to=${job.to_email} subject=${JSON.stringify(job.subject)}\n${job.body}`,
    );
    return;
  }

  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY not configured");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Resend honors Idempotency-Key; use the job id so redelivery is safe.
        "Idempotency-Key": job.id,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [job.to_email],
        subject: job.subject,
        text: job.body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 4xx (except 429) are permanent; surface message either way.
      throw new Error(`resend ${res.status}: ${text.slice(0, 300)}`);
    }
    return;
  }

  throw new Error(`unknown email provider: ${provider}`);
}

// Cron sweeper: re-enqueue pending outbox rows that were never delivered (e.g.
// queue send failed after commit, or a consumer crashed).
export async function sweepPendingEmail(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - 60 * 1000).toISOString(); // >1 min old
  const rows = await env.DB.prepare(
    "SELECT id FROM outbound_email_jobs WHERE status = 'pending' AND created_at < ? LIMIT 100",
  )
    .bind(cutoff)
    .all<{ id: string }>();
  for (const row of rows.results ?? []) {
    await enqueueEmail(env, row.id);
  }
  return rows.results?.length ?? 0;
}
