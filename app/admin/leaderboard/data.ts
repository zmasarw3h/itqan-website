import "server-only";
import {
  buildLeaderboardRows,
  weekIsComplete,
  type LeaderboardRow
} from "@/lib/leaderboard";
import { formatWeekRange, isValidDateString, todayDateString, weekDatesFromStart, weekStartForDate } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, HalaqaGrade, PartnerRecitation, Profile } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof requireProfile>>["supabase"];

export type LeaderboardSearchParams = {
  week?: string;
  below70?: string;
};

export type LeaderboardData = {
  rows: LeaderboardRow[];
  availableWeekStarts: string[];
  selectedWeekStart: string;
  selectedWeekLabel: string;
  selectedWeekComplete: boolean;
  below70Only: boolean;
};

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

function groupCheckinsByStudent(checkins: Pick<CheckIn, "student_id" | "date" | "daily_score">[]) {
  const byStudent = new Map<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>();

  for (const checkin of checkins) {
    byStudent.set(checkin.student_id, [...(byStudent.get(checkin.student_id) ?? []), checkin]);
  }

  return byStudent;
}

function groupPartnerRecitationsByStudent(
  recitations: Pick<PartnerRecitation, "student_id" | "round" | "points">[]
) {
  const byStudent = new Map<string, Pick<PartnerRecitation, "student_id" | "round" | "points">[]>();

  for (const recitation of recitations) {
    byStudent.set(recitation.student_id, [...(byStudent.get(recitation.student_id) ?? []), recitation]);
  }

  return byStudent;
}

function groupHalaqaGradesByStudent(
  grades: Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points">[]
) {
  const byStudent = new Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points">>();

  for (const grade of grades) {
    byStudent.set(grade.student_id, grade);
  }

  return byStudent;
}

export async function loadLeaderboardData(
  supabase: SupabaseClient,
  searchParams: LeaderboardSearchParams
): Promise<LeaderboardData> {
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(searchParams.week, currentWeekStart);
  const below70Only = searchParams.below70 === "1";

  const { data: students } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Profile[]>();

  const { data: checkinDates } = await supabase
    .from("checkins")
    .select("date")
    .order("date", { ascending: false })
    .returns<Array<{ date: string }>>();
  const { data: partnerWeeks } = await supabase
    .from("partner_recitations")
    .select("week_start")
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const { data: halaqaWeeks } = await supabase
    .from("halaqa_grades")
    .select("week_start")
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const availableWeekStarts = [
    ...new Set([
      currentWeekStart,
      selectedWeekStart,
      ...(checkinDates ?? []).map((checkin) => weekStartForDate(checkin.date)),
      ...(partnerWeeks ?? []).map((week) => week.week_start),
      ...(halaqaWeeks ?? []).map((week) => week.week_start)
    ])
  ].sort((a, b) => b.localeCompare(a));
  const completedWeekStartsDescending = availableWeekStarts.filter(
    (weekStart) => weekStart <= selectedWeekStart && weekIsComplete(weekStart, today)
  );
  const allWeekStarts = [...new Set([selectedWeekStart, ...completedWeekStartsDescending])];
  const allDates = allWeekStarts.flatMap((weekStart) => weekDatesFromStart(weekStart));

  const { data: checkins } = await supabase
    .from("checkins")
    .select("student_id,date,daily_score")
    .in("date", allDates)
    .returns<Array<Pick<CheckIn, "student_id" | "date" | "daily_score">>>();
  const { data: partnerRecitations } = await supabase
    .from("partner_recitations")
    .select("student_id,week_start,round,points")
    .in("week_start", allWeekStarts)
    .returns<Array<Pick<PartnerRecitation, "student_id" | "week_start" | "round" | "points">>>();
  const { data: halaqaGrades } = await supabase
    .from("halaqa_grades")
    .select("student_id,week_start,attendance_points,recitation_points")
    .in("week_start", allWeekStarts)
    .returns<Array<Pick<HalaqaGrade, "student_id" | "week_start" | "attendance_points" | "recitation_points">>>();

  const selectedWeekDates = new Set(weekDatesFromStart(selectedWeekStart));
  const selectedWeekCheckinsByStudent = groupCheckinsByStudent(
    (checkins ?? []).filter((checkin) => selectedWeekDates.has(checkin.date))
  );
  const selectedWeekPartnerRecitationsByStudent = groupPartnerRecitationsByStudent(
    (partnerRecitations ?? [])
      .filter((recitation) => recitation.week_start === selectedWeekStart)
      .map(({ student_id, round, points }) => ({ student_id, round, points }))
  );
  const selectedWeekHalaqaGradeByStudent = groupHalaqaGradesByStudent(
    (halaqaGrades ?? [])
      .filter((grade) => grade.week_start === selectedWeekStart)
      .map(({ student_id, attendance_points, recitation_points }) => ({
        student_id,
        attendance_points,
        recitation_points
      }))
  );
  const streakDataByStudent = new Map<
    string,
    {
      checkinsByWeek: Map<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>;
      partnerRecitationsByWeek: Map<string, Pick<PartnerRecitation, "student_id" | "round" | "points">[]>;
      halaqaGradeByWeek: Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null>;
    }
  >();

  for (const student of students ?? []) {
    const checkinsByWeek = new Map<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>();
    const partnerRecitationsByWeek = new Map<string, Pick<PartnerRecitation, "student_id" | "round" | "points">[]>();
    const halaqaGradeByWeek = new Map<
      string,
      Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
    >();

    for (const weekStart of completedWeekStartsDescending) {
      const weekDates = new Set(weekDatesFromStart(weekStart));
      checkinsByWeek.set(
        weekStart,
        (checkins ?? []).filter((checkin) => checkin.student_id === student.id && weekDates.has(checkin.date))
      );
      partnerRecitationsByWeek.set(
        weekStart,
        (partnerRecitations ?? [])
          .filter((recitation) => recitation.student_id === student.id && recitation.week_start === weekStart)
          .map(({ student_id, round, points }) => ({ student_id, round, points }))
      );
      const halaqaGrade = (halaqaGrades ?? []).find(
        (grade) => grade.student_id === student.id && grade.week_start === weekStart
      );
      halaqaGradeByWeek.set(
        weekStart,
        halaqaGrade
          ? {
              student_id: halaqaGrade.student_id,
              attendance_points: halaqaGrade.attendance_points,
              recitation_points: halaqaGrade.recitation_points
            }
          : null
      );
    }

    streakDataByStudent.set(student.id, { checkinsByWeek, partnerRecitationsByWeek, halaqaGradeByWeek });
  }

  return {
    rows: buildLeaderboardRows({
      students: students ?? [],
      selectedWeekStart,
      today,
      below70Only,
      completedWeekStartsDescending,
      selectedWeekCheckinsByStudent,
      selectedWeekPartnerRecitationsByStudent,
      selectedWeekHalaqaGradeByStudent,
      streakDataByStudent
    }),
    availableWeekStarts,
    selectedWeekStart,
    selectedWeekLabel: formatWeekRange(selectedWeekStart),
    selectedWeekComplete: weekIsComplete(selectedWeekStart, today),
    below70Only
  };
}
