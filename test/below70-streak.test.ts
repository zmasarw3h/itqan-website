import { describe, expect, it } from "vitest";
import {
  latestCompletedTrackerWeekStart,
  normalizeBelow70ResetNote,
  parseBelow70StreakReadRow,
  parseBelow70StreakResetResult,
  resetBoundaryForThroughWeek
} from "@/lib/below70-streak";
import { calculateBelow70Streak, calculateWeekScoreForStudent, weekIsComplete } from "@/lib/leaderboard";
import { weekDatesFromStart } from "@/lib/dates";

function below70Streak(weeks: string[], minimumWeekStart: string, resetBoundary?: string | null) {
  return calculateBelow70Streak({
    completedWeekStartsDescending: weeks,
    minimumWeekStart,
    resetEffectiveThroughWeekStart: resetBoundary,
    checkinsByWeek: new Map(),
    partnerRecitationsByWeek: new Map(),
    halaqaGradeByWeek: new Map()
  });
}

describe("below-70 streak reset contracts", () => {
  it("counts exactly three and more than three consecutive completed below-70 weeks", () => {
    expect(below70Streak(["2026-08-02", "2026-07-26", "2026-07-19"], "2026-07-19")).toBe(3);
    expect(below70Streak(["2026-08-02", "2026-07-26", "2026-07-19", "2026-07-12"], "2026-07-12")).toBe(4);
  });

  it("keeps zero, one, and two-week streaks below the reset threshold", () => {
    expect(below70Streak(["2026-08-02"], "2026-08-09")).toBe(0);
    expect(below70Streak(["2026-08-02"], "2026-08-02")).toBe(1);
    expect(below70Streak(["2026-08-02", "2026-07-26"], "2026-07-26")).toBe(2);
  });

  it("makes the reset boundary exclusive and starts a fresh streak later", () => {
    expect(
      below70Streak(
        ["2026-08-16", "2026-08-09", "2026-08-02", "2026-07-26", "2026-07-19"],
        "2026-07-19",
        "2026-08-02"
      )
    ).toBe(2);
    expect(below70Streak(["2026-08-02", "2026-07-26", "2026-07-19"], "2026-07-19", "2026-08-02")).toBe(0);
    expect(resetBoundaryForThroughWeek("2026-08-02", "2026-07-26")).toBeNull();
    expect(resetBoundaryForThroughWeek("2026-08-02", "2026-08-02")).toBe("2026-08-02");
  });

  it("preserves passing, missing, ungraded, incomplete, and non-consecutive policy behavior", () => {
    const passingWeek = "2026-08-02";
    const passingCheckins = weekDatesFromStart(passingWeek).map((date) => ({
      student_id: "student-1",
      date,
      daily_score: 100
    }));
    expect(
      calculateWeekScoreForStudent({
        weekStart: passingWeek,
        checkins: passingCheckins,
        partnerRecitations: [],
        halaqaGrade: null
      }).percentage
    ).toBe(70);
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: [passingWeek, "2026-07-26"],
        minimumWeekStart: "2026-07-26",
        checkinsByWeek: new Map([[passingWeek, passingCheckins]]),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(0);
    expect(below70Streak(["2026-08-09", "2026-08-02"], "2026-08-02", undefined)).toBe(2);
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: ["2026-08-09", "2026-08-02", "2026-07-26"],
        minimumWeekStart: "2026-07-26",
        eligibleWeekStarts: new Set(["2026-08-09", "2026-07-26"]),
        checkinsByWeek: new Map(),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(1);
    expect(weekIsComplete("2026-08-09", "2026-08-15")).toBe(false);
    expect(weekIsComplete("2026-08-02", "2026-08-09")).toBe(true);
  });

  it("uses the Toronto 1:00 a.m. effective-date boundary for Saturday and Sunday", () => {
    expect(latestCompletedTrackerWeekStart(new Date("2026-08-08T04:30:00.000Z"))).toBe("2026-07-26");
    expect(latestCompletedTrackerWeekStart(new Date("2026-08-08T05:00:00.000Z"))).toBe("2026-07-26");
    expect(latestCompletedTrackerWeekStart(new Date("2026-08-09T04:30:00.000Z"))).toBe("2026-07-26");
    expect(latestCompletedTrackerWeekStart(new Date("2026-08-09T05:00:00.000Z"))).toBe("2026-08-02");
  });

  it("validates concise notes and typed read/reset responses", () => {
    expect(normalizeBelow70ResetNote("  Passed after test  ")).toBe("Passed after test");
    expect(normalizeBelow70ResetNote("   ")).toBeNull();
    expect(() => normalizeBelow70ResetNote("x".repeat(281))).toThrow("280 characters");
    expect(() => normalizeBelow70ResetNote("bad\nlog")).toThrow("control characters");

    expect(
      parseBelow70StreakReadRow({
        student_id: "student-1",
        active_streak_length: 0,
        streak_through_week_start: "2026-08-02",
        latest_reset_id: "reset-1",
        latest_reset_masjid_id: "masjid-1",
        latest_reset_cohort_id: "cohort-1",
        latest_reset_group_id: "group-1",
        latest_reset_effective_through_week_start: "2026-08-02",
        latest_reset_previous_streak_length: 4,
        latest_reset_passed_test_confirmation: true,
        latest_reset_admin_note: "Passed",
        latest_reset_actor_id: "admin-1",
        latest_reset_created_at: "2026-08-09T05:00:00.000Z"
      }).latest_reset_previous_streak_length
    ).toBe(4);
    const studentProjection = parseBelow70StreakReadRow({
      student_id: "student-1",
      active_streak_length: 0,
      streak_through_week_start: "2026-08-02",
      latest_reset_id: null,
      latest_reset_masjid_id: null,
      latest_reset_cohort_id: null,
      latest_reset_group_id: null,
      latest_reset_effective_through_week_start: null,
      latest_reset_previous_streak_length: null,
      latest_reset_passed_test_confirmation: null,
      latest_reset_admin_note: null,
      latest_reset_actor_id: null,
      latest_reset_created_at: null
    });
    expect(studentProjection.active_streak_length).toBe(0);
    expect(studentProjection.latest_reset_id).toBeNull();
    expect(studentProjection.latest_reset_admin_note).toBeNull();
    expect(studentProjection.latest_reset_actor_id).toBeNull();
    expect(
      parseBelow70StreakResetResult({
        status: "reset",
        reset_id: "reset-1",
        student_id: "student-1",
        masjid_id: "masjid-1",
        cohort_id: "cohort-1",
        halaqa_group_id: "group-1",
        effective_through_week_start: "2026-08-02",
        previous_streak_length: 3,
        passed_test_confirmation: true,
        admin_note: null,
        actor_id: "admin-1",
        created_at: "2026-08-09T05:00:00.000Z",
        active_streak_length: 0
      }).status
    ).toBe("reset");
  });
});
