import { describe, it, expect } from "vitest";
import {
  horizonDays,
  isDayInFutureOrToday,
  isValidDay,
  isWithinHorizon,
  todayInZone,
} from "../src/worker/dates";

describe("isValidDay", () => {
  it("accepts well-formed civil dates", () => {
    expect(isValidDay("2026-07-19")).toBe(true);
    expect(isValidDay("2024-02-29")).toBe(true); // leap day
  });
  it("rejects malformed or impossible dates", () => {
    expect(isValidDay("2026-7-9")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("2026-02-30")).toBe(false);
    expect(isValidDay("not-a-date")).toBe(false);
  });
});

describe("todayInZone", () => {
  it("returns the civil date in the community timezone, not UTC", () => {
    // 2026-07-19T03:30:00Z is still 2026-07-18 in America/Denver (UTC-6).
    const now = new Date("2026-07-19T03:30:00Z");
    expect(todayInZone("America/Denver", now)).toBe("2026-07-18");
    expect(todayInZone("UTC", now)).toBe("2026-07-19");
  });
});

describe("horizonDays", () => {
  it("enumerates inclusive range today..today+horizon", () => {
    const days = horizonDays("2026-07-19", 3);
    expect(days).toEqual(["2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22"]);
  });
  it("crosses month boundaries correctly", () => {
    const days = horizonDays("2026-07-30", 3);
    expect(days).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });
});

describe("isWithinHorizon", () => {
  const today = "2026-07-19";
  it("accepts today and the horizon edge", () => {
    expect(isWithinHorizon("2026-07-19", today, 90)).toBe(true);
    expect(isWithinHorizon("2026-10-17", today, 90)).toBe(true); // today + 90
  });
  it("rejects past days and beyond the horizon", () => {
    expect(isWithinHorizon("2026-07-18", today, 90)).toBe(false);
    expect(isWithinHorizon("2026-10-18", today, 90)).toBe(false); // today + 91
  });
});

describe("isDayInFutureOrToday", () => {
  it("allows cancelling today or later, blocks the past", () => {
    expect(isDayInFutureOrToday("2026-07-19", "2026-07-19")).toBe(true);
    expect(isDayInFutureOrToday("2026-07-20", "2026-07-19")).toBe(true);
    expect(isDayInFutureOrToday("2026-07-18", "2026-07-19")).toBe(false);
  });
});
