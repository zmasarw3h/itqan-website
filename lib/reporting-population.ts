import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { loadAllSupabasePages } from "@/lib/supabase-pagination";
import type { CohortKind } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type HistoricalReportingStudent = {
  week_start: string;
  student_id: string;
  student_name: string;
  student_email: string | null;
  student_phone: string | null;
  membership_starts_on: string;
  membership_ends_on: string | null;
  score_starts_on: string | null;
  scoring_eligible: boolean;
  masjid_id: string;
  masjid_name: string;
  cohort_id: string;
  cohort_kind: CohortKind;
  cohort_name: string;
  group_id: string;
  group_name: string;
  can_view_current_contact: boolean;
  can_open_current_profile: boolean;
};

export type HistoricalActivityScope = {
  student_id: string;
  masjid_id?: string | null;
  cohort_id?: string | null;
  halaqa_group_id?: string | null;
  attribution_disposition?: HistoricalReportAttributionDisposition;
};

export type HistoricalReportAttributionDisposition =
  | "counted_exact_scope"
  | "counted_same_masjid_placement_mismatch"
  | "counted_legacy_missing_masjid_by_unambiguous_membership"
  | "excluded_cross_masjid_explicit_masjid"
  | "excluded_cross_masjid_cohort"
  | "excluded_cross_masjid_group"
  | "excluded_conflicting_stored_scope"
  | "excluded_no_historical_membership"
  | "excluded_ambiguous_historical_membership"
  | "excluded_invalid_tracker_week";

export type HistoricalReportingActivity = HistoricalActivityScope & {
  activity_kind: "checkin" | "partner_recitation" | "halaqa_grade";
  row_id: string;
  activity_date: string;
  week_start: string;
  daily_score: number | null;
  recitation_round: string | null;
  partner_points: number | null;
  attendance_points: number | null;
  recitation_points: number | null;
  attribution_disposition: HistoricalReportAttributionDisposition;
};

function populationKey(studentId: string, weekStart: string) {
  return `${studentId}:${weekStart}`;
}

export async function loadHistoricalReportingStudentsForWeeks(
  supabase: SupabaseClient,
  weekStarts: string[]
) {
  const uniqueWeekStarts = [...new Set(weekStarts)];

  if (!uniqueWeekStarts.length) {
    return [];
  }

  try {
    return await loadAllSupabasePages<HistoricalReportingStudent>((from, to) =>
      supabase
        .rpc("historical_reporting_students_for_weeks", { input_week_starts: uniqueWeekStarts })
        .range(from, to)
    );
  } catch {
    throw new Error("Unable to load the historical reporting population.");
  }
}

export async function loadHistoricalReportingAvailableWeeks(supabase: SupabaseClient) {
  try {
    const rows = await loadAllSupabasePages<{ week_start: string }>((from, to) =>
      supabase.rpc("historical_reporting_available_weeks").range(from, to)
    );
    return rows.map((row) => row.week_start);
  } catch {
    throw new Error("Unable to load historical reporting weeks.");
  }
}

export async function loadHistoricalReportingActivityForWeeks(
  supabase: SupabaseClient,
  weekStarts: string[]
) {
  const uniqueWeekStarts = [...new Set(weekStarts)];
  if (!uniqueWeekStarts.length) return [];

  try {
    return await loadAllSupabasePages<HistoricalReportingActivity>((from, to) =>
      supabase
        .rpc("historical_reporting_activity_for_weeks", { input_week_starts: uniqueWeekStarts })
        .range(from, to)
    );
  } catch {
    throw new Error("Unable to load historical reporting activity.");
  }
}

export function historicalPopulationByStudentWeek(population: HistoricalReportingStudent[]) {
  const byStudentWeek = new Map<string, HistoricalReportingStudent | null>();

  for (const student of population) {
    const key = populationKey(student.student_id, student.week_start);
    byStudentWeek.set(key, byStudentWeek.has(key) ? null : student);
  }

  return byStudentWeek;
}

export function activityExactlyMatchesHistoricalPopulation(
  activity: HistoricalActivityScope,
  weekStart: string,
  populationByWeek: ReadonlyMap<string, HistoricalReportingStudent | null>
) {
  const population = populationByWeek.get(populationKey(activity.student_id, weekStart));

  return Boolean(
    population &&
      activity.masjid_id === population.masjid_id &&
      activity.cohort_id === population.cohort_id &&
      activity.halaqa_group_id === population.group_id
  );
}

export function activityCountsForHistoricalReport(
  activity: HistoricalActivityScope,
  weekStart: string,
  populationByWeek: ReadonlyMap<string, HistoricalReportingStudent | null>
) {
  const population = populationByWeek.get(populationKey(activity.student_id, weekStart));

  if (!population) return false;

  return activity.attribution_disposition === "counted_exact_scope"
    || activity.attribution_disposition === "counted_same_masjid_placement_mismatch"
    || activity.attribution_disposition ===
      "counted_legacy_missing_masjid_by_unambiguous_membership";
}

export function reportingPopulationKey(studentId: string, weekStart: string) {
  return populationKey(studentId, weekStart);
}
