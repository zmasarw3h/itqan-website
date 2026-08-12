import "server-only";

import {
  buildLeaderboardRowsFromAggregates,
  weekIsComplete,
  type LeaderboardRow
} from "@/lib/leaderboard";
import {
  loadAdminDashboardAvailableWeeks,
  loadAdminDashboardLeaderboardForWeek
} from "@/lib/admin-dashboard";
import {
  checkInEffectiveDateString,
  formatWeekRange,
  isValidDateString,
  weekStartForDate
} from "@/lib/dates";
import type { requireProfile } from "@/lib/supabase-server";
import {
  measureServerLoaderPhase,
  type ServerLoaderTiming
} from "@/lib/server-loader-timing";

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

function validWeekStart(value: string | undefined, fallback: string, allowedWeekStarts: ReadonlySet<string>) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value && allowedWeekStarts.has(value) ? value : fallback;
}

export async function loadLeaderboardData(
  supabase: SupabaseClient,
  searchParams: LeaderboardSearchParams,
  timing?: ServerLoaderTiming
): Promise<LeaderboardData> {
  const today = checkInEffectiveDateString();
  const currentWeekStart = weekStartForDate(today);
  const below70Only = false;
  const reportWeekStarts = timing
    ? await measureServerLoaderPhase(timing, "week_discovery", () =>
      loadAdminDashboardAvailableWeeks(supabase)
    )
    : await loadAdminDashboardAvailableWeeks(supabase);
  const selectableWeekStarts = new Set([currentWeekStart, ...reportWeekStarts]);
  const selectedWeekStart = validWeekStart(searchParams.week, currentWeekStart, selectableWeekStarts);
  const availableWeekStarts = [...selectableWeekStarts].sort((a, b) => b.localeCompare(a));
  const aggregates = timing
    ? await measureServerLoaderPhase(timing, "aggregation", () =>
      loadAdminDashboardLeaderboardForWeek(supabase, selectedWeekStart, below70Only)
    )
    : await loadAdminDashboardLeaderboardForWeek(supabase, selectedWeekStart, below70Only);

  return {
    rows: buildLeaderboardRowsFromAggregates({
      aggregates,
      selectedWeekStart,
      today,
      below70Only
    }),
    availableWeekStarts,
    selectedWeekStart,
    selectedWeekLabel: formatWeekRange(selectedWeekStart),
    selectedWeekComplete: weekIsComplete(selectedWeekStart, today),
    below70Only
  };
}
