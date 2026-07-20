import "server-only";

import { redirect } from "next/navigation";
import {
  canAccessTeacherExperience,
  type TeacherAssignmentContext,
  type TeacherRosterContext
} from "@/lib/teacher-dashboard";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireProfile } from "@/lib/supabase-server";
import type { Profile } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export class TeacherScopeError extends Error {}

export async function loadActiveTeacherCapability(
  supabase: SupabaseClient,
  profile: Pick<Profile, "id" | "role" | "active">,
  requestedAssignmentWeek?: string
) {
  if (!profile.active) {
    return false;
  }

  if (profile.role === "teacher") {
    return true;
  }

  if (profile.role !== "admin") {
    return false;
  }

  const assignments = await loadTeacherAssignmentContexts(supabase);
  return canAccessTeacherExperience(profile, assignments, requestedAssignmentWeek);
}

export async function requireTeacherExperience(requestedAssignmentWeek?: string) {
  const auth = await requireProfile(["teacher", "admin"]);
  const assignments = await loadTeacherAssignmentContexts(auth.supabase);
  const allowed = canAccessTeacherExperience(
    auth.profile,
    assignments,
    requestedAssignmentWeek
  );

  if (!allowed) {
    redirect("/admin");
  }

  return { ...auth, assignments };
}

export async function loadTeacherAssignmentContexts(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("teacher_assignment_contexts");

  if (error) {
    throw new Error("Unable to load teacher assignments.");
  }

  return ((data ?? []) as Array<Omit<TeacherAssignmentContext, "roster_count"> & { roster_count: number | string }>).map(
    (assignment) => ({ ...assignment, roster_count: Number(assignment.roster_count ?? 0) })
  );
}

export async function assertTeacherGroupAssignment(
  supabase: SupabaseClient,
  groupId: string,
  weekStart: string
) {
  const { data, error } = await supabase.rpc("is_teacher_for_group_week", {
    input_group_id: groupId,
    input_week_start: weekStart
  });

  if (error || data !== true) {
    throw new TeacherScopeError("This group is not assigned to you for the selected week.");
  }
}

export async function assertTeacherStudentAssignment(
  supabase: SupabaseClient,
  studentId: string,
  groupId: string,
  weekStart: string
) {
  await assertTeacherGroupAssignment(supabase, groupId, weekStart);

  const { data, error } = await supabase.rpc("student_group_for_week", {
    input_student_id: studentId,
    input_week_start: weekStart
  });

  const { data: canGrade, error: gradeError } = await supabase.rpc("can_grade_student_for_week", {
    input_student_id: studentId,
    input_week_start: weekStart
  });

  if (error || data !== groupId || gradeError || canGrade !== true) {
    throw new TeacherScopeError("This student is not in your assigned group for the selected week.");
  }
}

export async function loadTeacherGroupRoster(
  supabase: SupabaseClient,
  groupId: string,
  weekStart: string
) {
  await assertTeacherGroupAssignment(supabase, groupId, weekStart);

  const { data, error } = await supabase.rpc("teacher_group_roster_context", {
    input_group_id: groupId,
    input_week_start: weekStart
  });

  if (error) {
    throw new Error("Unable to load assigned students.");
  }

  return ((data ?? []) as Array<{
    student_id: string;
    student_name: string;
    daily_checkin_days: number | string;
    daily_points: number | string;
    partner_rounds: number | string;
    partner_points: number | string;
  }>).map<TeacherRosterContext>((student) => ({
    id: student.student_id,
    name: student.student_name,
    dailyCheckinDays: Number(student.daily_checkin_days ?? 0),
    dailyPoints: Number(student.daily_points ?? 0),
    partnerRounds: Number(student.partner_rounds ?? 0),
    partnerPoints: Number(student.partner_points ?? 0)
  }));
}
