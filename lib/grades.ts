import { calculateWeeklyScore } from "@/lib/scoring";
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
