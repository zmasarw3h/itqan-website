"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCorrectionPayload, normalizeNote } from "@/lib/checkins";
import { requireProfile } from "@/lib/supabase-server";

export async function correctCheckIn(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const completed = formData.get("completed") === "true";
  const note = normalizeNote(formData.get("note"));

  if (!studentId || !date) {
    redirect("/admin?status=invalid-correction");
  }

  const payload = adminCorrectionPayload({
    adminId: profile.id,
    studentId,
    date,
    completed,
    note
  });

  const { error } = await supabase.from("checkins").upsert(payload, {
    onConflict: "student_id,date"
  });

  if (error) {
    redirect(`/admin/students/${studentId}?status=correction-error`);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(`/admin/students/${studentId}?status=corrected`);
}
