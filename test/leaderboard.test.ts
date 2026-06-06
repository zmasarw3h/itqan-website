import { describe, expect, it } from "vitest";
import { calculateBelow70Streak, leaderboardRowsToCsv, type LeaderboardRow } from "@/lib/leaderboard";

function leaderboardRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    studentId: "student-1",
    studentName: "Student One",
    studentEmail: "student@example.com",
    studentPhone: "+1 555 0101",
    score: {
      daily_points: 700,
      partner_points: 150,
      halaqa_points: 150,
      total_points: 1000,
      total_possible: 1000,
      percentage: 100
    },
    status: "passing",
    below70Streak: 0,
    ...overrides
  };
}

describe("leaderboard CSV export", () => {
  it("does not count below-70 streak weeks before the May 31-June 6, 2026 cutoff", () => {
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: ["2026-05-31", "2026-05-24"],
        checkinsByWeek: new Map(),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(1);
  });

  it("escapes spreadsheet formula prefixes in user-controlled fields", () => {
    const csv = leaderboardRowsToCsv([
      leaderboardRow({
        studentName: "=cmd",
        studentPhone: "+15550101",
        studentEmail: "@student.example"
      })
    ]);

    expect(csv).toContain("1,'=cmd,'+15550101,'@student.example");
  });

  it("quotes commas and quotes after formula-prefix escaping", () => {
    const csv = leaderboardRowsToCsv([
      leaderboardRow({
        studentName: '-Student, "One"'
      })
    ]);

    expect(csv).toContain('"\'-Student, ""One"""');
  });
});
