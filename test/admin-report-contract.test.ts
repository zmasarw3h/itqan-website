import { describe, expect, it } from "vitest";
import { adaptWeeklyFollowUpContract, weeklyFollowUpRows } from "@/lib/admin-report-contract";
import type { WeeklyIncentiveReport, WeeklyIncentiveScoreRow } from "@/lib/weekly-incentives";

function row(weekStart: string, weeklyPercentage = 50): WeeklyIncentiveScoreRow {
  return { studentId: "student-1", studentName: "Student One", studentEmail: null, studentPhone: null, canViewCurrentContact: false, canOpenCurrentProfile: true, masjidName: "Masjid", cohortName: "Brothers", groupName: "Group 1", weekStart, weeklyPercentage, badgesAwarded: 0, accountabilityAmountCents: 1000 };
}

describe("weekly follow-up contract adapter", () => {
  it("isolates the three-plus streak fallback until the backend fields are available", () => {
    const selected = row("2026-08-02");
    const report: WeeklyIncentiveReport = { selectedWeekStart: "2026-08-02", selectedWeekLabel: "Aug 2–8, 2026", mostBadgesThisWeek: [], below70ThisWeek: [selected], below70TwoWeeksStraight: [selected], passingThreeWeeksStraight: [], rows: [selected, row("2026-07-26"), row("2026-07-19")] };
    expect(weeklyFollowUpRows(report, "below70")[0].below70Streak).toBe(3);
    expect(weeklyFollowUpRows(report, "three-plus")).toHaveLength(1);
    expect(weeklyFollowUpRows(report, "pending")).toEqual([]);
  });

  it("prefers the future row-level backend streak contract", () => {
    const selected = { ...row("2026-08-02"), below70Streak: 6 };
    const report = { selectedWeekStart: "2026-08-02", selectedWeekLabel: "Aug 2–8, 2026", mostBadgesThisWeek: [], below70ThisWeek: [selected], below70TwoWeeksStraight: [], passingThreeWeeksStraight: [], rows: [selected], below70ThreePlusWeeks: [selected] };
    expect(weeklyFollowUpRows(report, "three-plus")[0].below70Streak).toBe(6);
  });

  it("isolates future top-level backend fields from the report UI", () => {
    const selected = row("2026-08-02");
    const base: WeeklyIncentiveReport = { selectedWeekStart: "2026-08-02", selectedWeekLabel: "Aug 2–8, 2026", mostBadgesThisWeek: [], below70ThisWeek: [selected], below70TwoWeeksStraight: [], passingThreeWeeksStraight: [], rows: [selected] };
    const adapted = adaptWeeklyFollowUpContract(base, {
      pendingAccountabilityRows: [selected],
      below70ThreePlusWeeks: [selected]
    });
    expect(weeklyFollowUpRows(adapted, "pending")).toHaveLength(1);
    expect(weeklyFollowUpRows(adapted, "three-plus")).toHaveLength(1);
  });
});
