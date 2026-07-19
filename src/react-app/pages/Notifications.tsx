import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AppNotification } from "../../shared/types";
import { api, ApiError } from "../api";

export function Notifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.notifications();
    setItems(r.notifications);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Failed to load"),
    );
  }, [load]);

  async function markAll() {
    await api.markAllRead().catch(() => {});
    await load();
  }

  async function open(n: AppNotification) {
    if (!n.readAt) {
      await api.markRead(n.id).catch(() => {});
      await load();
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>Alerts</h2>
        {items.some((n) => !n.readAt) && (
          <button className="secondary" onClick={markAll}>
            Mark all read
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {items.length === 0 && <p className="muted">No notifications.</p>}
      {items.map((n) => (
        <div
          className="row"
          key={n.id}
          onClick={() => open(n)}
          style={{ opacity: n.readAt ? 0.6 : 1, cursor: "pointer" }}
        >
          <div>
            <div>
              <strong>{n.title}</strong>
              {!n.readAt && <span className="pill pending" style={{ marginLeft: 8 }}>new</span>}
            </div>
            <div className="muted">{n.body}</div>
            {n.kind === "booking_cancelled" && n.day && (
              <Link to={`/rebook?day=${n.day}`}>Pick a new day</Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
