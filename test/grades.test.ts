import { describe, expect, it } from "vitest";
import {
  buildHalaqaFeedbackDisplay,
  buildStudentBelow70Streak,
  buildWeeklyGradeBreakdown,
  completedStudentGradeWeekStartsDescending,
  studentGradesScope
} from "@/lib/grades";

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

  it("builds the student's below-70 streak from completed weekly grade data", () => {
    expect(
      buildStudentBelow70Streak({
        studentId: "student-1",
        completedWeekStartsDescending: ["2026-06-14", "2026-06-07", "2026-05-31"],
        checkins: [
          { date: "2026-06-14", daily_score: 100 },
          { date: "2026-06-15", daily_score: 100 },
          { date: "2026-06-16", daily_score: 100 },
          { date: "2026-06-17", daily_score: 100 },
          { date: "2026-06-18", daily_score: 100 },
          { date: "2026-06-19", daily_score: 100 },
          { date: "2026-06-07", daily_score: 100 },
          { date: "2026-06-08", daily_score: 100 },
          { date: "2026-06-09", daily_score: 100 },
          { date: "2026-06-10", daily_score: 100 },
          { date: "2026-06-11", daily_score: 100 },
          { date: "2026-05-31", daily_score: 100 },
          { date: "2026-06-01", daily_score: 100 },
          { date: "2026-06-02", daily_score: 100 },
          { date: "2026-06-03", daily_score: 100 },
          { date: "2026-06-04", daily_score: 100 },
          { date: "2026-06-05", daily_score: 100 },
          { date: "2026-06-06", daily_score: 100 }
        ],
        partnerRecitations: [
          { week_start: "2026-06-07", round: "round_1", points: 75 },
          { week_start: "2026-06-07", round: "round_2", points: 75 },
          { week_start: "2026-05-31", round: "round_1", points: 75 },
          { week_start: "2026-05-31", round: "round_2", points: 75 }
        ],
        halaqaGrades: [{ week_start: "2026-05-31", attendance_points: 100, recitation_points: 50 }]
      })
    ).toBe(2);
  });

  it("does not build a below-70 streak before the student's score baseline", () => {
    expect(
      buildStudentBelow70Streak({
        studentId: "student-1",
        completedWeekStartsDescending: ["2026-06-28", "2026-06-21", "2026-06-14"],
        minimumWeekStart: "2026-07-05",
        checkins: [],
        partnerRecitations: [],
        halaqaGrades: []
      })
    ).toBe(0);
  });

  it("builds completed student grade weeks from the accountability cutoff through the selected week", () => {
    expect(
      completedStudentGradeWeekStartsDescending({
        selectedWeekStart: "2026-06-21",
        today: "2026-06-22"
      })
    ).toEqual(["2026-06-14", "2026-06-07", "2026-05-31"]);
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
