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
type LeaderboardCheckIn = Pick<CheckIn, "student_id" | "date" | "daily_score">;
type LeaderboardPartnerRecitation = Pick<PartnerRecitation, "student_id" | "week_start" | "round" | "points">;
type LeaderboardHalaqaGrade = Pick<HalaqaGrade, "student_id" | "week_start" | "attendance_points" | "recitation_points">;

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

function studentWeekKey(studentId: string, weekStart: string) {
  return `${studentId}:${weekStart}`;
}

function groupCheckinsByStudent(checkins: LeaderboardCheckIn[]) {
  const byStudent = new Map<string, LeaderboardCheckIn[]>();

  for (const checkin of checkins) {
    byStudent.set(checkin.student_id, [...(byStudent.get(checkin.student_id) ?? []), checkin]);
  }

  return byStudent;
}

function groupPartnerRecitationsByStudent(recitations: Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>) {
  const byStudent = new Map<string, Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>>();

  for (const recitation of recitations) {
    byStudent.set(recitation.student_id, [...(byStudent.get(recitation.student_id) ?? []), recitation]);
  }

  return byStudent;
}

function groupHalaqaGradesByStudent(grades: Array<Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points">>) {
  const byStudent = new Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points">>();

  for (const grade of grades) {
    byStudent.set(grade.student_id, grade);
  }

  return byStudent;
}

function groupCheckinsByStudentWeek(checkins: LeaderboardCheckIn[]) {
  const byStudentWeek = new Map<string, LeaderboardCheckIn[]>();

  for (const checkin of checkins) {
    const weekStart = weekStartForDate(checkin.date);
    const key = studentWeekKey(checkin.student_id, weekStart);

    byStudentWeek.set(key, [...(byStudentWeek.get(key) ?? []), checkin]);
  }

  return byStudentWeek;
}

function groupPartnerRecitationsByStudentWeek(recitations: LeaderboardPartnerRecitation[]) {
  const byStudentWeek = new Map<string, Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>>();

  for (const recitation of recitations) {
    const key = studentWeekKey(recitation.student_id, recitation.week_start);

    byStudentWeek.set(key, [
      ...(byStudentWeek.get(key) ?? []),
      { student_id: recitation.student_id, round: recitation.round, points: recitation.points }
    ]);
  }

  return byStudentWeek;
}

function groupHalaqaGradesByStudentWeek(grades: LeaderboardHalaqaGrade[]) {
  const byStudentWeek = new Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points">>();

  for (const grade of grades) {
    byStudentWeek.set(studentWeekKey(grade.student_id, grade.week_start), {
      student_id: grade.student_id,
      attendance_points: grade.attendance_points,
      recitation_points: grade.recitation_points
    });
  }

  return byStudentWeek;
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
    .limit(365)
    .returns<Array<{ date: string }>>();
  const { data: partnerWeeks } = await supabase
    .from("partner_recitations")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(104)
    .returns<Array<{ week_start: string }>>();
  const { data: halaqaWeeks } = await supabase
    .from("halaqa_grades")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(104)
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
    .returns<LeaderboardCheckIn[]>();
  const { data: partnerRecitations } = await supabase
    .from("partner_recitations")
    .select("student_id,week_start,round,points")
    .in("week_start", allWeekStarts)
    .returns<LeaderboardPartnerRecitation[]>();
  const { data: halaqaGrades } = await supabase
    .from("halaqa_grades")
    .select("student_id,week_start,attendance_points,recitation_points")
    .in("week_start", allWeekStarts)
    .returns<LeaderboardHalaqaGrade[]>();

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
  const checkinsByStudentWeek = groupCheckinsByStudentWeek(checkins ?? []);
  const partnerRecitationsByStudentWeek = groupPartnerRecitationsByStudentWeek(partnerRecitations ?? []);
  const halaqaGradesByStudentWeek = groupHalaqaGradesByStudentWeek(halaqaGrades ?? []);
  const streakDataByStudent = new Map<
    string,
    {
      checkinsByWeek: Map<string, LeaderboardCheckIn[]>;
      partnerRecitationsByWeek: Map<string, Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>>;
      halaqaGradeByWeek: Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null>;
    }
  >();

  for (const student of students ?? []) {
    const checkinsByWeek = new Map<string, LeaderboardCheckIn[]>();
    const partnerRecitationsByWeek = new Map<string, Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>>();
    const halaqaGradeByWeek = new Map<
      string,
      Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
    >();

    for (const weekStart of completedWeekStartsDescending) {
      const key = studentWeekKey(student.id, weekStart);

      checkinsByWeek.set(weekStart, checkinsByStudentWeek.get(key) ?? []);
      partnerRecitationsByWeek.set(weekStart, partnerRecitationsByStudentWeek.get(key) ?? []);
      halaqaGradeByWeek.set(weekStart, halaqaGradesByStudentWeek.get(key) ?? null);
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
