import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { useSession } from "../session";
import { api } from "../api";

export function Layout() {
  const { user } = useSession();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (user?.status === "approved") {
      api
        .notifications()
        .then((r) => setUnread(r.notifications.filter((n) => !n.readAt).length))
        .catch(() => {});
    }
  }, [user]);

  if (!user) return <Navigate to="/signin" replace />;
  if (user.status === "suspended") return <Navigate to="/suspended" replace />;
  if (user.status === "rejected") return <Navigate to="/rejected" replace />;
  if (user.status === "pending") {
    return <Navigate to={user.addressId ? "/pending" : "/onboarding"} replace />;
  }

  return (
    <>
      <header className="appbar">
        <h1>Clubhouse Scheduler</h1>
        <NavLink to="/profile" aria-label="Profile" style={{ textDecoration: "none" }}>
          {user.name ?? user.email}
        </NavLink>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Primary">
        <NavLink to="/" end>
          Calendar
        </NavLink>
        <NavLink to="/bookings">My Bookings</NavLink>
        <NavLink to="/notifications">
          Alerts{unread > 0 && <span className="badge">{unread}</span>}
        </NavLink>
        {user.isAdmin && <NavLink to="/admin">Admin</NavLink>}
      </nav>
    </>
  );
}
