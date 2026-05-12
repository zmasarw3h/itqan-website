"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCorrectionPayload, checkInItemPayloads, normalizeNote } from "@/lib/checkins";
import { calculateDailySubmission, calculateHalaqaGrade } from "@/lib/scoring";
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

export async function saveHalaqaGrade(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const weekStart = String(formData.get("week_start") ?? "");
  const attended = formData.get("attended") === "true";
  const recitationPointsValue = Number(formData.get("recitation_points") ?? 0);
  const notes = normalizeNote(formData.get("notes"));

  if (!studentId || !weekStart) {
    redirect("/admin?status=invalid-grade");
  }

  let grade: ReturnType<typeof calculateHalaqaGrade>;

  try {
    grade = calculateHalaqaGrade({
      attended,
      recitationPoints: attended ? recitationPointsValue : 0
    });
  } catch {
    redirect(`/admin/students/${studentId}?status=grade-invalid`);
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("halaqa_grades").upsert(
    {
      student_id: studentId,
      week_start: weekStart,
      attended: grade.attended,
      attendance_points: grade.attendance_points,
      recitation_points: grade.recitation_points,
      notes,
      graded_by: profile.id,
      graded_at: now,
      updated_at: now
    },
    { onConflict: "student_id,week_start" }
  );

  if (error) {
    redirect(`/admin/students/${studentId}?status=grade-error`);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(`/admin/students/${studentId}?status=grade-saved`);
}
