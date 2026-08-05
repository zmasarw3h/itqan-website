import {
  addDays,
  formatWeekRange,
  isValidDateString,
  checkInEffectiveDateString,
  weekStartForDate
} from "@/lib/dates";
import {
  accountabilityAppliesToWeek,
  calculateAccountabilityAmountCents,
  calculateBadgeAwardCount
} from "@/lib/incentives";
import { calculateWeekScoreForStudent, weekIsComplete } from "@/lib/leaderboard";
import {
  activityCountsForHistoricalReport,
  historicalPopulationByStudentWeek,
  loadHistoricalReportingActivityForWeeks,
  loadHistoricalReportingAvailableWeeks,
  loadHistoricalReportingStudentsForWeeks,
  type HistoricalReportingStudent
} from "@/lib/reporting-population";
import type { requireProfile } from "@/lib/supabase-server";
import { chunksOf, loadAllSupabasePages } from "@/lib/supabase-pagination";
import type { AccountabilityObligation, CheckIn, HalaqaGrade, PartnerRecitation } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof requireProfile>>["supabase"];
type WeeklyCheckIn = Pick<
  CheckIn,
  "student_id" | "date" | "daily_score" | "masjid_id" | "cohort_id" | "halaqa_group_id"
>;
type WeeklyPartnerRecitation = Pick<
  PartnerRecitation,
  "student_id" | "week_start" | "round" | "points" | "masjid_id" | "cohort_id" | "halaqa_group_id"
>;
type WeeklyHalaqaGrade = Pick<
  HalaqaGrade,
  "student_id" | "week_start" | "attendance_points" | "recitation_points" | "masjid_id" | "cohort_id" | "halaqa_group_id"
>;

export type ComputedBadgeAward = {
  id: string;
  student_id: string;
  week_start: string;
  weekly_percentage: number;
  badges_awarded: number;
  created_at: string;
};

export type WeeklyIncentiveScoreRow = {
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  studentPhone: string | null;
  canViewCurrentContact: boolean;
  canOpenCurrentProfile: boolean;
  masjidName: string;
  cohortName: string;
  groupName: string;
  weekStart: string;
  weeklyPercentage: number;
  badgesAwarded: number;
  accountabilityAmountCents: number;
};

export type WeeklyIncentiveReport = {
  selectedWeekStart: string;
  selectedWeekLabel: string;
  mostBadgesThisWeek: WeeklyIncentiveScoreRow[];
  below70ThisWeek: WeeklyIncentiveScoreRow[];
  below70TwoWeeksStraight: WeeklyIncentiveScoreRow[];
  passingThreeWeeksStraight: WeeklyIncentiveScoreRow[];
  rows: WeeklyIncentiveScoreRow[];
};

function studentWeekKey(studentId: string, weekStart: string) {
  return `${studentId}:${weekStart}`;
}

function groupCheckinsByStudentWeek(checkins: WeeklyCheckIn[]) {
  const byStudentWeek = new Map<string, WeeklyCheckIn[]>();

  for (const checkin of checkins) {
    const key = studentWeekKey(checkin.student_id, weekStartForDate(checkin.date));
    byStudentWeek.set(key, [...(byStudentWeek.get(key) ?? []), checkin]);
  }

  return byStudentWeek;
}

