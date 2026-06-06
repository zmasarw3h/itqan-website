import {
  addDays,
  formatWeekRange,
  isValidDateString,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import {
  accountabilityAppliesToWeek,
  calculateAccountabilityAmountCents,
  calculateBadgeAwardCount
} from "@/lib/incentives";
import { calculateWeekScoreForStudent, weekIsComplete } from "@/lib/leaderboard";
import type { requireProfile } from "@/lib/supabase-server";
import type { AccountabilityObligation, CheckIn, HalaqaGrade, PartnerRecitation, Profile } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof requireProfile>>["supabase"];
type ActiveStudent = Pick<Profile, "id" | "name" | "email" | "phone">;
type WeeklyCheckIn = Pick<CheckIn, "student_id" | "date" | "daily_score">;
type WeeklyPartnerRecitation = Pick<PartnerRecitation, "student_id" | "week_start" | "round" | "points">;
type WeeklyHalaqaGrade = Pick<HalaqaGrade, "student_id" | "week_start" | "attendance_points" | "recitation_points">;

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
  studentEmail: string;
  studentPhone: string | null;
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
  students: ActiveStudent[];
  weekStarts: string[];
  checkins: WeeklyCheckIn[];
  partnerRecitations: WeeklyPartnerRecitation[];
  halaqaGrades: WeeklyHalaqaGrade[];
}): WeeklyIncentiveScoreRow[] {
  const checkinsByStudentWeek = groupCheckinsByStudentWeek(input.checkins);
  const partnerRecitationsByStudentWeek = groupPartnerRecitationsByStudentWeek(input.partnerRecitations);
  const halaqaGradesByStudentWeek = groupHalaqaGradesByStudentWeek(input.halaqaGrades);
  const rows: WeeklyIncentiveScoreRow[] = [];

  for (const weekStart of input.weekStarts) {
    for (const student of input.students) {
      const key = studentWeekKey(student.id, weekStart);
      const score = calculateWeekScoreForStudent({
        weekStart,
        checkins: checkinsByStudentWeek.get(key) ?? [],
        partnerRecitations: partnerRecitationsByStudentWeek.get(key) ?? [],
        halaqaGrade: halaqaGradesByStudentWeek.get(key) ?? null
      });

      rows.push({
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        studentPhone: student.phone,
        weekStart,
        weeklyPercentage: score.percentage,
        badgesAwarded: calculateBadgeAwardCount(score.percentage),
        accountabilityAmountCents: calculateAccountabilityAmountCents(score.percentage)
      });
    }
  }

  return rows;
}

export function buildWeeklyIncentiveReport(input: {
  selectedWeekStart: string;
  completedWeekStartsDescending: string[];
  rows: WeeklyIncentiveScoreRow[];
}): WeeklyIncentiveReport {
  const selectedRows = input.rows.filter((row) => row.weekStart === input.selectedWeekStart);
  const selectedIndex = input.completedWeekStartsDescending.indexOf(input.selectedWeekStart);
  const previousWeekStart = selectedIndex >= 0 ? input.completedWeekStartsDescending[selectedIndex + 1] : undefined;
  const twoWeeksAgoStart = selectedIndex >= 0 ? input.completedWeekStartsDescending[selectedIndex + 2] : undefined;

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
  const below70TwoWeeksStraight = previousWeekStart && accountabilityAppliesToWeek(previousWeekStart)
    ? below70ThisWeek.filter(
        (row) => (scoreByStudentWeek.get(studentWeekKey(row.studentId, previousWeekStart))?.weeklyPercentage ?? 100) < 70
      )
    : [];
  const passingThreeWeeksStraight =
    previousWeekStart && twoWeeksAgoStart
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

export async function loadCompletedWeekStarts(supabase: SupabaseClient, today = todayDateString()) {
  const currentWeekStart = weekStartForDate(today);
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

  return [
    ...new Set([
      ...(checkinDates ?? []).map((checkin) => weekStartForDate(checkin.date)),
      ...(partnerWeeks ?? []).map((week) => week.week_start),
      ...(halaqaWeeks ?? []).map((week) => week.week_start)
    ])
  ]
    .filter((weekStart) => weekStart < currentWeekStart && weekIsComplete(weekStart, today))
    .sort((a, b) => b.localeCompare(a));
}

export async function loadComputedWeeklyIncentiveRows(input: {
  supabase: SupabaseClient;
  weekStarts: string[];
  studentId?: string;
}) {
  if (!input.weekStarts.length) {
    return [];
  }

  const allDates = input.weekStarts.flatMap((weekStart) => weekDatesFromStart(weekStart));
  let studentsQuery = input.supabase
    .from("profiles")
    .select("id,name,email,phone")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true });

  if (input.studentId) {
    studentsQuery = studentsQuery.eq("id", input.studentId);
  }

  const { data: students } = await studentsQuery.returns<ActiveStudent[]>();
  const { data: checkins } = await input.supabase
    .from("checkins")
    .select("student_id,date,daily_score")
    .in("date", allDates)
    .returns<WeeklyCheckIn[]>();
  const { data: partnerRecitations } = await input.supabase
    .from("partner_recitations")
    .select("student_id,week_start,round,points")
    .in("week_start", input.weekStarts)
    .returns<WeeklyPartnerRecitation[]>();
  const { data: halaqaGrades } = await input.supabase
    .from("halaqa_grades")
    .select("student_id,week_start,attendance_points,recitation_points")
    .in("week_start", input.weekStarts)
    .returns<WeeklyHalaqaGrade[]>();

  return buildWeeklyIncentiveRows({
    students: students ?? [],
    weekStarts: input.weekStarts,
    checkins: checkins ?? [],
    partnerRecitations: partnerRecitations ?? [],
    halaqaGrades: halaqaGrades ?? []
  });
}

