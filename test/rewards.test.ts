import { describe, expect, it } from "vitest";
import {
  badgeAwardBelongsToStudent,
  buildMonthlyBadgeLeaderboard,
  buildStudentRewardSummary,
  monthStartForDate,
  type RewardBadgeAward,
  type RewardStudent
} from "@/lib/rewards";
import type { Profile } from "@/lib/types";

const studentA: Profile = {
  id: "student-a",
  name: "Student A",
  email: "student-a@itqan.local",
  phone: null,
  role: "student",
  active: true
};

const studentB: Profile = {
  id: "student-b",
  name: "Student B",
  email: "student-b@itqan.local",
  phone: "+1 555 0102",
  role: "student",
  active: true
};

function award(overrides: Partial<RewardBadgeAward> = {}): RewardBadgeAward {
  return {
    id: "award-1",
    student_id: studentA.id,
    week_start: "2026-06-07",
    weekly_percentage: 95,
    badges_awarded: 5,
    created_at: "2026-06-14T12:00:00.000Z",
    ...overrides
  };
}

describe("badge rewards", () => {
  it("aggregates total and month badge counts", () => {
    expect(
      buildStudentRewardSummary({
        monthStart: "2026-06-01",
        awards: [
          award({ badges_awarded: 5, week_start: "2026-06-07" }),
          award({ id: "award-2", badges_awarded: 3, week_start: "2026-06-14" }),
          award({ id: "award-3", badges_awarded: 10, week_start: "2026-05-24" })
        ]
      })
    ).toMatchObject({
      totalBadges: 18,
      monthBadges: 8
    });
  });

  it("keeps reward summaries focused on badge totals", () => {
    expect(
      buildStudentRewardSummary({
        monthStart: "2026-06-01",
        awards: [award({ badges_awarded: 30 })]
      })
    ).toEqual({
      totalBadges: 30,
      monthBadges: 30
    });
  });

  it("checks that students only own their own badge awards", () => {
    expect(badgeAwardBelongsToStudent(studentA, award({ student_id: studentA.id }))).toBe(true);
    expect(badgeAwardBelongsToStudent(studentA, award({ student_id: studentB.id }))).toBe(false);
  });

  it("orders admin monthly leaderboard by selected month badges, lifetime badges, then name", () => {
    const students: RewardStudent[] = [studentA, studentB];
    const rows = buildMonthlyBadgeLeaderboard({
      students,
      monthStart: "2026-06-01",
      awards: [
        award({ student_id: studentA.id, badges_awarded: 5, week_start: "2026-06-07" }),
        award({ id: "award-2", student_id: studentB.id, badges_awarded: 7, week_start: "2026-06-07" }),
        award({ id: "award-3", student_id: studentA.id, badges_awarded: 20, week_start: "2026-05-24" })
      ]
    });

    expect(rows.map((row) => [row.rank, row.studentId, row.monthBadges, row.lifetimeBadges])).toEqual([
      [1, studentB.id, 7, 7],
      [2, studentA.id, 5, 25]
    ]);
  });

  it("derives month start from a date", () => {
    expect(monthStartForDate("2026-06-27")).toBe("2026-06-01");
  });
});
