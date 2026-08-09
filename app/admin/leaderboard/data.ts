import "server-only";
import {
  buildLeaderboardRows,
  weekIsComplete,
  type LeaderboardRow
} from "@/lib/leaderboard";
import {
  addDays,
  checkInEffectiveDateString,
  formatWeekRange,
  isValidDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import {
  activityCountsForHistoricalReport,
  historicalPopulationByStudentWeek,
  loadHistoricalReportingActivityForWeeks,
  loadHistoricalReportingAvailableWeeks,
  loadHistoricalReportingStudentsForWeeks
} from "@/lib/reporting-population";
import { parseBelow70StreakReadRows, type Below70StreakReadRow } from "@/lib/below70-streak";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, HalaqaGrade, PartnerRecitation } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof requireProfile>>["supabase"];
type LeaderboardCheckIn = Pick<
  CheckIn,
  "student_id" | "date" | "daily_score" | "masjid_id" | "cohort_id" | "halaqa_group_id"
>;
type LeaderboardPartnerRecitation = Pick<
  PartnerRecitation,
  "student_id" | "week_start" | "round" | "points" | "masjid_id" | "cohort_id" | "halaqa_group_id"
>;
type LeaderboardHalaqaGrade = Pick<
  HalaqaGrade,
  "student_id" | "week_start" | "attendance_points" | "recitation_points" | "masjid_id" | "cohort_id" | "halaqa_group_id"
>;

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

