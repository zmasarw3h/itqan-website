import { describe, expect, it } from "vitest";
import {
  currentWeekDates,
  formatWeekRange,
  isValidDateString,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";

describe("check-in date reset", () => {
  it("returns the previous date before the reset hour in America/Toronto", () => {
    expect(todayDateString(new Date("2026-05-11T04:30:00.000Z"))).toBe("2026-05-10");
  });

  it("returns the current date at the reset hour in America/Toronto", () => {
    expect(todayDateString(new Date("2026-05-11T05:00:00.000Z"))).toBe("2026-05-11");
  });

  it("returns the current date after the reset hour in America/Toronto", () => {
    expect(todayDateString(new Date("2026-05-11T12:00:00.000Z"))).toBe("2026-05-11");
  });

  it("builds Sunday-Saturday tracker weeks", () => {
    expect(currentWeekDates("2026-05-13")).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16"
    ]);
  });

  it("returns the Sunday start date for a week", () => {
    expect(weekStartForDate("2026-05-13")).toBe("2026-05-10");
    expect(weekStartForDate("2026-05-10")).toBe("2026-05-10");
  });

  it("builds week dates from a Sunday start", () => {
    expect(weekDatesFromStart("2026-05-10")).toEqual([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16"
    ]);
  });

  it("formats week ranges", () => {
    expect(formatWeekRange("2026-05-10")).toBe("May 10–16, 2026");
    expect(formatWeekRange("2026-05-31")).toBe("May 31–Jun 6, 2026");
  });

  it("validates date strings", () => {
    expect(isValidDateString("2026-05-10")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("not-a-date")).toBe(false);
  });
});
