"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isTrackerWeekStart, parseTeacherGradeInput } from "@/lib/teacher-dashboard";
import {
  loadTeacherSessionStudentContext,
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

  const { supabase } = await requireTeacherExperience(weekStart);

  try {
    const context = await loadTeacherSessionStudentContext(supabase, studentId, weekStart);
    if (context.group.group_id !== groupId) {
      throw new TeacherScopeError("This student is in a different published session group.");
    }

    const { error } = await supabase.rpc("save_teacher_session_halaqa_grade", {
      input_version_id: context.publication.version_id,
      input_group_id: context.group.group_id,
      input_student_id: studentId,
      input_week_start: weekStart,
      input_attended: grade.attended,
      input_recitation_points: grade.recitationPoints,
      input_notes: grade.notes
    });

    if (error) {
      throw new TeacherScopeError("The published session roster changed while saving this grade.");
    }
  } catch (error) {
    if (error instanceof TeacherScopeError) {
      redirect(groupPath(groupId, weekStart, "grade-denied"));
    }

    throw error;
  }

  revalidatePath("/teacher");
  revalidatePath(`/teacher/groups/${groupId}`);
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student/grades");
  redirect(groupPath(groupId, weekStart, "grade-saved"));
}
