import { Navigate } from "react-router-dom";
import { useSession } from "../session";
import { LogoutButton } from "../components/LogoutButton";

export function Suspended() {
  const { user } = useSession();
  if (!user) return <Navigate to="/signin" replace />;
  if (user.status !== "suspended") return <Navigate to="/" replace />;

  return (
    <div className="content">
      <div className="card center">
        <h2>Account suspended</h2>
        <p className="muted">
          Your account is suspended and cannot make bookings. Please contact the HOA
          board for details.
        </p>
        <LogoutButton />
      </div>
    </div>
  );
}
