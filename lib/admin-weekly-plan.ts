import "server-only";

import { canAdminManageStudentForWeek } from "@/lib/admin-scope";
import { isValidDateString, weekStartForDate } from "@/lib/dates";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import type { WeeklyPlan } from "@/lib/types";
import {
  isAllowedWeeklyPlanType,
  safeWeeklyPlanFileName,
  WEEKLY_PLAN_MAX_BYTES,
  weeklyPlanStoragePath
} from "@/lib/weekly-plans";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEKLY_PLAN_PATH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/\d{4}-\d{2}-\d{2}\/[^/\\]+$/i;

export type AdminWeeklyPlanDisposition = "inline" | "attachment";

export type AdminWeeklyPlanRecord = Pick<
  WeeklyPlan,
  | "id"
  | "student_id"
  | "week_start"
  | "file_path"
  | "file_name"
  | "file_type"
  | "file_size"
  | "uploaded_at"
> & {
  masjid_id: string;
  cohort_id: string;
  halaqa_group_id: string;
};

export type AdminWeeklyPlanAuthorization =
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "ok"; plan: AdminWeeklyPlanRecord };

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function isCanonicalTrackerWeek(value: string) {
  return isValidDateString(value) && weekStartForDate(value) === value;
}

/**
 * Validates the exact path shape used by the weekly-plan uploader. This is
 * intentionally stricter than the legacy ownership helper because the admin
 * viewer must not accept a substituted object path or a non-canonical week.
 */
export function weeklyPlanPathMatchesExactContext(
  studentId: string,
  weekStart: string,
  filePath: string,
  fileName?: string
) {
  if (
    !isUuid(studentId)
    || !isCanonicalTrackerWeek(weekStart)
    || !WEEKLY_PLAN_PATH_PATTERN.test(filePath)
    || filePath.includes("..")
  ) {
    return false;
  }

  const [pathStudentId, pathWeekStart, pathFileName] = filePath.split("/");

  if (pathStudentId !== studentId || pathWeekStart !== weekStart || !pathFileName) {
    return false;
  }

  if (fileName !== undefined && filePath !== weeklyPlanStoragePath(studentId, weekStart, fileName)) {
    return false;
  }

  return pathFileName === safeWeeklyPlanFileName(pathFileName);
}

export function adminWeeklyPlanUrl(
  studentId: string,
  weekStart: string,
  disposition: AdminWeeklyPlanDisposition
) {
  return `/admin/students/${encodeURIComponent(studentId)}/weekly-plan/${disposition === "inline" ? "preview" : "download"}?week=${encodeURIComponent(weekStart)}`;
}

export function adminWeeklyPlanResponseHeaders(
  plan: Pick<AdminWeeklyPlanRecord, "file_type" | "file_name">,
  disposition: AdminWeeklyPlanDisposition,
  contentLength: number
) {
  const safeFileName = safeWeeklyPlanFileName(plan.file_name);

  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
    "Content-Length": String(contentLength),
    "Content-Type": plan.file_type,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function scopeRpcValue(value: unknown) {
  return typeof value === "string" && isUuid(value) ? value : null;
}

/**
 * Rechecks the current admin scope, resolves the exact historical operational
 * scope for the requested tracker week, and then reads the matching metadata
 * row through the caller's RLS-bound client. The service-role client is only
 * needed after this function returns `ok`, when the route streams the bytes.
 */
export async function authorizeAdminWeeklyPlan(
  supabase: SupabaseClient,
  input: { studentId: string; weekStart: string }
): Promise<AdminWeeklyPlanAuthorization> {
  if (!isUuid(input.studentId) || !isCanonicalTrackerWeek(input.weekStart)) {
    return { status: "not-found" };
  }

  const { data: student, error: studentError } = await supabase
    .from("profiles")
    .select("id,role,active")
    .eq("id", input.studentId)
    .eq("role", "student")
    .eq("active", true)
    .maybeSingle<{ id: string; role: "student"; active: boolean }>();

  if (studentError || !student || student.role !== "student" || !student.active) {
    return { status: "forbidden" };
  }

  if (!(await canAdminManageStudentForWeek(supabase, input.studentId, input.weekStart))) {
    return { status: "forbidden" };
  }

  const [groupResult, cohortResult, masjidResult] = await Promise.all([
    supabase.rpc("student_group_for_week", {
      input_student_id: input.studentId,
      input_week_start: input.weekStart
    }),
    supabase.rpc("student_cohort_for_week", {
      input_student_id: input.studentId,
      input_week_start: input.weekStart
    }),
    supabase.rpc("student_masjid_for_week", {
      input_student_id: input.studentId,
      input_week_start: input.weekStart
    })
  ]);

  const groupId = scopeRpcValue(groupResult.data);
  const cohortId = scopeRpcValue(cohortResult.data);
  const masjidId = scopeRpcValue(masjidResult.data);

  if (
    groupResult.error
    || cohortResult.error
    || masjidResult.error
    || !groupId
    || !cohortId
    || !masjidId
  ) {
    return { status: "forbidden" };
  }

  const { data: plan, error: planError } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at,masjid_id,cohort_id,halaqa_group_id")
    .eq("student_id", input.studentId)
    .eq("week_start", input.weekStart)
    .maybeSingle<AdminWeeklyPlanRecord>();

  if (planError || !plan) {
    return { status: "not-found" };
  }

  if (
    plan.student_id !== input.studentId
    || plan.week_start !== input.weekStart
    || plan.masjid_id !== masjidId
    || plan.cohort_id !== cohortId
    || plan.halaqa_group_id !== groupId
  ) {
    return { status: "forbidden" };
  }

  if (
    !isAllowedWeeklyPlanType(plan.file_type)
    || !Number.isInteger(plan.file_size)
    || plan.file_size <= 0
    || plan.file_size > WEEKLY_PLAN_MAX_BYTES
    || !plan.file_name.trim()
    || !weeklyPlanPathMatchesExactContext(input.studentId, input.weekStart, plan.file_path, plan.file_name)
  ) {
    return { status: "not-found" };
  }

  return { status: "ok", plan };
}
