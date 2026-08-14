import "server-only";

import type { NextRequest } from "next/server";
import {
  authorizeStudentWeeklyPlan,
  studentWeeklyPlanResponseHeaders,
  type StudentWeeklyPlanDisposition
} from "@/lib/student-weekly-plan";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCurrentProfile } from "@/lib/supabase-server";
import { currentWeeklyPlanContext, WEEKLY_PLAN_BUCKET } from "@/lib/weekly-plans";

export type StudentWeeklyPlanRouteDependencies = {
  authorizeStudentWeeklyPlan: typeof authorizeStudentWeeklyPlan;
  createSupabaseAdminClient: typeof createSupabaseAdminClient;
  currentWeeklyPlanContext: typeof currentWeeklyPlanContext;
  getCurrentProfile: typeof getCurrentProfile;
};

const DEFAULT_DEPENDENCIES: StudentWeeklyPlanRouteDependencies = {
  authorizeStudentWeeklyPlan,
  createSupabaseAdminClient,
  currentWeeklyPlanContext,
  getCurrentProfile
};

function routeResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function handleStudentWeeklyPlanRoute(
  request: NextRequest,
  disposition: StudentWeeklyPlanDisposition,
  dependencies: StudentWeeklyPlanRouteDependencies = DEFAULT_DEPENDENCIES
) {
  const auth = await dependencies.getCurrentProfile();

  if (!auth.user) {
    return routeResponse("Unauthorized", 401);
  }

  if (!auth.profile || auth.profile.role !== "student" || !auth.profile.active) {
    return routeResponse("Forbidden", 403);
  }

  const requestedWeekStart = request.nextUrl.searchParams.get("week") ?? "";
  const currentWeekStart = dependencies.currentWeeklyPlanContext().weekStart;

  if (!requestedWeekStart || requestedWeekStart !== currentWeekStart) {
    return routeResponse("Weekly plan not found", 404);
  }

  const authorization = await dependencies.authorizeStudentWeeklyPlan(auth.supabase, {
    studentId: auth.profile.id,
    weekStart: currentWeekStart
  });

  if (
    authorization.status !== "ok"
    || authorization.plan.student_id !== auth.profile.id
    || authorization.plan.week_start !== currentWeekStart
  ) {
    return routeResponse("Weekly plan not found", 404);
  }

  let storageSupabase: ReturnType<typeof createSupabaseAdminClient>;

  try {
    // The service-role client is created only after the request-bound student
    // owner check and exact metadata/path validation have succeeded.
    storageSupabase = dependencies.createSupabaseAdminClient();
  } catch {
    return routeResponse("Weekly plan unavailable", 404);
  }

  let downloadResult;

  try {
    downloadResult = await storageSupabase.storage
      .from(WEEKLY_PLAN_BUCKET)
      .download(authorization.plan.file_path);
  } catch {
    return routeResponse("Weekly plan unavailable", 404);
  }

  const file = downloadResult.data;

  if (
    downloadResult.error
    || !file
    || typeof file.size !== "number"
    || file.size !== authorization.plan.file_size
  ) {
    return routeResponse("Weekly plan unavailable", 404);
  }

  return new Response(file, {
    status: 200,
    headers: studentWeeklyPlanResponseHeaders(authorization.plan, disposition, file.size)
  });
}
