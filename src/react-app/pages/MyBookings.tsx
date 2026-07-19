import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Booking } from "../../shared/types";
import { api, ApiError } from "../api";

export function MyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [today, setToday] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cal, mine] = await Promise.all([api.calendar(), api.myBookings()]);
    setToday(cal.today);
    setBookings(mine.bookings);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Failed to load"),
    );
  }, [load]);

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.cancelBooking(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>My bookings</h2>
      {error && <div className="error">{error}</div>}
      {bookings.length === 0 && <p className="muted">You have no bookings yet.</p>}
      {bookings.map((b) => (
        <div className="row" key={b.id}>
          <div>
            <div>
              <strong>{b.day}</strong>{" "}
              <span className={`pill ${b.status}`}>{b.status}</span>
            </div>
            {b.status === "cancelled" && b.cancelledByAdmin && (
              <div className="muted">
                Cancelled by board{b.cancelledReason ? `: ${b.cancelledReason}` : ""}.{" "}
                <Link to={`/rebook?day=${b.day}`}>Rebook</Link>
              </div>
            )}
          </div>
          {today && b.status === "active" && b.day >= today && (
            <button
              className="danger"
              onClick={() => cancel(b.id)}
              disabled={busy === b.id}
            >
              {busy === b.id ? "…" : "Cancel"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
