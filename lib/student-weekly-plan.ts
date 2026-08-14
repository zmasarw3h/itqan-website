import "server-only";

import { isValidDateString, weekStartForDate } from "@/lib/dates";
import type { WeeklyPlan } from "@/lib/types";
import {
  isAllowedWeeklyPlanType,
  safeWeeklyPlanFileName,
  WEEKLY_PLAN_MAX_BYTES,
  weeklyPlanPathMatchesExactContext
} from "@/lib/weekly-plans";
import type { createServerSupabaseClient } from "@/lib/supabase-server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type StudentWeeklyPlanDisposition = "inline" | "attachment";

export type StudentWeeklyPlanRecord = Pick<
  WeeklyPlan,
  "id" | "student_id" | "week_start" | "file_path" | "file_name" | "file_type" | "file_size" | "uploaded_at"
>;

export type StudentWeeklyPlanAuthorization =
  | { status: "not-found" }
  | { status: "ok"; plan: StudentWeeklyPlanRecord };

export function studentWeeklyPlanResponseHeaders(
  plan: Pick<StudentWeeklyPlanRecord, "file_type" | "file_name">,
  disposition: StudentWeeklyPlanDisposition,
  contentLength: number
) {
  return {
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${disposition}; filename="${safeWeeklyPlanFileName(plan.file_name)}"`,
    "Content-Length": String(contentLength),
    "Content-Type": plan.file_type,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

export async function authorizeStudentWeeklyPlan(
  supabase: SupabaseClient,
  input: { studentId: string; weekStart: string }
): Promise<StudentWeeklyPlanAuthorization> {
  if (!isValidDateString(input.weekStart) || weekStartForDate(input.weekStart) !== input.weekStart) {
    return { status: "not-found" };
  }

  const { data: plan, error } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", input.studentId)
    .eq("week_start", input.weekStart)
    .maybeSingle<StudentWeeklyPlanRecord>();

  if (
    error
    || !plan
    || plan.student_id !== input.studentId
    || plan.week_start !== input.weekStart
    || !isAllowedWeeklyPlanType(plan.file_type)
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
