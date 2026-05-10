import { describe, expect, it } from "vitest";
import { todayDateString } from "@/lib/dates";

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
});
