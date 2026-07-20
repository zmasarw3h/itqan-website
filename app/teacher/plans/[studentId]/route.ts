import { NextRequest, NextResponse } from "next/server";
import { isTrackerWeekStart } from "@/lib/teacher-dashboard";
import {
  assertTeacherStudentAssignment,
  loadActiveTeacherCapability,
  TeacherScopeError
} from "@/lib/teacher-scope";
import { getCurrentProfile } from "@/lib/supabase-server";
import type { WeeklyPlan } from "@/lib/types";
import { WEEKLY_PLAN_BUCKET, weeklyPlanPathBelongsToStudent } from "@/lib/weekly-plans";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const weekStart = request.nextUrl.searchParams.get("week") ?? "";
  const auth = await getCurrentProfile();

  if (!auth.profile || !auth.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (
    !isTrackerWeekStart(weekStart) ||
    !(await loadActiveTeacherCapability(auth.supabase, auth.profile, weekStart))
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { data: groupId, error: groupError } = await auth.supabase.rpc("student_group_for_week", {
    input_student_id: studentId,
    input_week_start: weekStart
  });

  if (groupError || !groupId) {
    return NextResponse.redirect(new URL(`/teacher?week=${weekStart}`, request.url));
  }

  try {
    await assertTeacherStudentAssignment(auth.supabase, studentId, String(groupId), weekStart);
  } catch (error) {
    if (error instanceof TeacherScopeError) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    throw error;
  }

  const { data: plan, error: planError } = await auth.supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at,masjid_id,cohort_id,halaqa_group_id")
    .eq("student_id", studentId)
    .eq("week_start", weekStart)
    .eq("halaqa_group_id", groupId)
    .maybeSingle<WeeklyPlan>();

  const returnUrl = new URL(`/teacher/groups/${groupId}`, request.url);
  returnUrl.searchParams.set("week", weekStart);

  if (planError || !plan || !weeklyPlanPathBelongsToStudent(studentId, weekStart, plan.file_path)) {
    returnUrl.searchParams.set("status", planError ? "plan-error" : "plan-missing");
    return NextResponse.redirect(returnUrl);
  }

  const { data, error } = await auth.supabase.storage
    .from(WEEKLY_PLAN_BUCKET)
    .createSignedUrl(plan.file_path, 5 * 60, { download: plan.file_name });

  if (error || !data?.signedUrl) {
    returnUrl.searchParams.set("status", "plan-error");
    return NextResponse.redirect(returnUrl);
  }

  return NextResponse.redirect(data.signedUrl);
}
