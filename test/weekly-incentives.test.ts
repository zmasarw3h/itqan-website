import { describe, expect, it } from "vitest";
import {
  accountabilityAppliesToWeek,
  buildWeeklyIncentiveReport,
  computedBadgeAwardFromRow,
  type WeeklyIncentiveScoreRow
} from "@/lib/weekly-incentives";

function row(overrides: Partial<WeeklyIncentiveScoreRow> = {}): WeeklyIncentiveScoreRow {
  const weeklyPercentage = overrides.weeklyPercentage ?? 95;

  return {
    studentId: "student-a",
    studentName: "Student A",
    studentEmail: "student-a@itqan.local",
    studentPhone: null,
    weekStart: "2026-05-31",
    weeklyPercentage,
    badgesAwarded: weeklyPercentage > 90 ? Math.floor(weeklyPercentage) - 90 : 0,
    accountabilityAmountCents: weeklyPercentage < 70 ? Math.ceil((70 - weeklyPercentage) / 10) * 500 : 0,
    ...overrides
  };
}

describe("weekly incentive reports", () => {
  it("keeps accountability obligations scoped to the May 31-June 6, 2026 week and later", () => {
    expect(accountabilityAppliesToWeek("2026-05-24")).toBe(false);
    expect(accountabilityAppliesToWeek("2026-05-31")).toBe(true);
  });

  it("computes badge awards from completed weekly scores", () => {
    expect(computedBadgeAwardFromRow(row({ weeklyPercentage: 95, badgesAwarded: 5 }))).toMatchObject({
      student_id: "student-a",
      week_start: "2026-05-31",
      weekly_percentage: 95,
      badges_awarded: 5
    });
    expect(computedBadgeAwardFromRow(row({ weeklyPercentage: 90, badgesAwarded: 0 }))).toBeNull();
  });

  it("orders the weekly badge report by badges, score, then student name", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31"],
      rows: [
        row({ studentId: "student-b", studentName: "Student B", weeklyPercentage: 94, badgesAwarded: 4 }),
        row({ studentId: "student-a", studentName: "Student A", weeklyPercentage: 96, badgesAwarded: 6 })
      ]
    });

    expect(report.mostBadgesThisWeek.map((studentRow) => studentRow.studentId)).toEqual(["student-a", "student-b"]);
  });

  it("lists students below 70 for the selected week", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31"],
      rows: [
        row({ studentId: "student-a", weeklyPercentage: 69, accountabilityAmountCents: 500 }),
        row({ studentId: "student-b", weeklyPercentage: 70, badgesAwarded: 0 })
      ]
    });

    expect(report.below70ThisWeek.map((studentRow) => studentRow.studentId)).toEqual(["student-a"]);
  });

  it("identifies students below 70 for two completed weeks straight", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31", "2026-05-24"],
      rows: [
        row({ studentId: "student-a", weekStart: "2026-05-31", weeklyPercentage: 59 }),
        row({ studentId: "student-a", weekStart: "2026-05-24", weeklyPercentage: 69 }),
        row({ studentId: "student-b", weekStart: "2026-05-31", weeklyPercentage: 59 }),
        row({ studentId: "student-b", weekStart: "2026-05-24", weeklyPercentage: 70 })
      ]
    });

    expect(report.below70TwoWeeksStraight.map((studentRow) => studentRow.studentId)).toEqual(["student-a"]);
  });

  it("identifies students at 70% or above for three completed weeks straight", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31", "2026-05-24", "2026-05-17"],
      rows: [
        row({ studentId: "student-a", weekStart: "2026-05-31", weeklyPercentage: 90, badgesAwarded: 0 }),
        row({ studentId: "student-a", weekStart: "2026-05-24", weeklyPercentage: 80, badgesAwarded: 0 }),
        row({ studentId: "student-a", weekStart: "2026-05-17", weeklyPercentage: 70, badgesAwarded: 0 }),
        row({ studentId: "student-b", weekStart: "2026-05-31", weeklyPercentage: 95, badgesAwarded: 5 }),
        row({ studentId: "student-b", weekStart: "2026-05-24", weeklyPercentage: 80, badgesAwarded: 0 }),
        row({ studentId: "student-b", weekStart: "2026-05-17", weeklyPercentage: 69, badgesAwarded: 0 })
      ]
    });

    expect(report.passingThreeWeeksStraight.map((studentRow) => studentRow.studentId)).toEqual(["student-a"]);
  });
});
