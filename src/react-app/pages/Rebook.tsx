import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";

export function Rebook() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cancelledDay = params.get("day");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.rebookSuggestions(), api.myBookings()])
      .then(([s, b]) => {
        setSuggestions(s.suggestions);
        if (cancelledDay) {
          const match = b.bookings.find(
            (x) => x.day === cancelledDay && x.status === "cancelled",
          );
          setReason(match?.cancelledReason ?? null);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load"))
      .finally(() => setLoaded(true));
  }, [cancelledDay]);

  async function book(day: string) {
    setBusy(day);
    setError(null);
    try {
      await api.book(day);
      navigate("/bookings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Booking failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>Rebook the clubhouse</h2>
      {cancelledDay && (
        <p className="muted">
          Your reservation for <strong>{cancelledDay}</strong> was cancelled
          {reason ? `: ${reason}` : "."}
        </p>
      )}
      {error && <div className="error">{error}</div>}

      <h3>Next available days</h3>
      {loaded && suggestions.length === 0 && (
        <p className="muted">
          No open days in the current window. <Link to="/">See full calendar</Link>.
        </p>
      )}
      {suggestions.map((day) => (
        <div className="row" key={day}>
          <strong>{day}</strong>
          <button onClick={() => book(day)} disabled={busy === day}>
            {busy === day ? "Booking…" : "Book this day"}
          </button>
        </div>
      ))}

      <p style={{ marginTop: 16 }}>
        <Link to="/">Browse the full calendar instead</Link>
      </p>
    </div>
  );
}
