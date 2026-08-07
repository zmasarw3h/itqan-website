"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isTrackerWeekStart, parseTeacherGradeInput } from "@/lib/teacher-dashboard";
import { classifyTeacherGradeSaveError } from "@/lib/teacher-session";
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
  const versionId = String(formData.get("version_id") ?? "");
  const grade = parseTeacherGradeInput({
    attended: formData.get("attended") === "true",
    recitationPoints: formData.get("recitation_points"),
    notes: formData.get("notes")
  });

  if (!studentId || !groupId || !versionId || !isTrackerWeekStart(weekStart)) {
    redirect("/teacher?status=invalid-grade");
  }

  if (!grade) {
    redirect(groupPath(groupId, weekStart, "grade-invalid"));
  }

  const { supabase } = await requireTeacherExperience(weekStart);

  let context: Awaited<ReturnType<typeof loadTeacherSessionStudentContext>> | null = null;
  try {
    context = await loadTeacherSessionStudentContext(supabase, studentId, weekStart);
  } catch (error) {
    if (error instanceof TeacherScopeError) {
      redirect(groupPath(groupId, weekStart, "grade-denied"));
    }

    redirect(groupPath(groupId, weekStart, "grade-error"));
  }

  if (!context) {
    redirect(groupPath(groupId, weekStart, "grade-error"));
  }

  if (context.publication.version_id !== versionId) {
    redirect(groupPath(groupId, weekStart, "grade-stale"));
  }

  if (context.group.group_id !== groupId) {
    redirect(groupPath(groupId, weekStart, "grade-denied"));
  }

  let saveError: { code?: string | null; message?: string | null } | null = null;
  try {
    ({ error: saveError } = await supabase.rpc("save_teacher_session_halaqa_grade", {
      input_version_id: context.publication.version_id,
      input_group_id: context.group.group_id,
      input_student_id: studentId,
      input_week_start: weekStart,
      input_attended: grade.attended,
      input_recitation_points: grade.recitationPoints,
      input_notes: grade.notes
    }));
  } catch {
    redirect(groupPath(groupId, weekStart, "grade-error"));
  }

  if (saveError) {
    redirect(groupPath(groupId, weekStart, classifyTeacherGradeSaveError(saveError)));
  }

  revalidatePath("/teacher");
  revalidatePath(`/teacher/groups/${groupId}`);
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student/grades");
  redirect(groupPath(groupId, weekStart, "grade-saved"));
}