export async function loadComputedBadgeAwards(input: {
  supabase: SupabaseClient;
  weekStarts?: string[];
  studentId?: string;
  today?: string;
}) {
  const weekStarts = input.weekStarts ?? (await loadCompletedWeekStarts(input.supabase, input.today));
  const rows = await loadComputedWeeklyIncentiveRows({
    supabase: input.supabase,
    weekStarts,
    studentId: input.studentId
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
  const today = input.today ?? todayDateString();
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

  const selectedIndex = completedWeekStarts.indexOf(selectedWeekStart);
  const reportWeekStarts = completedWeekStarts.slice(selectedIndex, selectedIndex + 3);
  const rows = await loadComputedWeeklyIncentiveRows({
    supabase: input.supabase,
    weekStarts: reportWeekStarts
  });
  const { count: pendingAccountabilityCount } = await input.supabase
    .from("accountability_obligations")
    .select("id", { count: "exact", head: true })
    .eq("week_start", selectedWeekStart)
    .eq("status", "pending");

  return {
    availableWeekStarts: completedWeekStarts,
    selectedWeekStart,
    report: buildWeeklyIncentiveReport({
      selectedWeekStart,
      completedWeekStartsDescending: reportWeekStarts,
      rows
    }),
    pendingAccountabilityCount: pendingAccountabilityCount ?? 0
  };
}

export async function findOrCreateBlockingAccountabilityObligation(input: {
  supabase: SupabaseClient;
  studentId: string;
  today?: string;
}) {
  const today = input.today ?? todayDateString();

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

  const { data: existingObligations } = await input.supabase
    .from("accountability_obligations")
    .select("id,student_id,week_start,weekly_percentage,amount_cents,status,attested_paid_at,waived_at,waived_by,admin_note,created_at,updated_at")
    .eq("student_id", input.studentId)
    .in(
      "week_start",
      scoreRows.map((row) => row.weekStart)
    )
    .returns<AccountabilityObligation[]>();
  const obligationByWeek = new Map((existingObligations ?? []).map((obligation) => [obligation.week_start, obligation]));

  for (const row of scoreRows) {
    const existing = obligationByWeek.get(row.weekStart);

    if (row.weeklyPercentage >= 70) {
      if (existing?.status === "pending") {
        const now = new Date().toISOString();
        await input.supabase
          .from("accountability_obligations")
          .update({
            weekly_percentage: row.weeklyPercentage,
            amount_cents: 0,
            status: "waived",
            waived_at: now,
            admin_note: "Auto-waived after automatic score recalculation >= 70",
            updated_at: now
          })
          .eq("id", existing.id)
          .eq("status", "pending");
      }

      continue;
    }

    if (existing?.status === "attested_paid" || existing?.status === "waived") {
      continue;
    }

    if (existing?.status === "pending") {
      const now = new Date().toISOString();
      const { data: updated } = await input.supabase
        .from("accountability_obligations")
        .update({
          weekly_percentage: row.weeklyPercentage,
          amount_cents: row.accountabilityAmountCents,
          updated_at: now
        })
        .eq("id", existing.id)
        .eq("status", "pending")
        .select("id,student_id,week_start,weekly_percentage,amount_cents,status,attested_paid_at,waived_at,waived_by,admin_note,created_at,updated_at")
        .maybeSingle<AccountabilityObligation>();

      return updated ?? existing;
    }

    const { data: inserted, error } = await input.supabase
      .from("accountability_obligations")
      .insert({
        student_id: input.studentId,
        week_start: row.weekStart,
        weekly_percentage: row.weeklyPercentage,
        amount_cents: row.accountabilityAmountCents,
        status: "pending",
        updated_at: new Date().toISOString()
      })
      .select("id,student_id,week_start,weekly_percentage,amount_cents,status,attested_paid_at,waived_at,waived_by,admin_note,created_at,updated_at")
      .single<AccountabilityObligation>();

    if (error) {
      throw new Error("Unable to create accountability obligation.");
    }

    return inserted;
  }

  return null;
}
