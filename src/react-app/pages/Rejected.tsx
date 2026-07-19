import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "../session";
import { LogoutButton } from "../components/LogoutButton";

export function Rejected() {
  const { user } = useSession();
  const navigate = useNavigate();
  if (!user) return <Navigate to="/signin" replace />;
  if (user.status !== "rejected") return <Navigate to="/" replace />;

  return (
    <div className="content">
      <div className="card">
        <h2>Request not approved</h2>
        <p className="muted">Your membership request was not approved.</p>
        {user.rejectionReason && (
          <div className="error" role="status">
            Reason: {user.rejectionReason}
          </div>
        )}
        <p className="muted">
          If you selected the wrong address, you can choose a different one and
          resubmit.
        </p>
        <button onClick={() => navigate("/onboarding")} style={{ width: "100%" }}>
          Change address &amp; resubmit
        </button>
        <div style={{ marginTop: 12 }}>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
