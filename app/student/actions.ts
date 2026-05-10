"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertNoDuplicateCheckIn, checkInItemPayloads, normalizeNote } from "@/lib/checkins";
import { todayDateString } from "@/lib/dates";
import { calculateDailySubmission } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

export async function submitTodayCheckIn(formData: FormData) {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const note = normalizeNote(formData.get("note"));
  const completedTaskKeys = formData.getAll("task_keys").filter((value): value is string => typeof value === "string");
  const submission = calculateDailySubmission(today, completedTaskKeys);

  const { data: existing } = await supabase
    .from("checkins")
    .select("student_id,date")
    .eq("student_id", profile.id)
    .eq("date", today)
    .maybeSingle<Pick<CheckIn, "student_id" | "date">>();

  try {
    assertNoDuplicateCheckIn(existing ?? null);
  } catch {
    redirect("/student/check-in?status=duplicate");
  }

  const { data: checkin, error } = await supabase
    .from("checkins")
    .insert({
      student_id: profile.id,
      date: today,
      completed: true,
      note,
      earned_weight: submission.earnedWeight,
      total_weight: submission.totalWeight,
      daily_score: submission.dailyScore
    })
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .single<CheckIn>();

  if (error?.code === "23505") {
    redirect("/student/check-in?status=duplicate");
  }

  if (error) {
    redirect("/student/check-in?status=error");
  }

  const { error: itemsError } = await supabase
    .from("checkin_items")
    .insert(
      checkInItemPayloads({
        checkinId: checkin.id,
        studentId: profile.id,
        date: today,
        completedTaskKeys
      })
    );

  if (itemsError) {
    redirect("/student/check-in?status=error");
  }

  revalidatePath("/student/check-in");
  revalidatePath("/student/history");
  redirect("/student/check-in?status=submitted");
}
