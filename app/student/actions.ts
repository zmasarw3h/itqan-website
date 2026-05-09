"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertNoDuplicateCheckIn, normalizeNote } from "@/lib/checkins";
import { todayDateString } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

export async function submitTodayCheckIn(formData: FormData) {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const note = normalizeNote(formData.get("note"));

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

  const { error } = await supabase.from("checkins").insert({
    student_id: profile.id,
    date: today,
    completed: true,
    note
  });

  if (error?.code === "23505") {
    redirect("/student/check-in?status=duplicate");
  }

  if (error) {
    redirect("/student/check-in?status=error");
  }

  revalidatePath("/student/check-in");
  revalidatePath("/student/history");
  redirect("/student/check-in?status=submitted");
}
