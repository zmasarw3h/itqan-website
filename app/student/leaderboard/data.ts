import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildLeaderboardRows,
  weekIsComplete
} from "@/lib/leaderboard";
import {
  addDays,
  formatWeekRange,
  isValidDateString,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import { buildStudentLeaderboardRows, type StudentLeaderboardRow } from "@/lib/student-leaderboard";
import type { CheckIn, HalaqaGrade, PartnerRecitation, Profile } from "@/lib/types";

type LeaderboardCheckIn = Pick<CheckIn, "student_id" | "date" | "daily_score">;
type LeaderboardPartnerRecitation = Pick<PartnerRecitation, "student_id" | "week_start" | "round" | "points">;
type LeaderboardHalaqaGrade = Pick<HalaqaGrade, "student_id" | "week_start" | "attendance_points" | "recitation_points">;
type LeaderboardStudent = Pick<Profile, "id" | "name" | "email" | "phone" | "created_at">;

export type StudentLeaderboardSearchParams = {
  week?: string;
};

export type StudentLeaderboardData = {
  rows: StudentLeaderboardRow[];
  currentStudentRow: StudentLeaderboardRow | null;
  availableWeekStarts: string[];
  selectedWeekStart: string;
  selectedWeekLabel: string;
  selectedWeekComplete: boolean;
  previousWeekStart: string;
  previousWeekLabel: string;
};

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

function groupCheckinsByStudent(checkins: LeaderboardCheckIn[], weekDates: Set<string>) {
  const byStudent = new Map<string, LeaderboardCheckIn[]>();

  for (const checkin of checkins) {
    if (!weekDates.has(checkin.date)) {
      continue;
    }

    byStudent.set(checkin.student_id, [...(byStudent.get(checkin.student_id) ?? []), checkin]);
  }

  return byStudent;
}

function groupPartnerRecitationsByStudent(recitations: LeaderboardPartnerRecitation[], weekStart: string) {
  const byStudent = new Map<string, Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>>();

  for (const recitation of recitations) {
    if (recitation.week_start !== weekStart) {
      continue;
    }

    byStudent.set(recitation.student_id, [
      ...(byStudent.get(recitation.student_id) ?? []),
      { student_id: recitation.student_id, round: recitation.round, points: recitation.points }
    ]);
  }

  return byStudent;
}

function groupHalaqaGradesByStudent(grades: LeaderboardHalaqaGrade[], weekStart: string) {
  const byStudent = new Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points">>();

  for (const grade of grades) {
    if (grade.week_start !== weekStart) {
      continue;
    }

    byStudent.set(grade.student_id, {
      student_id: grade.student_id,
      attendance_points: grade.attendance_points,
      recitation_points: grade.recitation_points
    });
  }

  return byStudent;
}

function hasWeekActivity(input: {
  weekDates: Set<string>;
  weekStart: string;
  checkins: LeaderboardCheckIn[];
  partnerRecitations: LeaderboardPartnerRecitation[];
  halaqaGrades: LeaderboardHalaqaGrade[];
}) {
  return (
    input.checkins.some((checkin) => input.weekDates.has(checkin.date)) ||
    input.partnerRecitations.some((recitation) => recitation.week_start === input.weekStart) ||
    input.halaqaGrades.some((grade) => grade.week_start === input.weekStart)
  );
}

function studentsCreatedByWeekEnd(students: LeaderboardStudent[], weekStart: string) {
  const weekEndExclusive = `${addDays(weekStart, 7)}T00:00:00.000Z`;

  return students.filter((student) => !student.created_at || student.created_at < weekEndExclusive);
}

export async function loadStudentLeaderboardData(
  currentStudentId: string,
  searchParams: StudentLeaderboardSearchParams
): Promise<StudentLeaderboardData> {
  const supabase = createSupabaseAdminClient();
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(searchParams.week, currentWeekStart);
  const previousWeekStart = addDays(selectedWeekStart, -7);

  const { data: students } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<LeaderboardStudent[]>();

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
  const selectedWeekDates = weekDatesFromStart(selectedWeekStart);
  const previousWeekDates = weekDatesFromStart(previousWeekStart);
  const allDates = [...selectedWeekDates, ...previousWeekDates];
  const allWeekStarts = [selectedWeekStart, previousWeekStart];

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

  const selectedWeekDateSet = new Set(selectedWeekDates);
  const previousWeekDateSet = new Set(previousWeekDates);
  const currentRows = buildLeaderboardRows({
    students: students ?? [],
    selectedWeekStart,
    today,
    below70Only: false,
    completedWeekStartsDescending: [],
    selectedWeekCheckinsByStudent: groupCheckinsByStudent(checkins ?? [], selectedWeekDateSet),
    selectedWeekPartnerRecitationsByStudent: groupPartnerRecitationsByStudent(partnerRecitations ?? [], selectedWeekStart),
    selectedWeekHalaqaGradeByStudent: groupHalaqaGradesByStudent(halaqaGrades ?? [], selectedWeekStart),
    streakDataByStudent: new Map()
  });
  const previousRows = hasWeekActivity({
    weekDates: previousWeekDateSet,
    weekStart: previousWeekStart,
    checkins: checkins ?? [],
    partnerRecitations: partnerRecitations ?? [],
    halaqaGrades: halaqaGrades ?? []
  })
    ? buildLeaderboardRows({
        students: studentsCreatedByWeekEnd(students ?? [], previousWeekStart),
        selectedWeekStart: previousWeekStart,
        today,
        below70Only: false,
        completedWeekStartsDescending: [],
        selectedWeekCheckinsByStudent: groupCheckinsByStudent(checkins ?? [], previousWeekDateSet),
        selectedWeekPartnerRecitationsByStudent: groupPartnerRecitationsByStudent(partnerRecitations ?? [], previousWeekStart),
        selectedWeekHalaqaGradeByStudent: groupHalaqaGradesByStudent(halaqaGrades ?? [], previousWeekStart),
        streakDataByStudent: new Map()
      })
    : [];
  const rows = buildStudentLeaderboardRows({ currentRows, previousRows, currentStudentId });

  return {
    rows,
    currentStudentRow: rows.find((row) => row.isCurrentStudent) ?? null,
    availableWeekStarts,
    selectedWeekStart,
    selectedWeekLabel: formatWeekRange(selectedWeekStart),
    selectedWeekComplete: weekIsComplete(selectedWeekStart, today),
    previousWeekStart,
    previousWeekLabel: formatWeekRange(previousWeekStart)
  };
}
