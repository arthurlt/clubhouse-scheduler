import type {
  AddressOption,
  AdminBookingView,
  AdminMember,
  AppNotification,
  Booking,
  CalendarResponse,
  CommunitySettings,
  EmailJobView,
  MeResponse,
} from "../shared/types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new ApiError(message, res.status, data?.error);
  }
  return data as T;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const api = {
  me: () => req<MeResponse>("/api/auth/me"),
  devLogin: (email: string, name?: string) =>
    req<{ ok: boolean }>("/api/auth/dev/login", {
      method: "POST",
      body: JSON.stringify({ email, name }),
    }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  searchAddresses: (q: string) =>
    req<{ addresses: AddressOption[] }>(`/api/addresses/search?q=${encodeURIComponent(q)}`),
  claimAddress: (addressId: string) =>
    req<{ ok: boolean }>("/api/onboarding/claim", {
      method: "POST",
      body: JSON.stringify({ addressId }),
    }),

  calendar: () => req<CalendarResponse>("/api/calendar"),
  myBookings: () => req<{ bookings: Booking[] }>("/api/bookings/mine"),
  book: (day: string) =>
    req<{ ok: boolean }>("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ day }),
    }),
  cancelBooking: (id: string) =>
    req<{ ok: boolean }>(`/api/bookings/${id}`, { method: "DELETE" }),
  rebookSuggestions: () => req<{ suggestions: string[] }>("/api/rebook/suggestions"),

  notifications: () => req<{ notifications: AppNotification[] }>("/api/notifications"),
  markRead: (id: string) =>
    req<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () =>
    req<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" }),

  admin: {
    members: (status?: string) =>
      req<{ members: AdminMember[] }>(
        `/api/admin/members${status ? `?status=${status}` : ""}`,
      ),
    approve: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/members/${id}/approve`, { method: "POST" }),
    reject: (id: string, reason: string) =>
      req<{ ok: boolean }>(`/api/admin/members/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    suspend: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/members/${id}/suspend`, { method: "POST" }),
    reinstate: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/members/${id}/reinstate`, { method: "POST" }),
    promote: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/members/${id}/promote`, { method: "POST" }),
    demote: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/members/${id}/demote`, { method: "POST" }),
    bookings: () => req<{ bookings: AdminBookingView[] }>("/api/admin/bookings"),
    cancelBooking: (id: string, reason: string) =>
      req<{ ok: boolean }>(`/api/admin/bookings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    blocks: () => req<{ blocks: { day: string; message: string | null }[] }>("/api/admin/blocks"),
    addBlock: (day: string, message: string) =>
      req<{ ok: boolean }>("/api/admin/blocks", {
        method: "POST",
        body: JSON.stringify({ day, message }),
      }),
    removeBlock: (day: string) =>
      req<{ ok: boolean }>(`/api/admin/blocks/${day}`, { method: "DELETE" }),
    addresses: () => req<{ addresses: AddressOption[] }>("/api/admin/addresses"),
    addAddress: (label: string) =>
      req<{ ok: boolean; id: string }>("/api/admin/addresses", {
        method: "POST",
        body: JSON.stringify({ label }),
      }),
    removeAddress: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/addresses/${id}`, { method: "DELETE" }),
    settings: () => req<CommunitySettings>("/api/admin/settings"),
    updateSettings: (s: CommunitySettings) =>
      req<{ ok: boolean }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(s),
      }),
    audit: () => req<{ entries: Record<string, unknown>[] }>("/api/admin/audit"),
    emailJobs: (status?: string) =>
      req<{ jobs: EmailJobView[] }>(
        `/api/admin/email-jobs${status ? `?status=${status}` : ""}`,
      ),
    resendEmail: (id: string) =>
      req<{ ok: boolean }>(`/api/admin/email-jobs/${id}/resend`, { method: "POST" }),
  },
};