function groupPartnerRecitationsByStudentWeek(recitations: WeeklyPartnerRecitation[]) {
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

function groupHalaqaGradesByStudentWeek(grades: WeeklyHalaqaGrade[]) {
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

function validCompletedWeekStart(value: string | undefined, completedWeekStarts: string[]) {
  if (!value || !isValidDateString(value)) {
    return completedWeekStarts[0] ?? null;
  }

  return completedWeekStarts.includes(value) ? value : completedWeekStarts[0] ?? null;
}

export function accountabilityGateIsActiveForDate(today: string) {
  if (!isValidDateString(today)) {
    throw new Error("Invalid date.");
  }

  return new Date(`${today}T00:00:00.000Z`).getUTCDay() !== 6;
}

export function buildWeeklyIncentiveRows(input: {
  population: HistoricalReportingStudent[];
  checkins: WeeklyCheckIn[];
  partnerRecitations: WeeklyPartnerRecitation[];
  halaqaGrades: WeeklyHalaqaGrade[];
}): WeeklyIncentiveScoreRow[] {
  const checkinsByStudentWeek = groupCheckinsByStudentWeek(input.checkins);
  const partnerRecitationsByStudentWeek = groupPartnerRecitationsByStudentWeek(input.partnerRecitations);
  const halaqaGradesByStudentWeek = groupHalaqaGradesByStudentWeek(input.halaqaGrades);
  const rows: WeeklyIncentiveScoreRow[] = [];

  for (const student of input.population) {
      if (!student.scoring_eligible) continue;

      const weekStart = student.week_start;
      const key = studentWeekKey(student.student_id, weekStart);
      const score = calculateWeekScoreForStudent({
        weekStart,
        checkins: checkinsByStudentWeek.get(key) ?? [],
        partnerRecitations: partnerRecitationsByStudentWeek.get(key) ?? [],
        halaqaGrade: halaqaGradesByStudentWeek.get(key) ?? null
      });

      rows.push({
        studentId: student.student_id,
        studentName: student.student_name,
        studentEmail: student.student_email,
        studentPhone: student.student_phone,
        canViewCurrentContact: student.can_view_current_contact,
        canOpenCurrentProfile: student.can_open_current_profile,
        masjidName: student.masjid_name,
        cohortName: student.cohort_name,
        groupName: student.group_name,
        weekStart,
        weeklyPercentage: score.percentage,
        badgesAwarded: calculateBadgeAwardCount(score.percentage),
        accountabilityAmountCents: calculateAccountabilityAmountCents(score.percentage)
      });
  }

  return rows;
}

export function buildWeeklyIncentiveReport(input: {
  selectedWeekStart: string;
  completedWeekStartsDescending: string[];
  rows: WeeklyIncentiveScoreRow[];
}): WeeklyIncentiveReport {
  const selectedRows = input.rows.filter((row) => row.weekStart === input.selectedWeekStart);
  const completedWeeks = new Set(input.completedWeekStartsDescending);
  const previousWeekStart = addDays(input.selectedWeekStart, -7);
  const twoWeeksAgoStart = addDays(input.selectedWeekStart, -14);

  const scoreByStudentWeek = new Map(input.rows.map((row) => [studentWeekKey(row.studentId, row.weekStart), row]));
  const mostBadgesThisWeek = selectedRows
    .filter((row) => row.badgesAwarded > 0)
    .sort(
      (a, b) =>
        b.badgesAwarded - a.badgesAwarded ||
        b.weeklyPercentage - a.weeklyPercentage ||
        a.studentName.localeCompare(b.studentName)
    );
  const below70ThisWeek = selectedRows
    .filter((row) => row.weeklyPercentage < 70)
    .sort((a, b) => a.weeklyPercentage - b.weeklyPercentage || a.studentName.localeCompare(b.studentName));
  const below70TwoWeeksStraight = completedWeeks.has(previousWeekStart) && accountabilityAppliesToWeek(previousWeekStart)
    ? below70ThisWeek.filter(
        (row) => (scoreByStudentWeek.get(studentWeekKey(row.studentId, previousWeekStart))?.weeklyPercentage ?? 100) < 70
      )
    : [];
  const passingThreeWeeksStraight =
    completedWeeks.has(previousWeekStart) && completedWeeks.has(twoWeeksAgoStart)
      ? selectedRows
          .filter((row) => row.weeklyPercentage >= 70)
          .filter(
            (row) =>
              (scoreByStudentWeek.get(studentWeekKey(row.studentId, previousWeekStart))?.weeklyPercentage ?? 0) >= 70 &&
              (scoreByStudentWeek.get(studentWeekKey(row.studentId, twoWeeksAgoStart))?.weeklyPercentage ?? 0) >= 70
          )
          .sort((a, b) => b.weeklyPercentage - a.weeklyPercentage || a.studentName.localeCompare(b.studentName))
      : [];

  return {
    selectedWeekStart: input.selectedWeekStart,
    selectedWeekLabel: formatWeekRange(input.selectedWeekStart),
    mostBadgesThisWeek,
    below70ThisWeek,
    below70TwoWeeksStraight,
    passingThreeWeeksStraight,
    rows: selectedRows
  };
}

export function computedBadgeAwardFromRow(row: WeeklyIncentiveScoreRow): ComputedBadgeAward | null {
  if (row.badgesAwarded <= 0) {
    return null;
  }

  return {
    id: `${row.studentId}:${row.weekStart}`,
    student_id: row.studentId,
    week_start: row.weekStart,
    weekly_percentage: row.weeklyPercentage,
    badges_awarded: row.badgesAwarded,
    created_at: `${addDays(row.weekStart, 6)}T00:00:00.000Z`
  };
}

export async function loadCompletedWeekStarts(
  supabase: SupabaseClient,
  today = checkInEffectiveDateString()
) {
  const currentWeekStart = weekStartForDate(today);
  return (await loadHistoricalReportingAvailableWeeks(supabase))
    .filter((weekStart) => weekStart < currentWeekStart && weekIsComplete(weekStart, today))
    .sort((a, b) => b.localeCompare(a));
}

export async function loadComputedWeeklyIncentiveRows(input: {
  supabase: SupabaseClient;
  weekStarts: string[];
  studentId?: string;
  population?: HistoricalReportingStudent[];
}) {
  if (!input.weekStarts.length) {
    return [];
  }

  let population = input.population ?? await loadHistoricalReportingStudentsForWeeks(input.supabase, input.weekStarts);
  if (input.studentId) population = population.filter((student) => student.student_id === input.studentId);
  population = population.filter((student) => student.scoring_eligible);
  const populationByWeek = historicalPopulationByStudentWeek(population);
  const studentIds = [...new Set(population.map((student) => student.student_id))];

  if (!studentIds.length) {
    return [];
  }

  const activity = await loadHistoricalReportingActivityForWeeks(input.supabase, input.weekStarts);
  const checkins: WeeklyCheckIn[] = activity
    .filter((row) => row.activity_kind === "checkin")
    .map((row) => ({ ...row, date: row.activity_date, daily_score: row.daily_score ?? 0 }));
  const partnerRecitations: WeeklyPartnerRecitation[] = activity
    .filter((row) => row.activity_kind === "partner_recitation")
    .map((row) => ({
      ...row,
      round: row.recitation_round as PartnerRecitation["round"],
      points: row.partner_points ?? 0
    }));
  const halaqaGrades: WeeklyHalaqaGrade[] = activity
    .filter((row) => row.activity_kind === "halaqa_grade")
    .map((row) => ({
      ...row,
      attendance_points: row.attendance_points ?? 0,
      recitation_points: row.recitation_points ?? 0
    }));

  return buildWeeklyIncentiveRows({
    population,
    checkins: checkins.filter((row) =>
      activityCountsForHistoricalReport(row, weekStartForDate(row.date), populationByWeek)
    ),
    partnerRecitations: partnerRecitations.filter((row) =>
      activityCountsForHistoricalReport(row, row.week_start, populationByWeek)
    ),
    halaqaGrades: halaqaGrades.filter((row) =>
      activityCountsForHistoricalReport(row, row.week_start, populationByWeek)
    )
  });
}

export async function loadComputedBadgeAwards(input: {
  supabase: SupabaseClient;
  weekStarts?: string[];
  studentId?: string;
  population?: HistoricalReportingStudent[];
  today?: string;
}) {
  const weekStarts = input.weekStarts ?? (await loadCompletedWeekStarts(input.supabase, input.today));
  const rows = await loadComputedWeeklyIncentiveRows({
    supabase: input.supabase,
    weekStarts,
    studentId: input.studentId,
    population: input.population
  });

  return rows.flatMap((row) => {
    const award = computedBadgeAwardFromRow(row);
    return award ? [award] : [];
  });
}

export async function loadWeeklyIncentiveReportData(input: {
  supabase: SupabaseClient;
  week?: string;
  today?: string;
}) {
  const today = input.today ?? checkInEffectiveDateString();
  const completedWeekStarts = await loadCompletedWeekStarts(input.supabase, today);
  const selectedWeekStart = validCompletedWeekStart(input.week, completedWeekStarts);

  if (!selectedWeekStart) {
    return {
      availableWeekStarts: completedWeekStarts,
      selectedWeekStart: null,
      report: null,
      pendingAccountabilityCount: 0
    };
  }

  const reportWeekStarts = [
    selectedWeekStart,
    addDays(selectedWeekStart, -7),
    addDays(selectedWeekStart, -14)
  ].filter((weekStart) => completedWeekStarts.includes(weekStart));
  const population = await loadHistoricalReportingStudentsForWeeks(input.supabase, reportWeekStarts);
  const rows = await loadComputedWeeklyIncentiveRows({
    supabase: input.supabase,
    weekStarts: reportWeekStarts,
    population
  });
  const scopedStudentIds = population
    .filter((student) => student.week_start === selectedWeekStart && student.scoring_eligible)
    .map((student) => student.student_id);
  if (!scopedStudentIds.length) {
    return {
      availableWeekStarts: completedWeekStarts,
      selectedWeekStart,
      report: buildWeeklyIncentiveReport({
        selectedWeekStart,
        completedWeekStartsDescending: reportWeekStarts,
        rows
      }),
      pendingAccountabilityCount: 0
    };
  }

  const selectedPopulationByStudent = new Map(
    population
      .filter((student) => student.week_start === selectedWeekStart && student.scoring_eligible)
      .map((student) => [student.student_id, student])
  );
  const pendingObligations = (
    await Promise.all(
      chunksOf(scopedStudentIds).map((studentIdChunk) =>
        loadAllSupabasePages<Pick<AccountabilityObligation, "student_id" | "masjid_id" | "cohort_id" | "halaqa_group_id">>(
          (from, to) => input.supabase
            .from("accountability_obligations")
            .select("student_id,masjid_id,cohort_id,halaqa_group_id")
            .eq("week_start", selectedWeekStart)
            .eq("status", "pending")
            .in("student_id", studentIdChunk)
            .order("student_id")
            .range(from, to)
            .returns<Array<Pick<AccountabilityObligation, "student_id" | "masjid_id" | "cohort_id" | "halaqa_group_id">>>()
        )
      )
    )
  ).flat();
  const pendingAccountabilityCount = pendingObligations.filter((obligation) => {
    const historical = selectedPopulationByStudent.get(obligation.student_id);
    return historical
      && obligation.masjid_id === historical.masjid_id
      && obligation.cohort_id === historical.cohort_id
      && obligation.halaqa_group_id === historical.group_id;
  }).length;

  return {
    availableWeekStarts: completedWeekStarts,
    selectedWeekStart,
    report: buildWeeklyIncentiveReport({
      selectedWeekStart,
      completedWeekStartsDescending: reportWeekStarts,
      rows
    }),
    pendingAccountabilityCount
  };
}

export async function findOrCreateBlockingAccountabilityObligation(input: {
  supabase: SupabaseClient;
  adminSupabase: SupabaseClient;
  studentId: string;
  today?: string;
}) {
  const today = input.today ?? checkInEffectiveDateString();

  if (!accountabilityGateIsActiveForDate(today)) {
    return null;
  }

  const completedWeekStarts = await loadCompletedWeekStarts(input.supabase, today);
  const rows = await loadComputedWeeklyIncentiveRows({
    supabase: input.supabase,
    weekStarts: completedWeekStarts,
    studentId: input.studentId
  });
  const scoreRows = [...rows]
    .filter((row) => accountabilityAppliesToWeek(row.weekStart))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  if (!scoreRows.length) {
    return null;
  }

  for (const row of scoreRows) {
    const { data, error } = await input.adminSupabase.rpc(
      "reconcile_historical_accountability_obligation",
      {
        input_student_id: input.studentId,
        input_week_start: row.weekStart
      }
    );

    if (error) {
      throw new Error("Unable to reconcile accountability obligation.");
    }

    if (data) {
      return data as AccountabilityObligation;
    }
  }

  return null;
}
