import { useSession } from "../session";
import { LogoutButton } from "../components/LogoutButton";

export function Profile() {
  const { user } = useSession();
  if (!user) return null;

  return (
    <div className="card">
      <h2>Profile</h2>
      <div className="row">
        <span className="muted">Name</span>
        <span>{user.name ?? "—"}</span>
      </div>
      <div className="row">
        <span className="muted">Email</span>
        <span>{user.email}</span>
      </div>
      <div className="row">
        <span className="muted">Address</span>
        <span>{user.addressLabel ?? "—"}</span>
      </div>
      <div className="row">
        <span className="muted">Status</span>
        <span className={`pill ${user.status === "approved" ? "active" : "pending"}`}>
          {user.status}
        </span>
      </div>
      <div className="row">
        <span className="muted">Role</span>
        <span>{user.isAdmin ? "Board admin" : "Member"}</span>
      </div>
      <div style={{ marginTop: 16 }}>
        <LogoutButton />
      </div>
    </div>
  );
}
