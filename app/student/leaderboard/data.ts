import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { weekIsComplete } from "@/lib/leaderboard";
import {
  addDays,
  formatWeekRange,
  isValidDateString,
  checkInEffectiveDateString,
  weekStartForDate
} from "@/lib/dates";
import {
  loadStudentWeekTeacher,
  type StudentWeekScope,
  type StudentWeekTeacher
} from "@/lib/student-scope";
import type { CohortKind } from "@/lib/types";
import type { StudentLeaderboardRow } from "@/lib/student-leaderboard";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type StudentLeaderboardRpcRow = {
  student_name: string;
  rank: number;
  previous_rank: number | null;
  rank_change: number | null;
  total_points: number;
  score_percentage: number;
  is_current_student: boolean;
  status_label: string;
};

type HistoricalScopeRpcRow = {
  student_id: string;
  week_start: string;
  masjid_id: string;
  masjid_name: string;
  masjid_slug: string;
  cohort_id: string;
  cohort_name: string;
  cohort_kind: CohortKind;
  group_id: string;
  group_name: string;
  membership_starts_on: string;
};

export type StudentLeaderboardSearchParams = {
  week?: string;
};

export type StudentLeaderboardData = {
  scope: StudentWeekScope | null;
  teacher: StudentWeekTeacher | null;
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

function mapLeaderboardRow(row: StudentLeaderboardRpcRow): StudentLeaderboardRow {
  return {
    rank: row.rank,
    previousRank: row.previous_rank,
    rankChange: row.rank_change,
    studentName: row.student_name,
    scorePercentage: Number(row.score_percentage),
    totalPoints: Number(row.total_points),
    statusLabel: row.status_label,
    isCurrentStudent: row.is_current_student
  };
}

function mapHistoricalScope(row: HistoricalScopeRpcRow | null): StudentWeekScope | null {
  return row ? {
    studentId: row.student_id,
    weekStart: row.week_start,
    masjidId: row.masjid_id,
    masjidName: row.masjid_name,
    masjidSlug: row.masjid_slug,
    cohortId: row.cohort_id,
    cohortName: row.cohort_name,
    cohortKind: row.cohort_kind,
    groupId: row.group_id,
    groupName: row.group_name,
    startsOn: row.membership_starts_on
  } : null;
}

export async function loadStudentLeaderboardData(
  supabase: SupabaseClient,
  searchParams: StudentLeaderboardSearchParams
): Promise<StudentLeaderboardData> {
  const today = checkInEffectiveDateString();
  const currentWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(searchParams.week, currentWeekStart);
  const previousWeekStart = addDays(selectedWeekStart, -7);
  const [{ data: scopeRow, error: scopeError }, teacher] = await Promise.all([
    supabase
      .rpc("student_historical_reporting_scope_for_week", { input_week_start: selectedWeekStart })
      .maybeSingle<HistoricalScopeRpcRow>(),
    loadStudentWeekTeacher(supabase, selectedWeekStart)
  ]);

  if (scopeError) {
    throw new Error("Unable to load the historical student reporting scope.");
  }

  const scope = mapHistoricalScope(scopeRow ?? null);

  if (!scope) {
    return {
      scope: null,
      teacher,
      rows: [],
      currentStudentRow: null,
      availableWeekStarts: [selectedWeekStart, currentWeekStart].sort((a, b) => b.localeCompare(a)),
      selectedWeekStart,
      selectedWeekLabel: formatWeekRange(selectedWeekStart),
      selectedWeekComplete: weekIsComplete(selectedWeekStart, today),
      previousWeekStart,
      previousWeekLabel: formatWeekRange(previousWeekStart)
    };
  }

  const [{ data: leaderboardRows, error: leaderboardError }, { data: weekRows, error: weeksError }] =
    await Promise.all([
      supabase.rpc("student_cohort_leaderboard_for_week", {
        input_week_start: selectedWeekStart
      }),
      supabase.rpc("student_leaderboard_available_weeks")
    ]);

  if (leaderboardError) {
    throw new Error("Unable to load the student leaderboard.");
  }

  if (weeksError) {
    throw new Error("Unable to load leaderboard weeks.");
  }

  const rows = Array.isArray(leaderboardRows)
    ? (leaderboardRows as StudentLeaderboardRpcRow[]).map(mapLeaderboardRow)
    : [];
  const availableWeekStarts = [
    ...new Set([
      currentWeekStart,
      selectedWeekStart,
      ...(Array.isArray(weekRows)
        ? (weekRows as Array<{ week_start: string }>).map((row) => row.week_start)
        : [])
    ])
  ].sort((a, b) => b.localeCompare(a));

  return {
    scope,
    teacher,
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
