"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isTrackerWeekStart, parseTeacherGradeInput } from "@/lib/teacher-dashboard";
import {
  assertTeacherStudentAssignment,
  requireTeacherExperience,
  TeacherScopeError
} from "@/lib/teacher-scope";

function groupPath(groupId: string, weekStart: string, status: string) {
  const params = new URLSearchParams({ week: weekStart, status });
  return `/teacher/groups/${groupId}?${params.toString()}`;
}

export async function saveTeacherHalaqaGrade(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const groupId = String(formData.get("group_id") ?? "");
  const weekStart = String(formData.get("week_start") ?? "");
  const grade = parseTeacherGradeInput({
    attended: formData.get("attended") === "true",
    recitationPoints: formData.get("recitation_points"),
    notes: formData.get("notes")
  });

  if (!studentId || !groupId || !isTrackerWeekStart(weekStart)) {
    redirect("/teacher?status=invalid-grade");
  }

  if (!grade) {
    redirect(groupPath(groupId, weekStart, "grade-invalid"));
  }

  const { supabase, profile } = await requireTeacherExperience(weekStart);

  try {
    await assertTeacherStudentAssignment(supabase, studentId, groupId, weekStart);
  } catch (error) {
    if (error instanceof TeacherScopeError) {
      redirect(groupPath(groupId, weekStart, "grade-denied"));
    }

    throw error;
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("halaqa_grades").upsert(
    {
      student_id: studentId,
      week_start: weekStart,
      attended: grade.attended,
      attendance_points: grade.attendancePoints,
      recitation_points: grade.recitationPoints,
      notes: grade.notes,
      graded_by: profile.id,
      graded_at: now,
      updated_at: now
    },
    { onConflict: "student_id,week_start" }
  );

  if (error) {
    redirect(groupPath(groupId, weekStart, "grade-error"));
  }

  revalidatePath("/teacher");
  revalidatePath(`/teacher/groups/${groupId}`);
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student/grades");
  redirect(groupPath(groupId, weekStart, "grade-saved"));
}
