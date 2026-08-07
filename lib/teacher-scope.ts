import "server-only";

import { redirect } from "next/navigation";
import {
  canAccessTeacherExperience,
  type TeacherAssignmentContext
} from "@/lib/teacher-dashboard";
import type {
  TeacherSessionAuthorizedScope,
  TeacherSessionDashboardResponse,
  TeacherSessionGroupRosterResponse,
  TeacherSessionStudentContextResponse
} from "@/lib/teacher-session";
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

  return (
    (data ?? []) as Array<
      Omit<TeacherAssignmentContext, "roster_count"> & { roster_count: number | string | null }
    >
  ).map((assignment) => ({
    ...assignment,
    roster_count: assignment.roster_count === null ? null : Number(assignment.roster_count)
  }));
}

export async function loadTeacherSessionAuthorizedScopes(
  supabase: SupabaseClient,
  weekStart: string
) {
  const { data, error } = await supabase.rpc("teacher_session_authorized_scopes", {
    input_week_start: weekStart
  });

  if (error) {
    throw new TeacherScopeError("Unable to load the published teacher session scope.");
  }

  return (data ?? []) as TeacherSessionAuthorizedScope[];
}

export async function loadTeacherSessionDashboard(
  supabase: SupabaseClient,
  cohortId: string,
  weekStart: string
) {
  const { data, error } = await supabase.rpc("get_teacher_session_dashboard", {
    input_cohort_id: cohortId,
    input_week_start: weekStart
  });

  if (error || !data) {
    throw new TeacherScopeError("Unable to load the published teacher session dashboard.");
  }

  return data as TeacherSessionDashboardResponse;
}

export async function loadTeacherSessionDashboards(
  supabase: SupabaseClient,
  weekStart: string
) {
  const scopes = await loadTeacherSessionAuthorizedScopes(supabase, weekStart);
  return Promise.all(
    scopes.map((scope) => loadTeacherSessionDashboard(supabase, scope.cohort_id, weekStart))
  );
}

export async function loadTeacherSessionGroupRoster(
  supabase: SupabaseClient,
  versionId: string,
  groupId: string,
  weekStart: string
) {
  const { data, error } = await supabase.rpc("get_teacher_session_group_roster", {
    input_version_id: versionId,
    input_group_id: groupId,
    input_week_start: weekStart
  });

  if (error) {
    throw new TeacherScopeError("This group is not in the current published session roster.");
  }

  if (!data) {
    throw new TeacherScopeError("This group is not in the current published session roster.");
  }

  return data as TeacherSessionGroupRosterResponse;
}

export async function loadTeacherSessionStudentContext(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const { data, error } = await supabase.rpc("get_teacher_session_student_context", {
    input_student_id: studentId,
    input_week_start: weekStart
  });

  if (error || !data) {
    throw new TeacherScopeError("This student is not in your published session roster for the selected week.");
  }

  return data as TeacherSessionStudentContextResponse;
}
