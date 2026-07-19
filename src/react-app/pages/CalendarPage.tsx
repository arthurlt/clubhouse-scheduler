import { useCallback, useEffect, useMemo, useState } from "react";
import type { Booking, CalendarResponse } from "../../shared/types";
import { api, ApiError } from "../api";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthKey(day: string): string {
  return day.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function dayNum(day: string): number {
  return Number(day.slice(8, 10));
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function CalendarPage() {
  const [cal, setCal] = useState<CalendarResponse | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, b] = await Promise.all([api.calendar(), api.myBookings()]);
    setCal(c);
    setBookings(b.bookings);
  }, []);

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Failed to load calendar"),
    );
  }, [load]);

  const bookingByDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bookings) if (b.status === "active") m.set(b.day, b.id);
    return m;
  }, [bookings]);

  const months = useMemo(() => {
    if (!cal) return [];
    const groups = new Map<string, typeof cal.days>();
    for (const d of cal.days) {
      const k = monthKey(d.day);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(d);
    }
    return [...groups.entries()];
  }, [cal]);

  if (error) return <div className="error">{error}</div>;
  if (!cal) return <div className="center">Loading…</div>;

  const selectedState = selected ? cal.days.find((d) => d.day === selected)?.state : null;

  async function book() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.book(selected);
      setNotice(`Booked ${selected}`);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Booking failed");
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!selected) return;
    const id = bookingByDay.get(selected);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelBooking(id);
      setNotice(`Cancelled ${selected}`);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cancel failed");
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Availability</h2>
        <p className="muted">
          Tap an open day to reserve the clubhouse. Times shown in {cal.timezone}.
        </p>
        {notice && <div className="success" role="status">{notice}</div>}
        {error && <div className="error" role="alert">{error}</div>}

        {months.map(([key, days]) => {
          const pad = weekday(days[0].day);
          return (
            <div key={key}>
              <div className="month-title">{monthLabel(key)}</div>
              <div className="calendar-grid" role="grid" aria-label={monthLabel(key)}>
                {DOW.map((d) => (
                  <div className="dow" key={d}>
                    {d}
                  </div>
                ))}
                {Array.from({ length: pad }).map((_, i) => (
                  <div className="day-cell empty" key={`pad-${i}`} aria-hidden="true" />
                ))}
                {days.map((d) => {
                  const clickable = d.state === "available" || d.state === "yours";
                  return (
                    <button
                      key={d.day}
                      className={`day-cell ${d.state}`}
                      disabled={!clickable}
                      onClick={() => clickable && setSelected(d.day)}
                      aria-label={`${d.day}: ${stateLabel(d.state)}${
                        d.blockMessage ? `, ${d.blockMessage}` : ""
                      }`}
                    >
                      <span className="num">{dayNum(d.day)}</span>
                      <span className="tag">{stateTag(d.state)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="legend" aria-hidden="true">
          <span>
            <i className="swatch" style={{ background: "var(--available)" }} /> Available
          </span>
          <span>
            <i className="swatch" style={{ background: "var(--yours)" }} /> Yours
          </span>
          <span>
            <i className="swatch" style={{ background: "var(--unavailable)" }} /> Taken
          </span>
          <span>
            <i className="swatch" style={{ background: "var(--blocked)" }} /> Blocked
          </span>
        </div>
      </div>

      {selected && (
        <div className="card" role="dialog" aria-label="Confirm">
          <h3>{selected}</h3>
          {selectedState === "available" ? (
            <>
              <p className="muted">Reserve the clubhouse for this full day?</p>
              <div className="stack">
                <button onClick={book} disabled={busy}>
                  {busy ? "Booking…" : "Confirm booking"}
                </button>
                <button className="secondary" onClick={() => setSelected(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">This is your reservation. Release this day?</p>
              <div className="stack">
                <button className="danger" onClick={cancel} disabled={busy}>
                  {busy ? "Cancelling…" : "Cancel reservation"}
                </button>
                <button className="secondary" onClick={() => setSelected(null)}>
                  Keep it
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function stateLabel(s: string): string {
  switch (s) {
    case "available":
      return "available";
    case "yours":
      return "your reservation";
    case "blocked":
      return "blocked";
    default:
      return "unavailable";
  }
}

function stateTag(s: string): string {
  switch (s) {
    case "available":
      return "open";
    case "yours":
      return "yours";
    case "blocked":
      return "blocked";
    default:
      return "taken";
  }
}
