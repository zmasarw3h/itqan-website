"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { todayDateString, weekStartForDate } from "@/lib/dates";
import { requireStudentScopeForWeek } from "@/lib/student-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { WeeklyPlan } from "@/lib/types";
import {
  WEEKLY_PLAN_BUCKET,
  WEEKLY_PLAN_MAX_BYTES,
  validateWeeklyPlanFile,
  weeklyPlanPathBelongsToStudent,
  weeklyPlanStoragePath
} from "@/lib/weekly-plans";

export async function uploadWeeklyPlan(formData: FormData) {
  const { supabase, profile } = await requireProfile(["student"]);
  const file = formData.get("plan");
  const weekStart = weekStartForDate(todayDateString());
  try {
    await requireStudentScopeForWeek(supabase, profile.id, weekStart);
  } catch {
    redirect("/student/weekly-plan?status=setup-incomplete");
  }

  if (!(file instanceof File)) {
    redirect("/student/weekly-plan?status=invalid");
  }

  const validationError = validateWeeklyPlanFile(file);
  if (validationError) {
    redirect(`/student/weekly-plan?status=${file.size > WEEKLY_PLAN_MAX_BYTES ? "too-large" : "invalid"}`);
  }

  const storageSupabase = createSupabaseAdminClient();

  const { data: existingPlan } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyPlan>();

  const filePath = weeklyPlanStoragePath(profile.id, weekStart, file.name);
  const { error: uploadError } = await storageSupabase.storage
    .from(WEEKLY_PLAN_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: true
    });

  if (uploadError) {
    redirect("/student/weekly-plan?status=upload-error");
  }

  const { error: upsertError } = await supabase.from("weekly_plans").upsert(
    {
      student_id: profile.id,
      week_start: weekStart,
      file_path: filePath,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      uploaded_at: new Date().toISOString()
    },
    { onConflict: "student_id,week_start" }
  );

  if (upsertError) {
    await storageSupabase.storage.from(WEEKLY_PLAN_BUCKET).remove([filePath]);
    redirect("/student/weekly-plan?status=save-error");
  }

  if (
    existingPlan?.file_path &&
    existingPlan.file_path !== filePath &&
    weeklyPlanPathBelongsToStudent(profile.id, weekStart, existingPlan.file_path)
  ) {
    await storageSupabase.storage.from(WEEKLY_PLAN_BUCKET).remove([existingPlan.file_path]);
  }

  revalidatePath("/student/weekly-plan");
  revalidatePath(`/admin/students/${profile.id}`);
  redirect("/student/weekly-plan?status=uploaded");
}
