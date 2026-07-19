import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type {
  AddressOption,
  AdminBookingView,
  AdminMember,
  CommunitySettings,
  EmailJobView,
} from "../../shared/types";
import { useSession } from "../session";
import { api, ApiError } from "../api";

type Tab = "pending" | "members" | "bookings" | "blocks" | "addresses" | "email" | "settings" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "pending", label: "Approvals" },
  { id: "members", label: "Members" },
  { id: "bookings", label: "Bookings" },
  { id: "blocks", label: "Blocks" },
  { id: "addresses", label: "Addresses" },
  { id: "email", label: "Email" },
  { id: "settings", label: "Settings" },
  { id: "audit", label: "Audit" },
];

export function AdminPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>("pending");
  if (!user?.isAdmin) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "pending" && <Approvals />}
      {tab === "members" && <Members />}
      {tab === "bookings" && <Bookings />}
      {tab === "blocks" && <Blocks />}
      {tab === "addresses" && <Addresses />}
      {tab === "email" && <EmailFailures />}
      {tab === "settings" && <Settings />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function useError() {
  const [error, setError] = useState<string | null>(null);
  const wrap = useCallback(async (fn: () => Promise<void>) => {
    try {
      setError(null);
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    }
  }, []);
  return { error, wrap };
}

function Approvals() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const { error, wrap } = useError();
  const load = useCallback(
    () => api.admin.members("pending").then((r) => setMembers(r.members)),
    [],
  );
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="card">
      <h2>Pending approvals</h2>
      {error && <div className="error">{error}</div>}
      {members.length === 0 && <p className="muted">No pending requests.</p>}
      {members.map((m) => (
        <div className="row" key={m.id}>
          <div>
            <strong>{m.name ?? m.email}</strong>
            <div className="muted">
              {m.email} · {m.addressLabel ?? "no address"}
            </div>
          </div>
          <div className="stack">
            <button onClick={() => wrap(() => api.admin.approve(m.id).then(load))}>
              Approve
            </button>
            <button
              className="danger"
              onClick={() =>
                wrap(async () => {
                  const reason = prompt("Reason for rejection?") ?? "";
                  await api.admin.reject(m.id, reason);
                  await load();
                })
              }
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Members() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const { error, wrap } = useError();
  const load = useCallback(() => api.admin.members().then((r) => setMembers(r.members)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="card">
      <h2>Members &amp; roles</h2>
      {error && <div className="error">{error}</div>}
      {members.map((m) => (
        <div className="row" key={m.id}>
          <div>
            <strong>{m.name ?? m.email}</strong>{" "}
            {m.isAdmin && <span className="pill active">admin</span>}
            <div className="muted">
              {m.email} · <span className={`pill ${m.status === "approved" ? "active" : "pending"}`}>{m.status}</span>
            </div>
          </div>
          <div className="stack">
            {m.status === "approved" && !m.isAdmin && (
              <button onClick={() => wrap(() => api.admin.promote(m.id).then(load))}>
                Make admin
              </button>
            )}
            {m.isAdmin && (
              <button
                className="secondary"
                onClick={() => wrap(() => api.admin.demote(m.id).then(load))}
              >
                Remove admin
              </button>
            )}
            {m.status === "approved" && (
              <button
                className="danger"
                onClick={() => wrap(() => api.admin.suspend(m.id).then(load))}
              >
                Suspend
              </button>
            )}
            {m.status === "suspended" && (
              <button onClick={() => wrap(() => api.admin.reinstate(m.id).then(load))}>
                Reinstate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Bookings() {
  const [bookings, setBookings] = useState<AdminBookingView[]>([]);
  const { error, wrap } = useError();
  const load = useCallback(() => api.admin.bookings().then((r) => setBookings(r.bookings)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="card">
      <h2>Bookings</h2>
      <p className="muted">Identity is visible to admins only.</p>
      {error && <div className="error">{error}</div>}
      {bookings.map((b) => (
        <div className="row" key={b.id}>
          <div>
            <strong>{b.day}</strong>{" "}
            <span className={`pill ${b.status}`}>{b.status}</span>
            <div className="muted">
              {b.userName ?? b.userEmail} · {b.addressLabel ?? "—"}
            </div>
          </div>
          {b.status === "active" && (
            <button
              className="danger"
              onClick={() =>
                wrap(async () => {
                  const reason = prompt("Reason for cancellation?") ?? "";
                  await api.admin.cancelBooking(b.id, reason);
                  await load();
                })
              }
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Blocks() {
  const [blocks, setBlocks] = useState<{ day: string; message: string | null }[]>([]);
  const [day, setDay] = useState("");
  const [message, setMessage] = useState("");
  const { error, wrap } = useError();
  const load = useCallback(() => api.admin.blocks().then((r) => setBlocks(r.blocks)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="card">
      <h2>Blocked days</h2>
      {error && <div className="error">{error}</div>}
      <label htmlFor="block-day">Day</label>
      <input id="block-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      <label htmlFor="block-msg">Public message (optional)</label>
      <input
        id="block-msg"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. Community maintenance"
      />
      <button
        style={{ marginTop: 12 }}
        disabled={!day}
        onClick={() =>
          wrap(async () => {
            await api.admin.addBlock(day, message);
            setDay("");
            setMessage("");
            await load();
          })
        }
      >
        Block day
      </button>
      <h3>Current blocks</h3>
      {blocks.length === 0 && <p className="muted">No blocks.</p>}
      {blocks.map((b) => (
        <div className="row" key={b.day}>
          <div>
            <strong>{b.day}</strong>
            <div className="muted">{b.message ?? "—"}</div>
          </div>
          <button
            className="secondary"
            onClick={() => wrap(() => api.admin.removeBlock(b.day).then(load))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function Addresses() {
  const [addresses, setAddresses] = useState<AddressOption[]>([]);
  const [label, setLabel] = useState("");
  const { error, wrap } = useError();
  const load = useCallback(() => api.admin.addresses().then((r) => setAddresses(r.addresses)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="card">
      <h2>Address allowlist</h2>
      {error && <div className="error">{error}</div>}
      <label htmlFor="addr-label">New address</label>
      <input
        id="addr-label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="e.g. 42 Oak Street"
      />
      <button
        style={{ marginTop: 12 }}
        disabled={!label.trim()}
        onClick={() =>
          wrap(async () => {
            await api.admin.addAddress(label.trim());
            setLabel("");
            await load();
          })
        }
      >
        Add address
      </button>
      <h3>Allowlist ({addresses.length})</h3>
      {addresses.map((a) => (
        <div className="row" key={a.id}>
          <span>{a.label}</span>
          <button
            className="secondary"
            onClick={() => wrap(() => api.admin.removeAddress(a.id).then(load))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function EmailFailures() {
  const [jobs, setJobs] = useState<EmailJobView[]>([]);
  const { error, wrap } = useError();
  const load = useCallback(() => api.admin.emailJobs().then((r) => setJobs(r.jobs)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <div className="card">
      <h2>Email delivery</h2>
      {error && <div className="error">{error}</div>}
      {jobs.length === 0 && <p className="muted">No email jobs yet.</p>}
      {jobs.map((j) => (
        <div className="row" key={j.id}>
          <div>
            <strong>{j.subject}</strong>{" "}
            <span className={`pill ${j.status}`}>{j.status}</span>
            <div className="muted">
              {j.toEmail} · {j.attempts} attempt(s)
              {j.lastError ? ` · ${j.lastError}` : ""}
            </div>
          </div>
          {j.status !== "sent" && (
            <button onClick={() => wrap(() => api.admin.resendEmail(j.id).then(load))}>
              Resend
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Settings() {
  const [settings, setSettings] = useState<CommunitySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const { error, wrap } = useError();
  useEffect(() => {
    api.admin.settings().then(setSettings).catch(() => {});
  }, []);

  if (!settings) return <div className="card">Loading…</div>;

  return (
    <div className="card">
      <h2>Community settings</h2>
      {error && <div className="error">{error}</div>}
      {saved && <div className="success">Saved.</div>}
      <label htmlFor="tz">Timezone (IANA)</label>
      <input
        id="tz"
        value={settings.timezone}
        onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
      />
      <label htmlFor="horizon">Booking horizon (days)</label>
      <input
        id="horizon"
        type="number"
        min={1}
        max={730}
        value={settings.horizonDays}
        onChange={(e) => setSettings({ ...settings, horizonDays: Number(e.target.value) })}
      />
      <button
        style={{ marginTop: 12 }}
        onClick={() =>
          wrap(async () => {
            await api.admin.updateSettings(settings);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          })
        }
      >
        Save settings
      </button>
    </div>
  );
}

function Audit() {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    api.admin.audit().then((r) => setEntries(r.entries)).catch(() => {});
  }, []);

  return (
    <div className="card">
      <h2>Audit log</h2>
      {entries.length === 0 && <p className="muted">No audit entries.</p>}
      {entries.map((e) => (
        <div className="row" key={String(e.id)}>
          <div>
            <strong>{String(e.action)}</strong>
            <div className="muted">
              {String(e.created_at)}
              {e.detail ? ` · ${String(e.detail)}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
