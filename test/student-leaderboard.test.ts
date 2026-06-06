import { describe, expect, it } from "vitest";
import {
  buildStudentLeaderboardRows,
  studentRankChangeLabel,
  studentRankChangeSymbol
} from "@/lib/student-leaderboard";
import type { LeaderboardRow } from "@/lib/leaderboard";

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

describe("student leaderboard", () => {
  it("returns sanitized rows with current-student highlighting and rank changes", () => {
    const rows = buildStudentLeaderboardRows({
      currentStudentId: "student-2",
      currentRows: [
        leaderboardRow({ rank: 1, studentId: "student-1", studentName: "A Student" }),
        leaderboardRow({
          rank: 2,
          studentId: "student-2",
          studentName: "Current Student",
          score: {
            daily_points: 600,
            partner_points: 150,
            halaqa_points: 100,
            total_points: 850,
            total_possible: 1000,
            percentage: 85
          }
        })
      ],
      previousRows: [
        leaderboardRow({ rank: 1, studentId: "student-2", studentName: "Current Student" }),
        leaderboardRow({ rank: 2, studentId: "student-1", studentName: "A Student" })
      ]
    });

    expect(rows).toEqual([
      expect.objectContaining({
        rank: 1,
        previousRank: 2,
        rankChange: 1,
        studentName: "A Student",
        scorePercentage: 100,
        totalPoints: 1000,
        isCurrentStudent: false
      }),
      expect.objectContaining({
        rank: 2,
        previousRank: 1,
        rankChange: -1,
        studentName: "Current Student",
        scorePercentage: 85,
        totalPoints: 850,
        isCurrentStudent: true
      })
    ]);
    expect("studentEmail" in rows[0]).toBe(false);
    expect("studentPhone" in rows[0]).toBe(false);
  });

  it("marks students without a previous rank as new", () => {
    const rows = buildStudentLeaderboardRows({
      currentStudentId: "student-1",
      currentRows: [leaderboardRow()],
      previousRows: []
    });

    expect(rows[0].previousRank).toBeNull();
    expect(rows[0].rankChange).toBeNull();
    expect(studentRankChangeLabel(rows[0].rankChange)).toBe("New");
    expect(studentRankChangeSymbol(rows[0].rankChange)).toBe("New");
  });

  it("formats rank movement for the student-facing table", () => {
    expect(studentRankChangeLabel(3)).toBe("Up 3");
    expect(studentRankChangeSymbol(3)).toBe("+3");
    expect(studentRankChangeLabel(-2)).toBe("Down 2");
    expect(studentRankChangeSymbol(-2)).toBe("-2");
    expect(studentRankChangeLabel(0)).toBe("Same");
    expect(studentRankChangeSymbol(0)).toBe("-");
  });
});
