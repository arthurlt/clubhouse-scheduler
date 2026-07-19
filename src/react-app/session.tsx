import { createContext, useContext } from "react";
import type { MeResponse, SessionUser } from "../shared/types";

export interface SessionContextValue {
  me: MeResponse;
  user: SessionUser | null;
  reload: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
