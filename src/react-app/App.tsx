import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { MeResponse } from "../shared/types";
import { api } from "./api";
import { SessionContext } from "./session";
import { Layout } from "./components/Layout";
import { SignIn } from "./pages/SignIn";
import { Onboarding } from "./pages/Onboarding";
import { Pending } from "./pages/Pending";
import { Rejected } from "./pages/Rejected";
import { Suspended } from "./pages/Suspended";
import { CalendarPage } from "./pages/CalendarPage";
import { MyBookings } from "./pages/MyBookings";
import { Notifications } from "./pages/Notifications";
import { Rebook } from "./pages/Rebook";
import { Profile } from "./pages/Profile";
import { AdminPage } from "./pages/AdminPage";

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await api.me();
    setMe(data);
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  if (loading || !me) {
    return (
      <div className="center" aria-busy="true">
        Loading…
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ me, user: me.user, reload }}>
      <RoutedApp />
    </SessionContext.Provider>
  );
}

function RoutedApp() {
  const location = useLocation();

  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/pending" element={<Pending />} />
      <Route path="/rejected" element={<Rejected />} />
      <Route path="/suspended" element={<Suspended />} />
      <Route element={<Layout />}>
        <Route path="/" element={<CalendarPage />} />
        <Route path="/bookings" element={<MyBookings />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/rebook" element={<Rebook />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin/*" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
    </Routes>
  );
}
