import { Hono } from "hono";
import type { HonoEnv } from "./context";
import { HttpError, csrfProtection, loadUser } from "./auth";
import { auth } from "./routes/auth";
import { onboarding } from "./routes/onboarding";
import { calendar } from "./routes/calendar";
import { bookings } from "./routes/bookings";
import { notifications } from "./routes/notifications";
import { admin } from "./routes/admin";
import {
  deliverEmailJob,
  failEmailJob,
  sweepPendingEmail,
  type EmailQueueMessage,
} from "./email";

const app = new Hono<HonoEnv>();

app.use("/api/*", loadUser);
app.use("/api/*", csrfProtection);

app.get("/api/health", (c) => c.json({ ok: true, service: "clubhouse-scheduler" }));

const api = new Hono<HonoEnv>();
api.route("/auth", auth);
api.route("/", onboarding);
api.route("/", calendar);
api.route("/", bookings);
api.route("/", notifications);
api.route("/admin", admin);
app.route("/api", api);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.code, message: err.message }, err.status as 400);
  }
  console.error("unhandled error", err);
  return c.json({ error: "internal", message: "Something went wrong" }, 500);
});

export default {
  fetch: app.fetch,

  // Queue consumers: main delivery + dead-letter handling.
  async queue(
    batch: MessageBatch<EmailQueueMessage>,
    env: Env,
  ): Promise<void> {
    const isDlq = batch.queue.includes("dlq");
    for (const msg of batch.messages) {
      const jobId = msg.body?.jobId;
      if (!jobId) {
        msg.ack();
        continue;
      }
      try {
        if (isDlq) {
          await failEmailJob(env, jobId);
          msg.ack();
        } else {
          await deliverEmailJob(env, jobId);
          msg.ack();
        }
      } catch (err) {
        console.error(`queue ${batch.queue} job ${jobId} failed`, err);
        msg.retry(); // exhausted retries route to the DLQ
      }
    }
  },

  // Cron sweeper: re-enqueue stuck pending outbox rows.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const n = await sweepPendingEmail(env);
    if (n > 0) console.log(`swept ${n} pending email job(s)`);
  },
} satisfies ExportedHandler<Env, EmailQueueMessage>;
