import "server-only";

import { redirect } from "next/navigation";
import { todayDateString } from "@/lib/dates";
import {
  canAccessTeacherExperience,
  hasActiveTeacherStaffMembership,
  selectTeacherRoster,
  type TeacherAssignmentContext,
  type TeacherRosterMembership,
  type TeacherRosterProfile
} from "@/lib/teacher-dashboard";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireProfile } from "@/lib/supabase-server";
import type { MasjidStaffMembership, Profile } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export class TeacherScopeError extends Error {}

export async function loadActiveTeacherCapability(
  supabase: SupabaseClient,
  profile: Pick<Profile, "id" | "role" | "active">,
  effectiveDate = todayDateString()
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

  const { data, error } = await supabase
    .from("masjid_staff_memberships")
    .select("staff_role,active,starts_on,ends_on")
    .eq("profile_id", profile.id)
    .eq("staff_role", "teacher")
    .eq("active", true)
    .lte("starts_on", effectiveDate)
    .or(`ends_on.is.null,ends_on.gte.${effectiveDate}`)
    .returns<Array<Pick<MasjidStaffMembership, "staff_role" | "active" | "starts_on" | "ends_on">>>();

  if (error) {
    throw new Error("Unable to verify teacher access.");
  }

  return canAccessTeacherExperience(
    profile,
    hasActiveTeacherStaffMembership(data ?? [], effectiveDate)
  );
}

export async function requireTeacherExperience() {
  const auth = await requireProfile(["teacher", "admin"]);
  const allowed = await loadActiveTeacherCapability(auth.supabase, auth.profile);

  if (!allowed) {
    redirect("/admin");
  }

  return auth;
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

  if (error || data !== groupId) {
    throw new TeacherScopeError("This student is not in your assigned group for the selected week.");
  }
}

export async function loadTeacherGroupRoster(
  supabase: SupabaseClient,
  groupId: string,
  weekStart: string
) {
  await assertTeacherGroupAssignment(supabase, groupId, weekStart);

  const { data: memberships, error: membershipError } = await supabase
    .from("student_group_memberships")
    .select("student_id,group_id,starts_on,ends_on")
    .eq("group_id", groupId)
    .lte("starts_on", weekStart)
    .or(`ends_on.is.null,ends_on.gte.${weekStart}`)
    .returns<TeacherRosterMembership[]>();

  if (membershipError) {
    throw new Error("Unable to load the assigned group roster.");
  }

  const studentIds = [...new Set((memberships ?? []).map((membership) => membership.student_id))];

  if (studentIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,name,active")
    .in("id", studentIds)
    .eq("role", "student")
    .eq("active", true)
    .returns<TeacherRosterProfile[]>();

  if (profileError) {
    throw new Error("Unable to load assigned students.");
  }

  return selectTeacherRoster({
    groupId,
    weekStart,
    memberships: memberships ?? [],
    profiles: profiles ?? []
  });
}
