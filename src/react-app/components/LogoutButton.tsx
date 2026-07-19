import { useNavigate } from "react-router-dom";
import { useSession } from "../session";
import { api } from "../api";

export function LogoutButton() {
  const { reload } = useSession();
  const navigate = useNavigate();

  async function logout() {
    await api.logout().catch(() => {});
    await reload();
    navigate("/signin");
  }

  return (
    <button className="secondary" onClick={logout}>
      Sign out
    </button>
  );
}
