import "server-only";

import type { NextRequest } from "next/server";
import {
  adminWeeklyPlanResponseHeaders,
  authorizeAdminWeeklyPlan,
  isCanonicalTrackerWeek,
  type AdminWeeklyPlanDisposition
} from "@/lib/admin-weekly-plan";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCurrentProfile } from "@/lib/supabase-server";
import { WEEKLY_PLAN_BUCKET } from "@/lib/weekly-plans";

export type AdminWeeklyPlanRouteDependencies = {
  authorizeAdminWeeklyPlan: typeof authorizeAdminWeeklyPlan;
  createSupabaseAdminClient: typeof createSupabaseAdminClient;
  getCurrentProfile: typeof getCurrentProfile;
};

const DEFAULT_DEPENDENCIES: AdminWeeklyPlanRouteDependencies = {
  authorizeAdminWeeklyPlan,
  createSupabaseAdminClient,
  getCurrentProfile
};

function routeResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function handleAdminWeeklyPlanRoute(
  request: NextRequest,
  params: Promise<{ id: string }>,
  disposition: AdminWeeklyPlanDisposition,
  dependencies: AdminWeeklyPlanRouteDependencies = DEFAULT_DEPENDENCIES
) {
  const auth = await dependencies.getCurrentProfile();

  if (!auth.user) {
    return routeResponse("Unauthorized", 401);
  }

  if (!auth.profile || !auth.profile.active || !["admin", "super_admin"].includes(auth.profile.role)) {
    return routeResponse("Forbidden", 403);
  }

  const { id: studentId } = await params;
  const weekStart = request.nextUrl.searchParams.get("week") ?? "";

  if (!studentId || !isCanonicalTrackerWeek(weekStart)) {
    return routeResponse("Invalid weekly-plan context", 400);
  }

  const authorization = await dependencies.authorizeAdminWeeklyPlan(auth.supabase, {
    studentId,
    weekStart
  });

  if (authorization.status === "forbidden") {
    return routeResponse("Forbidden", 403);
  }

  if (authorization.status === "not-found") {
    return routeResponse("Weekly plan not found", 404);
  }

  let storageSupabase: ReturnType<typeof createSupabaseAdminClient>;

  try {
    // The service-role client is created only after the request-bound admin
    // scope and exact database row/path checks above have succeeded.
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
    headers: adminWeeklyPlanResponseHeaders(authorization.plan, disposition, file.size)
  });
}
