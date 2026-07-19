import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../session";
import { api, ApiError } from "../api";

export function SignIn() {
  const { me, user, reload } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.devLogin(email.trim(), name.trim() || undefined);
      await reload();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content">
      <div className="card">
        <h2>Welcome</h2>
        <p className="muted">
          Reserve the HOA clubhouse for a full day. Sign in to view availability and
          book.
        </p>
        <a className="btn" href="/api/auth/google/start" style={{ width: "100%" }}>
          Continue with Google
        </a>
      </div>

      {me.devAuth && (
        <div className="card">
          <h3>Developer sign-in</h3>
          <p className="muted">
            Local dev only. Enter any email to create a session (bypasses Google).
          </p>
          {error && <div className="error">{error}</div>}
          <form onSubmit={devLogin}>
            <label htmlFor="dev-email">Email</label>
            <input
              id="dev-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <label htmlFor="dev-name">Name (optional)</label>
            <input
              id="dev-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Member"
            />
            <button type="submit" disabled={busy} style={{ marginTop: 16, width: "100%" }}>
              {busy ? "Signing in…" : "Dev sign in"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
