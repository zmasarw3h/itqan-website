import { addDays, checkInEffectiveDateString, weekStartForDate } from "@/lib/dates";

export const BELOW70_RESET_NOTE_MAX_LENGTH = 280;

export type Below70StreakReadRow = {
  student_id: string;
  active_streak_length: number;
  streak_through_week_start: string;
  latest_reset_id: string | null;
  latest_reset_masjid_id: string | null;
  latest_reset_cohort_id: string | null;
  latest_reset_group_id: string | null;
  latest_reset_effective_through_week_start: string | null;
  latest_reset_previous_streak_length: number | null;
  latest_reset_passed_test_confirmation: boolean | null;
  latest_reset_admin_note: string | null;
  latest_reset_actor_id: string | null;
  latest_reset_created_at: string | null;
};

export type Below70StreakResetResult = {
  status: "reset" | "replayed";
  reset_id: string;
  student_id: string;
  masjid_id: string;
  cohort_id: string;
  halaqa_group_id: string;
  effective_through_week_start: string;
  previous_streak_length: number;
  passed_test_confirmation: true;
  admin_note: string | null;
  actor_id: string;
  created_at: string;
  active_streak_length: number;
};

export function latestCompletedTrackerWeekStart(now = new Date()) {
  return addDays(weekStartForDate(checkInEffectiveDateString(now)), -7);
}

export function normalizeBelow70ResetNote(note: string | null | undefined) {
  const normalized = note?.trim() || null;

  if (
    normalized &&
    (normalized.length > BELOW70_RESET_NOTE_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized))
  ) {
    throw new Error("Admin note must be at most 280 characters and contain no control characters.");
  }

  return normalized;
}

export function resetBoundaryForThroughWeek(
  resetEffectiveThroughWeekStart: string | null | undefined,
  throughWeekStart: string
) {
  return resetEffectiveThroughWeekStart && resetEffectiveThroughWeekStart <= throughWeekStart
    ? resetEffectiveThroughWeekStart
    : null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Malformed below-70 streak response: ${field}.`);
  }

  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, field);
}

function requireInteger(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`Malformed below-70 streak response: ${field}.`);
  }

  return value;
}

function nullableInteger(value: unknown, field: string, minimum = 0): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireInteger(value, field, minimum);
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Malformed below-70 streak response: ${field}.`);
  }

  return value;
}

export function parseBelow70StreakReadRow(value: unknown): Below70StreakReadRow {
  if (!value || typeof value !== "object") {
    throw new Error("Malformed below-70 streak response.");
  }

  const row = value as Record<string, unknown>;

  return {
    student_id: requireString(row.student_id, "student_id"),
    active_streak_length: requireInteger(row.active_streak_length, "active_streak_length"),
    streak_through_week_start: requireString(row.streak_through_week_start, "streak_through_week_start"),
    latest_reset_id: nullableString(row.latest_reset_id, "latest_reset_id"),
    latest_reset_masjid_id: nullableString(row.latest_reset_masjid_id, "latest_reset_masjid_id"),
    latest_reset_cohort_id: nullableString(row.latest_reset_cohort_id, "latest_reset_cohort_id"),
    latest_reset_group_id: nullableString(row.latest_reset_group_id, "latest_reset_group_id"),
    latest_reset_effective_through_week_start: nullableString(
      row.latest_reset_effective_through_week_start,
      "latest_reset_effective_through_week_start"
    ),
    latest_reset_previous_streak_length: nullableInteger(
      row.latest_reset_previous_streak_length,
      "latest_reset_previous_streak_length",
      3
    ),
    latest_reset_passed_test_confirmation: nullableBoolean(
      row.latest_reset_passed_test_confirmation,
      "latest_reset_passed_test_confirmation"
    ),
    latest_reset_admin_note: nullableString(row.latest_reset_admin_note, "latest_reset_admin_note"),
    latest_reset_actor_id: nullableString(row.latest_reset_actor_id, "latest_reset_actor_id"),
    latest_reset_created_at: nullableString(row.latest_reset_created_at, "latest_reset_created_at")
  };
}

export function parseBelow70StreakReadRows(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Malformed below-70 streak response.");
  }

  return value.map(parseBelow70StreakReadRow);
}

export function parseBelow70StreakResetResult(value: unknown): Below70StreakResetResult {
  if (!value || typeof value !== "object") {
    throw new Error("Malformed below-70 streak reset response.");
  }

  const result = value as Record<string, unknown>;
  const status = result.status;

  if (status !== "reset" && status !== "replayed") {
    throw new Error("Malformed below-70 streak reset response: status.");
  }

  if (result.passed_test_confirmation !== true) {
    throw new Error("Malformed below-70 streak reset response: passed_test_confirmation.");
  }

  return {
    status,
    reset_id: requireString(result.reset_id, "reset_id"),
    student_id: requireString(result.student_id, "student_id"),
    masjid_id: requireString(result.masjid_id, "masjid_id"),
    cohort_id: requireString(result.cohort_id, "cohort_id"),
    halaqa_group_id: requireString(result.halaqa_group_id, "halaqa_group_id"),
    effective_through_week_start: requireString(
      result.effective_through_week_start,
      "effective_through_week_start"
    ),
    previous_streak_length: requireInteger(result.previous_streak_length, "previous_streak_length", 3),
    passed_test_confirmation: true,
    admin_note: nullableString(result.admin_note, "admin_note"),
    actor_id: requireString(result.actor_id, "actor_id"),
    created_at: requireString(result.created_at, "created_at"),
    active_streak_length: requireInteger(result.active_streak_length, "active_streak_length")
  };
}
