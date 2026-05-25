import { describe, expect, it } from "vitest";
import { leaderboardRowsToCsv, type LeaderboardRow } from "@/lib/leaderboard";

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