function validWeekStart(value: string | undefined, fallback: string, allowedWeekStarts: ReadonlySet<string>) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value && allowedWeekStarts.has(value) ? value : fallback;
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
  const today = checkInEffectiveDateString();
  const currentWeekStart = weekStartForDate(today);
  const below70Only = searchParams.below70 === "1";
  const reportWeekStarts = await loadHistoricalReportingAvailableWeeks(supabase);
  const selectableWeekStarts = new Set([currentWeekStart, ...reportWeekStarts]);
  const selectedWeekStart = validWeekStart(searchParams.week, currentWeekStart, selectableWeekStarts);
  const availableWeekStarts = [
    ...new Set([
      currentWeekStart,
      ...reportWeekStarts
    ])
  ].sort((a, b) => b.localeCompare(a));
  const earliestAvailableWeek = reportWeekStarts
    .filter((weekStart) => weekStart <= selectedWeekStart)
    .sort()[0] ?? selectedWeekStart;
  const completedWeekStartsDescending: string[] = [];
  let streakWeekStart = weekIsComplete(selectedWeekStart, today)
    ? selectedWeekStart
    : addDays(selectedWeekStart, -7);

  while (streakWeekStart >= earliestAvailableWeek) {
    completedWeekStartsDescending.push(streakWeekStart);
    streakWeekStart = addDays(streakWeekStart, -7);
  }
  const allWeekStarts = [...new Set([selectedWeekStart, ...completedWeekStartsDescending])];
  const population = await loadHistoricalReportingStudentsForWeeks(supabase, allWeekStarts);
  const populationByWeek = historicalPopulationByStudentWeek(population);
  const selectedPopulation = population.filter(
    (student) => student.week_start === selectedWeekStart && student.scoring_eligible
  );
  const students = selectedPopulation.map((student) => ({
    id: student.student_id,
    name: student.student_name,
    email: student.student_email,
    phone: student.student_phone,
    masjidName: student.masjid_name,
    cohortName: student.cohort_name,
    groupName: student.group_name,
    canViewCurrentContact: student.can_view_current_contact,
    canOpenCurrentProfile: student.can_open_current_profile
  }));
  const minimumWeekStartByStudent = new Map(
    selectedPopulation.map((student) => [student.student_id, student.score_starts_on])
  );
  const eligibleWeeksByStudent = new Map<string, Set<string>>();

  for (const student of population) {
    if (!student.scoring_eligible) continue;
    if (populationByWeek.get(studentWeekKey(student.student_id, student.week_start)) === null) continue;
    const weeks = eligibleWeeksByStudent.get(student.student_id) ?? new Set<string>();
    weeks.add(student.week_start);
    eligibleWeeksByStudent.set(student.student_id, weeks);
  }

  const orderedWeekStarts = [...allWeekStarts].sort();
  const activity = await loadHistoricalReportingActivityForWeeks(supabase, orderedWeekStarts);
  const checkins: LeaderboardCheckIn[] = activity
    .filter((row) => row.activity_kind === "checkin")
    .map((row) => ({ ...row, date: row.activity_date, daily_score: row.daily_score ?? 0 }));
  const partnerRecitations: LeaderboardPartnerRecitation[] = activity
    .filter((row) => row.activity_kind === "partner_recitation")
    .map((row) => ({
      ...row,
      round: row.recitation_round as PartnerRecitation["round"],
      points: row.partner_points ?? 0
    }));
  const halaqaGrades: LeaderboardHalaqaGrade[] = activity
    .filter((row) => row.activity_kind === "halaqa_grade")
    .map((row) => ({
      ...row,
      attendance_points: row.attendance_points ?? 0,
      recitation_points: row.recitation_points ?? 0
    }));

  const validCheckins = checkins.filter((checkin) =>
    activityCountsForHistoricalReport(checkin, weekStartForDate(checkin.date), populationByWeek)
  );
  const validPartnerRecitations = partnerRecitations.filter((recitation) =>
    activityCountsForHistoricalReport(recitation, recitation.week_start, populationByWeek)
  );
  const validHalaqaGrades = halaqaGrades.filter((grade) =>
    activityCountsForHistoricalReport(grade, grade.week_start, populationByWeek)
  );
  const selectedWeekDates = new Set(weekDatesFromStart(selectedWeekStart));
  const selectedWeekCheckinsByStudent = groupCheckinsByStudent(
    validCheckins.filter((checkin) => selectedWeekDates.has(checkin.date))
  );
  const selectedWeekPartnerRecitationsByStudent = groupPartnerRecitationsByStudent(
    validPartnerRecitations
      .filter((recitation) => recitation.week_start === selectedWeekStart)
      .map(({ student_id, round, points }) => ({ student_id, round, points }))
  );
  const selectedWeekHalaqaGradeByStudent = groupHalaqaGradesByStudent(
    validHalaqaGrades
      .filter((grade) => grade.week_start === selectedWeekStart)
      .map(({ student_id, attendance_points, recitation_points }) => ({
        student_id,
        attendance_points,
        recitation_points
      }))
  );
  const checkinsByStudentWeek = groupCheckinsByStudentWeek(validCheckins);
  const partnerRecitationsByStudentWeek = groupPartnerRecitationsByStudentWeek(validPartnerRecitations);
  const halaqaGradesByStudentWeek = groupHalaqaGradesByStudentWeek(validHalaqaGrades);
  const streakThroughWeekStart = completedWeekStartsDescending[0] ?? null;
  const below70StreakByStudent = new Map<string, number>();

  if (streakThroughWeekStart && students.length > 0) {
    const { data: streakRows, error: streakError } = await supabase
      .rpc("get_students_below70_streaks", {
        input_student_ids: students.map((student) => student.id),
        input_through_week_start: streakThroughWeekStart
      })
      .returns<Below70StreakReadRow[]>();

    if (streakError) {
      throw new Error("Unable to load below-70 streaks.");
    }

    for (const streakRow of parseBelow70StreakReadRows(streakRows)) {
      below70StreakByStudent.set(streakRow.student_id, streakRow.active_streak_length);
    }

    if (below70StreakByStudent.size !== students.length) {
      throw new Error("Below-70 streak data did not cover the selected student population.");
    }
  }

  const streakDataByStudent = new Map<
    string,
    {
      checkinsByWeek: Map<string, LeaderboardCheckIn[]>;
      partnerRecitationsByWeek: Map<string, Array<Pick<PartnerRecitation, "student_id" | "round" | "points">>>;
      halaqaGradeByWeek: Map<string, Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null>;
      eligibleWeekStarts: ReadonlySet<string>;
    }
  >();

  for (const student of students) {
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

    streakDataByStudent.set(student.id, {
      checkinsByWeek,
      partnerRecitationsByWeek,
      halaqaGradeByWeek,
      eligibleWeekStarts: eligibleWeeksByStudent.get(student.id) ?? new Set<string>()
    });
  }

  return {
    rows: buildLeaderboardRows({
      students,
      selectedWeekStart,
      today,
      below70Only,
      completedWeekStartsDescending,
      selectedWeekCheckinsByStudent,
      selectedWeekPartnerRecitationsByStudent,
      selectedWeekHalaqaGradeByStudent,
      streakDataByStudent,
      minimumWeekStartByStudent,
      below70StreakByStudent
    }),
    availableWeekStarts,
    selectedWeekStart,
    selectedWeekLabel: formatWeekRange(selectedWeekStart),
    selectedWeekComplete: weekIsComplete(selectedWeekStart, today),
    below70Only
  };
}
