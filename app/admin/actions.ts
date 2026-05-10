"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCorrectionPayload, checkInItemPayloads, normalizeNote } from "@/lib/checkins";
import { calculateDailySubmission } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

export async function correctCheckIn(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const status = String(formData.get("status") ?? "submitted");
  const note = normalizeNote(formData.get("note"));
  const completedTaskKeys = formData.getAll("task_keys").filter((value): value is string => typeof value === "string");

  if (!studentId || !date) {
    redirect("/admin?status=invalid-correction");
  }

  if (status === "missing") {
    const { error } = await supabase.from("checkins").delete().eq("student_id", studentId).eq("date", date);

    if (error) {
      redirect(`/admin/students/${studentId}?status=correction-error`);
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/students/${studentId}`);
    redirect(`/admin/students/${studentId}?status=corrected`);
  }

  const submission = calculateDailySubmission(date, completedTaskKeys);
  const payload = adminCorrectionPayload({
    adminId: profile.id,
    studentId,
    date,
    completed: true,
    note,
    earnedWeight: submission.earnedWeight,
    totalWeight: submission.totalWeight,
    dailyScore: submission.dailyScore
  });

  const { data: checkin, error } = await supabase
    .from("checkins")
    .upsert(payload, {
      onConflict: "student_id,date"
    })
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .single<CheckIn>();

  if (error || !checkin) {
    redirect(`/admin/students/${studentId}?status=correction-error`);
  }

  const { error: deleteItemsError } = await supabase.from("checkin_items").delete().eq("checkin_id", checkin.id);

  if (deleteItemsError) {
    redirect(`/admin/students/${studentId}?status=correction-error`);
  }

  const { error: insertItemsError } = await supabase
    .from("checkin_items")
    .insert(
      checkInItemPayloads({
        checkinId: checkin.id,
        studentId,
        date,
        completedTaskKeys
      })
    );

  if (insertItemsError) {
    redirect(`/admin/students/${studentId}?status=correction-error`);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(`/admin/students/${studentId}?status=corrected`);
}
