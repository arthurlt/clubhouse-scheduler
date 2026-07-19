// Types shared between the Worker API and the React app.

export type UserStatus = "pending" | "approved" | "suspended" | "rejected";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  status: UserStatus;
  isAdmin: boolean;
  addressId: string | null;
  addressLabel: string | null;
  rejectionReason: string | null;
}

export interface MeResponse {
  user: SessionUser | null;
  devAuth: boolean;
  timezone: string;
  horizonDays: number;
}

export interface AddressOption {
  id: string;
  label: string;
}

// Calendar day states, per the privacy matrix. `unavailable` never leaks identity.
export type DayState = "available" | "yours" | "unavailable" | "blocked";

export interface CalendarDay {
  day: string; // YYYY-MM-DD (community timezone civil date)
  state: DayState;
  blockMessage?: string | null; // only for blocked days (public message)
}

export interface CalendarResponse {
  today: string;
  horizonDays: number;
  timezone: string;
  days: CalendarDay[];
}

export interface Booking {
  id: string;
  day: string;
  status: "active" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
  cancelledByAdmin: boolean;
}

export interface AdminBookingView extends Booking {
  userName: string | null;
  userEmail: string;
  addressLabel: string | null;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  day: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AdminMember {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  isAdmin: boolean;
  addressLabel: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface EmailJobView {
  id: string;
  toEmail: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  failedAt: string | null;
}

export interface CommunitySettings {
  timezone: string;
  horizonDays: number;
}

export interface ApiError {
  error: string;
  message?: string;
}
