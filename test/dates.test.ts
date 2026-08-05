import { describe, expect, it } from "vitest";
import {
  currentWeekDates,
  formatDateInAppTimeZone,
  formatDateTimeInAppTimeZone,
  formatHalaqaSaturday,
  formatWeekRange,
  halaqaSaturdayForWeek,
  halaqaWeekStarts,
  isValidDateString,
  checkInEffectiveDateString,
  torontoCivilDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import { buildSuperAdminAccessChangePlan, staffMembershipIsActiveOn } from "@/lib/super-admin-access";

describe("app timezone timestamp formatting", () => {
  it("formats UTC timestamps in America/Toronto daylight time", () => {
    expect(formatDateTimeInAppTimeZone("2026-05-08T18:30:00.000Z")).toBe("May 8, 2026, 2:30 PM");
  });

  it("formats UTC timestamps in America/Toronto standard time", () => {
    expect(formatDateTimeInAppTimeZone("2026-01-08T19:30:00.000Z")).toBe("Jan 8, 2026, 2:30 PM");
  });

  it("formats dates in America/Toronto instead of UTC", () => {
    expect(formatDateInAppTimeZone("2026-05-09T02:30:00.000Z")).toBe("May 8, 2026");
  });

  it("returns an empty string for missing timestamps", () => {
    expect(formatDateTimeInAppTimeZone(null)).toBe("");
  });
});

describe("check-in date reset", () => {
  it("keeps the Toronto civil date at Sunday midnight while check-in is still Saturday", () => {
    const midnightSunday = new Date("2026-07-19T04:00:00.000Z");

    expect(torontoCivilDateString(midnightSunday)).toBe("2026-07-19");
    expect(checkInEffectiveDateString(midnightSunday)).toBe("2026-07-18");
    expect(halaqaWeekStarts(torontoCivilDateString(midnightSunday)).current).toBe("2026-07-19");
  });

  it("keeps the previous check-in date at 00:59 Toronto", () => {
    const beforeReset = new Date("2026-07-19T04:59:00.000Z");

    expect(torontoCivilDateString(beforeReset)).toBe("2026-07-19");
    expect(checkInEffectiveDateString(beforeReset)).toBe("2026-07-18");
  });

  it("uses the civil date for staff membership access throughout the pre-reset hour", () => {
    const staffMembership = {
      active: true,
      starts_on: "2026-07-19",
      ends_on: null
    };

    for (const timestamp of ["2026-07-19T04:00:00.000Z", "2026-07-19T04:59:00.000Z"]) {
      const now = new Date(timestamp);
      const civilDate = torontoCivilDateString(now);
      const checkInDate = checkInEffectiveDateString(now);

      expect(staffMembershipIsActiveOn(staffMembership, civilDate)).toBe(true);
      expect(staffMembershipIsActiveOn(staffMembership, checkInDate)).toBe(false);
    }
  });

  it("uses the civil date for access transitions while check-ins still use the preceding date", () => {
    const beforeReset = new Date("2026-07-19T04:59:00.000Z");
    const civilDate = torontoCivilDateString(beforeReset);

    const plan = buildSuperAdminAccessChangePlan({
      targetRole: "student",
      targetActive: false,
      preset: "teacher",
      selectedMasjidId: "masjid-a",
      startsOn: civilDate,
      currentDate: civilDate,
      studentMemberships: [],
      staffMemberships: []
    });

    expect(civilDate).toBe("2026-07-19");
    expect(checkInEffectiveDateString(beforeReset)).toBe("2026-07-18");
    expect(plan.nextRole).toBe("teacher");
    expect(plan.nextActive).toBe(true);
  });

  it("switches the check-in date exactly at 01:00 Toronto", () => {
    const reset = new Date("2026-07-19T05:00:00.000Z");

    expect(torontoCivilDateString(reset)).toBe("2026-07-19");
    expect(checkInEffectiveDateString(reset)).toBe("2026-07-19");
  });

  it("keeps the new check-in date at 01:01 Toronto", () => {
    const afterReset = new Date("2026-07-19T05:01:00.000Z");

    expect(torontoCivilDateString(afterReset)).toBe("2026-07-19");
    expect(checkInEffectiveDateString(afterReset)).toBe("2026-07-19");
  });

  it("returns the previous date before the reset hour in America/Toronto", () => {
    expect(checkInEffectiveDateString(new Date("2026-05-11T04:30:00.000Z"))).toBe("2026-05-10");
  });

  it("returns the current date at the reset hour in America/Toronto", () => {
    expect(checkInEffectiveDateString(new Date("2026-05-11T05:00:00.000Z"))).toBe("2026-05-11");
  });

  it("returns the current date after the reset hour in America/Toronto", () => {
    expect(checkInEffectiveDateString(new Date("2026-05-11T12:00:00.000Z"))).toBe("2026-05-11");
  });

  it("keeps the Toronto civil date distinct from the check-in effective date before 1:00 AM", () => {
    const beforeReset = new Date("2026-07-19T04:30:00.000Z");

    expect(torontoCivilDateString(beforeReset)).toBe("2026-07-19");
    expect(checkInEffectiveDateString(beforeReset)).toBe("2026-07-18");
    expect(halaqaWeekStarts(torontoCivilDateString(beforeReset)).current).toBe("2026-07-19");
  });

  it("handles the first day of a month without changing the civil date", () => {
    const firstOfMonth = new Date("2026-08-01T04:30:00.000Z");

    expect(torontoCivilDateString(firstOfMonth)).toBe("2026-08-01");
    expect(checkInEffectiveDateString(firstOfMonth)).toBe("2026-07-31");
  });

  it("handles the spring DST jump in Toronto", () => {
    const beforeReset = new Date("2026-03-08T05:30:00.000Z");
    const afterJump = new Date("2026-03-08T07:30:00.000Z");

    expect(torontoCivilDateString(beforeReset)).toBe("2026-03-08");
    expect(checkInEffectiveDateString(beforeReset)).toBe("2026-03-07");
    expect(torontoCivilDateString(afterJump)).toBe("2026-03-08");
    expect(checkInEffectiveDateString(afterJump)).toBe("2026-03-08");
  });

  it("handles both occurrences of the fall DST 1 AM hour in Toronto", () => {
    const firstOneAm = new Date("2026-11-01T05:30:00.000Z");
    const secondOneAm = new Date("2026-11-01T06:30:00.000Z");

    expect(torontoCivilDateString(firstOneAm)).toBe("2026-11-01");
    expect(checkInEffectiveDateString(firstOneAm)).toBe("2026-11-01");
    expect(torontoCivilDateString(secondOneAm)).toBe("2026-11-01");
    expect(checkInEffectiveDateString(secondOneAm)).toBe("2026-11-01");
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

  it("shows the Saturday halaqa date for a canonical Sunday tracker week", () => {
    expect(halaqaSaturdayForWeek("2026-07-19")).toBe("2026-07-25");
    expect(formatHalaqaSaturday("2026-07-19")).toBe("Saturday, July 25, 2026");
  });

  it("rejects non-Sunday halaqa week values", () => {
    expect(() => halaqaSaturdayForWeek("2026-07-25")).toThrow("Invalid tracker week start.");
  });

  it("builds stable previous, current, and next halaqa week choices", () => {
    expect(halaqaWeekStarts("2026-07-22")).toEqual({
      previous: "2026-07-12",
      current: "2026-07-19",
      next: "2026-07-26"
    });
  });

  it("validates date strings", () => {
    expect(isValidDateString("2026-05-10")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("not-a-date")).toBe(false);
  });
});
