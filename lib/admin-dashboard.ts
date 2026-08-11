import "server-only";

import type { LeaderboardAggregate } from "@/lib/leaderboard";
import type { createServerSupabaseClient } from "@/lib/supabase-server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type AdminDashboardAggregate = LeaderboardAggregate;

type AdminDashboardPayload = {
  selected_week_start: string;
  rows: unknown[];
};

function parseNumber(value: unknown, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid admin dashboard ${field}.`);
  }

  return parsed;
}

function parseString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`Invalid admin dashboard ${field}.`);
  }

  return value;
}

function parseNullableString(value: unknown, field: string) {
  if (value !== null && typeof value !== "string") {
    throw new Error(`Invalid admin dashboard ${field}.`);
  }

  return value as string | null;
}

function parseBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid admin dashboard ${field}.`);
  }

  return value;
}

function parseDashboardRow(value: unknown): AdminDashboardAggregate {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid admin dashboard row.");
  }

  const row = value as Record<string, unknown>;

  return {
    student_id: parseString(row.student_id, "student id"),
    student_name: parseString(row.student_name, "student name"),
    student_email: parseNullableString(row.student_email, "student email"),
    student_phone: parseNullableString(row.student_phone, "student phone"),
    masjid_name: parseString(row.masjid_name, "masjid name"),
    cohort_name: parseString(row.cohort_name, "cohort name"),
    group_name: parseString(row.group_name, "group name"),
    can_view_current_contact: parseBoolean(row.can_view_current_contact, "contact visibility"),
    can_open_current_profile: parseBoolean(row.can_open_current_profile, "profile visibility"),
    score_starts_on: parseNullableString(row.score_starts_on, "score start"),
    daily_points: parseNumber(row.daily_points, "daily points"),
    partner_points: parseNumber(row.partner_points, "partner points"),
    halaqa_points: parseNumber(row.halaqa_points, "halaqa points"),
    total_points: parseNumber(row.total_points, "total points"),
    percentage: parseNumber(row.percentage, "percentage"),
    below70_streak: parseNumber(row.below70_streak, "below-70 streak")
  };
}

export async function loadAdminDashboardAvailableWeeks(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .rpc("admin_dashboard_available_weeks")
    .returns<string[]>();

  if (error) {
    throw new Error("Unable to load dashboard weeks.");
  }

  return Array.isArray(data) ? data : [];
}

export async function loadAdminDashboardLeaderboardForWeek(
  supabase: SupabaseClient,
  selectedWeekStart: string,
  below70Only: boolean
) {
  const { data: rawData, error } = await supabase
    .rpc("admin_dashboard_leaderboard_for_week", {
      input_selected_week_start: selectedWeekStart,
      input_below70_only: below70Only
    })
    .returns<AdminDashboardPayload[]>();
  const data = rawData as unknown as AdminDashboardPayload | null;

  if (error || !data || typeof data !== "object" || !Array.isArray(data.rows)) {
    throw new Error("Unable to load dashboard scores.");
  }

  return data.rows.map(parseDashboardRow);
}

export async function loadAdminStudentAvailableWeekStarts(
  supabase: SupabaseClient,
  studentId: string,
  selectedWeekStart: string
) {
  const { data, error } = await supabase
    .rpc("admin_student_available_week_starts", {
      input_student_id: studentId,
      input_selected_week_start: selectedWeekStart
    })
    .returns<string[]>();

  if (error) {
    throw new Error("Unable to load student workspace week options.");
  }

  return Array.isArray(data) ? data : [];
}
