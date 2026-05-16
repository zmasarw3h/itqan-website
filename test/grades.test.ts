import { describe, expect, it } from "vitest";
import { buildHalaqaFeedbackDisplay, buildWeeklyGradeBreakdown, studentGradesScope } from "@/lib/grades";

describe("student grades", () => {
  it("builds a weekly score breakdown for the grades page", () => {
    expect(
      buildWeeklyGradeBreakdown({
        weekDates: [
          "2026-05-10",
          "2026-05-11",
          "2026-05-12",
          "2026-05-13",
          "2026-05-14",
          "2026-05-15",
          "2026-05-16"
        ],
        checkins: [
          { date: "2026-05-10", daily_score: 100 },
          { date: "2026-05-11", daily_score: 80 },
          { date: "2026-05-14", daily_score: 90 }
        ],
        partnerRecitations: [
          { round: "round_1", points: 75 },
          { round: "round_2", points: 75 }
        ],
        halaqaGrade: { attendance_points: 100, recitation_points: 45 }
      })
    ).toEqual({
      daily_points: 270,
      partner_points: 150,
      halaqa_points: 145,
      total_points: 565,
      total_possible: 1000,
      percentage: 56.5
    });
  });

  it("scopes student grades to the signed-in student's id", () => {
    expect(studentGradesScope("student-1", "2026-05-10", ["2026-05-10"])).toEqual({
      studentId: "student-1",
      weekStart: "2026-05-10",
      weekDates: ["2026-05-10"]
    });
    expect(() => studentGradesScope("", "2026-05-10", ["2026-05-10"])).toThrow("Student id is required");
  });

  it("builds student halaqa feedback display from stored grade data", () => {
    expect(
      buildHalaqaFeedbackDisplay({
        attended: true,
        attendance_points: 100,
        recitation_points: 35,
        notes: "Needs steadier revision."
      })
    ).toEqual({
      attended: true,
      attendanceLabel: "Present",
      recitationMarkOutOf10: 7,
      recitationPoints: 35,
      halaqaPoints: 135,
      notes: "Needs steadier revision."
    });
  });
});
