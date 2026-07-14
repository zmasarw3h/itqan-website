import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { weekIsComplete } from "@/lib/leaderboard";
import {
  addDays,
  formatWeekRange,
  isValidDateString,
  todayDateString,
  weekStartForDate
} from "@/lib/dates";
import { loadStudentScopeForWeek, type StudentWeekScope } from "@/lib/student-scope";
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

export type StudentLeaderboardSearchParams = {
  week?: string;
};

export type StudentLeaderboardData = {
  scope: StudentWeekScope | null;
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

export async function loadStudentLeaderboardData(
  supabase: SupabaseClient,
  currentStudentId: string,
  searchParams: StudentLeaderboardSearchParams
): Promise<StudentLeaderboardData> {
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(searchParams.week, currentWeekStart);
  const previousWeekStart = addDays(selectedWeekStart, -7);
  const scope = await loadStudentScopeForWeek(supabase, currentStudentId, selectedWeekStart);

  if (!scope) {
    return {
      scope: null,
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
