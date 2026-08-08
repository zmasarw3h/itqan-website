"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidDateString } from "@/lib/dates";
import { isTrackerWeekStart, parseTeacherGradeInput } from "@/lib/teacher-dashboard";
import { classifyTeacherGradeSaveError, type TeacherChecklistDetailsResponse } from "@/lib/teacher-session";
import {
  loadTeacherSessionStudentContext,
  requireTeacherExperience,
  TeacherScopeError
} from "@/lib/teacher-scope";

function groupPath(groupId: string, weekStart: string, status: string) {
  const params = new URLSearchParams({ week: weekStart, status });
  return `/teacher/groups/${groupId}?${params.toString()}`;
}

export type TeacherChecklistLoadResult =
  | { ok: true; details: TeacherChecklistDetailsResponse }
  | { ok: false; status: "denied" | "stale" | "invalid" | "error"; message: string };

export async function loadTeacherChecklistDetails(input: {
  studentId: string;
  groupId: string;
  versionId: string;
  weekStart: string;
  checklistDate: string;
}): Promise<TeacherChecklistLoadResult> {
  if (
    !input.studentId || !input.groupId || !input.versionId ||
    !isTrackerWeekStart(input.weekStart) || !isValidDateString(input.checklistDate)
  ) {
    return { ok: false, status: "invalid", message: "Choose a valid checklist date for this tracker week." };
  }

  let auth: Awaited<ReturnType<typeof requireTeacherExperience>>;
  try {
    auth = await requireTeacherExperience(input.weekStart);
  } catch {
    return { ok: false, status: "denied", message: "You are not authorized to view this checklist." };
  }

  try {
    const context = await loadTeacherSessionStudentContext(auth.supabase, input.studentId, input.weekStart);
    if (context.publication.version_id !== input.versionId) {
      return { ok: false, status: "stale", message: "The published roster changed. Close this panel and reload the group." };
    }
    if (context.group.group_id !== input.groupId) {
      return { ok: false, status: "denied", message: "This student is not in the selected published group." };
    }

    const { data, error } = await auth.supabase.rpc("get_teacher_session_checklist_details", {
      input_version_id: input.versionId,
      input_group_id: input.groupId,
      input_student_id: input.studentId,
      input_week_start: input.weekStart,
      input_checklist_date: input.checklistDate
    });

    if (error || !data) {
      const status = error?.code === "42501" ? "denied" : error?.code === "22023" ? "invalid" : "error";
      return { ok: false, status, message: status === "error" ? "Checklist details could not be loaded. Try again." : "This checklist is unavailable for the selected published context." };
    }

    return { ok: true, details: data as TeacherChecklistDetailsResponse };
  } catch (error) {
    if (error instanceof TeacherScopeError) {
      return { ok: false, status: "denied", message: "This checklist is outside your published session scope." };
    }
    return { ok: false, status: "error", message: "Checklist details could not be loaded. Try again." };
  }
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
