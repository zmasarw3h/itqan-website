import { describe, expect, it } from "vitest";
import { currentWeekDates, todayDateString } from "@/lib/dates";

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
});
