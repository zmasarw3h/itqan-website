import { addDays, weekStartForDate } from "@/lib/dates";
import { ACCOUNTABILITY_OBLIGATIONS_START_WEEK } from "@/lib/incentives";
import { calculateBelow70Streak, weekIsComplete } from "@/lib/leaderboard";
import { calculateWeeklyScore } from "@/lib/scoring";
import { storedRecitationPointsToMark } from "@/lib/scoring";
import type { CheckIn, HalaqaGrade, PartnerRecitation } from "@/lib/types";

export function studentGradesScope(studentId: string, weekStart: string, weekDates: string[]) {
  if (!studentId) {
    throw new Error("Student id is required.");
  }

  return {
    studentId,
    weekStart,
    weekDates: [...weekDates]
  };
}

export function buildWeeklyGradeBreakdown(input: {
  weekDates: string[];
  checkins: Pick<CheckIn, "date" | "daily_score">[];
  partnerRecitations: Pick<PartnerRecitation, "round" | "points">[];
  halaqaGrade: Pick<HalaqaGrade, "attendance_points" | "recitation_points"> | null;
}) {
  const dailyScoreByDate = new Map(input.checkins.map((checkin) => [checkin.date, checkin.daily_score]));

  return calculateWeeklyScore({
    dailyScores: input.weekDates.map((date) => dailyScoreByDate.get(date) ?? 0),
    partnerRecitations: input.partnerRecitations,
    halaqaGrade: input.halaqaGrade
  });
}

export function completedStudentGradeWeekStartsDescending(input: { selectedWeekStart: string; today: string }) {
  const currentWeekStart = weekStartForDate(input.today);
  const latestWeekStart = input.selectedWeekStart > currentWeekStart ? currentWeekStart : input.selectedWeekStart;
  const weekStarts: string[] = [];

  for (
    let weekStart = latestWeekStart;
    weekStart >= ACCOUNTABILITY_OBLIGATIONS_START_WEEK;
    weekStart = addDays(weekStart, -7)
  ) {
    if (weekIsComplete(weekStart, input.today)) {
      weekStarts.push(weekStart);
    }
  }

  return weekStarts;
}

export function buildStudentBelow70Streak(input: {
  studentId: string;
  completedWeekStartsDescending: string[];
  checkins: Pick<CheckIn, "date" | "daily_score">[];
  partnerRecitations: Pick<PartnerRecitation, "week_start" | "round" | "points">[];
  halaqaGrades: Pick<HalaqaGrade, "week_start" | "attendance_points" | "recitation_points">[];
}) {
  const checkinsByWeek = new Map<string, Array<Pick<CheckIn, "student_id" | "date" | "daily_score">>>();
  const partnerRecitationsByWeek = new Map<
    string,
    Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>
  >();
  const halaqaGradeByWeek = new Map<
    string,
    Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
  >();

  for (const checkin of input.checkins) {
    const weekStart = weekStartForDate(checkin.date);

    checkinsByWeek.set(weekStart, [
      ...(checkinsByWeek.get(weekStart) ?? []),
      { student_id: input.studentId, date: checkin.date, daily_score: checkin.daily_score }
    ]);
  }

  for (const recitation of input.partnerRecitations) {
    partnerRecitationsByWeek.set(recitation.week_start, [
      ...(partnerRecitationsByWeek.get(recitation.week_start) ?? []),
      { student_id: input.studentId, round: recitation.round, points: recitation.points }
    ]);
  }

  for (const grade of input.halaqaGrades) {
    halaqaGradeByWeek.set(grade.week_start, {
      student_id: input.studentId,
      attendance_points: grade.attendance_points,
      recitation_points: grade.recitation_points
    });
  }

  return calculateBelow70Streak({
    completedWeekStartsDescending: input.completedWeekStartsDescending,
    checkinsByWeek,
    partnerRecitationsByWeek,
    halaqaGradeByWeek
  });
}

export function buildHalaqaFeedbackDisplay(
  grade: Pick<HalaqaGrade, "attended" | "attendance_points" | "recitation_points" | "notes"> | null
) {
  if (!grade) {
    return null;
  }

  const halaqaPoints = Number(grade.attendance_points ?? 0) + Number(grade.recitation_points ?? 0);

  return {
    attended: grade.attended,
    attendanceLabel: grade.attended ? "Present" : "Absent",
    recitationMarkOutOf10: grade.attended ? storedRecitationPointsToMark(grade.recitation_points) : 0,
    recitationPoints: Number(grade.recitation_points ?? 0),
    halaqaPoints,
    notes: grade.notes?.trim() || null
  };
}
