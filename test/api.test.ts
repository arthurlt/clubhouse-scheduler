import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";

const ORIGIN = "http://localhost:5173";

// Minimal cookie jar for driving the worker through SELF.
function makeClient() {
  let cookie = "";
  return {
    async fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("Origin", ORIGIN);
      if (init.body) headers.set("Content-Type", "application/json");
      if (cookie) headers.set("Cookie", cookie);
      const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return res;
    },
  };
}

async function login(client: ReturnType<typeof makeClient>, email: string, name: string) {
  const res = await client.fetch("/api/auth/dev/login", {
    method: "POST",
    body: JSON.stringify({ email, name }),
  });
  expect(res.status).toBe(200);
  return res.json<{ user: { id: string } }>();
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO addresses (id, label, created_at) VALUES (?, ?, ?)",
  )
    .bind("addr-t1", "1 Test Way", new Date().toISOString())
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO addresses (id, label, created_at) VALUES (?, ?, ?)",
  )
    .bind("addr-t2", "2 Test Way", new Date().toISOString())
    .run();
});

describe("health", () => {
  it("responds ok", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("csrf", () => {
  it("rejects mutating requests from other origins", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/dev/login`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("bootstrap admin", () => {
  it("elevates the allowlisted email only while zero admins exist", async () => {
    const admin = makeClient();
    await login(admin, "admin@example.com", "Boss");
    const me = await (await admin.fetch("/api/auth/me")).json<{
      user: { isAdmin: boolean; status: string };
    }>();
    expect(me.user.isAdmin).toBe(true);
    expect(me.user.status).toBe("approved");

    // A second bootstrap-listed login must NOT auto-elevate.
    const other = makeClient();
    await login(other, "admin@example.com", "Boss"); // same account -> already admin
    const second = makeClient();
    await login(second, "someoneelse@example.com", "Nope");
    const me2 = await (await second.fetch("/api/auth/me")).json<{
      user: { isAdmin: boolean };
    }>();
    expect(me2.user.isAdmin).toBe(false);
  });
});

describe("booking flow + single-occupancy", () => {
  it("enforces one active booking per day (409) and privacy in the calendar", async () => {
    const admin = makeClient();
    await login(admin, "admin@example.com", "Boss");

    // Approve two members.
    const jane = makeClient();
    await login(jane, "jane@test.dev", "Jane");
    await jane.fetch("/api/onboarding/claim", {
      method: "POST",
      body: JSON.stringify({ addressId: "addr-t1" }),
    });
    const bob = makeClient();
    await login(bob, "bob@test.dev", "Bob");
    await bob.fetch("/api/onboarding/claim", {
      method: "POST",
      body: JSON.stringify({ addressId: "addr-t2" }),
    });

    const members = await (
      await admin.fetch("/api/admin/members?status=pending")
    ).json<{ members: { id: string; email: string }[] }>();
    for (const m of members.members) {
      await admin.fetch(`/api/admin/members/${m.id}/approve`, { method: "POST" });
    }

    // today (UTC-safe): use the calendar's own today value.
    const cal = await (await jane.fetch("/api/calendar")).json<{
      today: string;
      days: { day: string; state: string }[];
    }>();
    const day = cal.days[5].day; // a day inside the horizon

    const first = await jane.fetch("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ day }),
    });
    expect(first.status).toBe(201);

    const dup = await bob.fetch("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ day }),
    });
    expect(dup.status).toBe(409);

    // Privacy: Bob sees the day as "unavailable" (never "yours", no identity).
    const bobCal = await (await bob.fetch("/api/calendar")).json<{
      days: { day: string; state: string }[];
    }>();
    const bobDay = bobCal.days.find((d) => d.day === day);
    expect(bobDay?.state).toBe("unavailable");
    expect(JSON.stringify(bobDay)).not.toContain("jane@test.dev");

    // Owner sees it as "yours".
    const janeCal = await (await jane.fetch("/api/calendar")).json<{
      days: { day: string; state: string }[];
    }>();
    expect(janeCal.days.find((d) => d.day === day)?.state).toBe("yours");
  });
});

describe("admin cancel creates outbox + notification", () => {
  it("cancels, notifies, and queues an email", async () => {
    const admin = makeClient();
    await login(admin, "admin@example.com", "Boss");
    const carol = makeClient();
    await login(carol, "carol@test.dev", "Carol");
    await carol.fetch("/api/onboarding/claim", {
      method: "POST",
      body: JSON.stringify({ addressId: "addr-t1" }),
    });
    const pending = await (
      await admin.fetch("/api/admin/members?status=pending")
    ).json<{ members: { id: string; email: string }[] }>();
    const carolId = pending.members.find((m) => m.email === "carol@test.dev")!.id;
    await admin.fetch(`/api/admin/members/${carolId}/approve`, { method: "POST" });

    const cal = await (await carol.fetch("/api/calendar")).json<{
      days: { day: string }[];
    }>();
    const day = cal.days[10].day;
    await carol.fetch("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ day }),
    });

    const bookings = await (await admin.fetch("/api/admin/bookings")).json<{
      bookings: { id: string; day: string; status: string }[];
    }>();
    const booking = bookings.bookings.find((b) => b.day === day && b.status === "active")!;
    const res = await admin.fetch(`/api/admin/bookings/${booking.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "Community event" }),
    });
    expect(res.status).toBe(200);

    // In-app notification exists for Carol.
    const notifs = await (await carol.fetch("/api/notifications")).json<{
      notifications: { title: string; day: string | null }[];
    }>();
    expect(notifs.notifications.some((n) => n.day === day)).toBe(true);

    // Outbox row was created (source of truth for delivery).
    const jobs = await (await admin.fetch("/api/admin/email-jobs")).json<{
      jobs: { toEmail: string; subject: string }[];
    }>();
    expect(jobs.jobs.some((j) => j.toEmail === "carol@test.dev")).toBe(true);
  });
});
