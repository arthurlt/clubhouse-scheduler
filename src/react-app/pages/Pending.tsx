import { Navigate } from "react-router-dom";
import { useSession } from "../session";
import { LogoutButton } from "../components/LogoutButton";

export function Pending() {
  const { user } = useSession();
  if (!user) return <Navigate to="/signin" replace />;
  if (user.status === "approved") return <Navigate to="/" replace />;
  if (user.status === "pending" && !user.addressId) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className="content">
      <div className="card center">
        <h2>Awaiting board approval</h2>
        <p className="muted">
          Thanks, {user.name ?? user.email}. Your request for{" "}
          <strong>{user.addressLabel}</strong> is pending review by an HOA board member.
          You'll be able to view availability and book once approved.
        </p>
        <LogoutButton />
      </div>
    </div>
  );
}
