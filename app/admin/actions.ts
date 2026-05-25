"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAdminStudentCreateInput } from "@/lib/admin-students";
import { adminCorrectionPayload, checkInItemPayloads, normalizeNote } from "@/lib/checkins";
import { calculateDailySubmission, HALAQA_ATTENDANCE_POINTS } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

function adminStudentStatusPath(studentId: string, status: string, weekStart?: string) {
  const params = new URLSearchParams({ status });

  if (weekStart) {
    params.set("week", weekStart);
  }

  return `/admin/students/${studentId}?${params.toString()}`;
}

export async function createStudent(formData: FormData) {
  const { supabase } = await requireProfile(["admin"]);

  let input: ReturnType<typeof buildAdminStudentCreateInput>;

  try {
    input = buildAdminStudentCreateInput({
      name: formData.get("name"),
      phone: formData.get("phone")
    });
  } catch {
    redirect("/admin/students/new?status=invalid");
  }

  const { data: existingProfiles } = await supabase
    .from("profiles")
    .select("id")
    .or(`email.eq.${input.email},phone.eq.${input.phone}`)
    .limit(1)
    .returns<Array<{ id: string }>>();

  if (existingProfiles?.length) {
    redirect("/admin/students/new?status=exists");
  }

  const adminSupabase = createSupabaseAdminClient();
  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true
  });

  if (authError || !authData.user) {
    redirect("/admin/students/new?status=exists");
  }

  const { error: profileError } = await adminSupabase.from("profiles").upsert(
    {
      id: authData.user.id,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      active: input.active
    },
    { onConflict: "id" }
  );

  if (profileError) {
    redirect("/admin/students/new?status=profile-error");
  }

  revalidatePath("/admin");
  redirect(`/admin/students/new?status=created&student=${authData.user.id}`);
}

export async function correctCheckIn(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const status = String(formData.get("status") ?? "submitted");
  const redirectWeek = String(formData.get("redirect_week") ?? "");
  const note = normalizeNote(formData.get("note"));
  const completedTaskKeys = formData.getAll("task_keys").filter((value): value is string => typeof value === "string");

  if (!studentId || !date) {
    redirect("/admin?status=invalid-correction");
  }

  if (status === "missing") {
    const { error } = await supabase.from("checkins").delete().eq("student_id", studentId).eq("date", date);

    if (error) {
      redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/students/${studentId}`);
    redirect(adminStudentStatusPath(studentId, "corrected", redirectWeek));
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
    redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
  }

  const { error: deleteItemsError } = await supabase.from("checkin_items").delete().eq("checkin_id", checkin.id);

  if (deleteItemsError) {
    redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
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
    redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(adminStudentStatusPath(studentId, "corrected", redirectWeek));
}

export async function saveHalaqaGrade(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const weekStart = String(formData.get("week_start") ?? "");
  const redirectWeek = String(formData.get("redirect_week") ?? "");
  const attended = formData.get("attended") === "true";
  const recitationPointsValue = Number(formData.get("recitation_points") ?? 0);
  const notes = normalizeNote(formData.get("notes"));

  if (!studentId || !weekStart) {
    redirect("/admin?status=invalid-grade");
  }

  if (attended && (!Number.isFinite(recitationPointsValue) || recitationPointsValue < 10 || recitationPointsValue > 50)) {
    redirect(adminStudentStatusPath(studentId, "grade-invalid", redirectWeek || weekStart));
  }

  const grade = {
    attended,
    attendance_points: attended ? HALAQA_ATTENDANCE_POINTS : 0,
    recitation_points: attended ? recitationPointsValue : 0
  };

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
    redirect(adminStudentStatusPath(studentId, "grade-error", redirectWeek || weekStart));
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(adminStudentStatusPath(studentId, "grade-saved", redirectWeek || weekStart));
}
