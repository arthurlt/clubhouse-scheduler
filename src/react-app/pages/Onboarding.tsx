import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { AddressOption } from "../../shared/types";
import { useSession } from "../session";
import { api, ApiError } from "../api";

export function Onboarding() {
  const { user, reload } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AddressOption[]>([]);
  const [selected, setSelected] = useState<AddressOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchAddresses(q.trim())
        .then((r) => setResults(r.addresses))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!user) return <Navigate to="/signin" replace />;
  if (user.status === "approved") return <Navigate to="/" replace />;

  async function claim() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.claimAddress(selected.id);
      await reload();
      navigate("/pending");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content">
      <div className="card">
        <h2>Find your address</h2>
        <p className="muted">
          Select your household address from the community allowlist. A board member
          reviews every request before you can book.
        </p>
        {error && <div className="error">{error}</div>}
        <label htmlFor="addr">Search address</label>
        <input
          id="addr"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSelected(null);
          }}
          placeholder="e.g. 12 Maple"
          autoComplete="off"
        />
        {results.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {results.map((a) => (
              <div className="row" key={a.id}>
                <span>{a.label}</span>
                <button
                  className={selected?.id === a.id ? "" : "secondary"}
                  onClick={() => setSelected(a)}
                  aria-pressed={selected?.id === a.id}
                >
                  {selected?.id === a.id ? "Selected" : "Select"}
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={claim}
          disabled={!selected || busy}
          style={{ marginTop: 16, width: "100%" }}
        >
          {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </div>
  );
}
