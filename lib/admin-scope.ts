import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import type { CohortKind, Profile } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type AdminStudentForWeek = {
  student_id: string;
  student_name: string;
  student_email: string;
  student_phone: string | null;
  student_created_at: string | null;
  membership_starts_on: string | null;
  masjid_id: string;
  cohort_id: string;
  cohort_kind: CohortKind;
  cohort_name: string;
  group_id: string;
  group_name: string;
};

export function adminScopedStudentToProfile(student: AdminStudentForWeek): Profile & { score_starts_on: string | null } {
  return {
    id: student.student_id,
    name: student.student_name,
    email: student.student_email,
    phone: student.student_phone,
    role: "student",
    active: true,
    created_at: student.student_created_at ?? undefined,
    score_starts_on: student.membership_starts_on
  };
}

function studentGroupKey(studentId: string, groupId: string) {
  return `${studentId}:${groupId}`;
}

export async function loadAdminStudentsForWeek(supabase: SupabaseClient, weekStart: string) {
  const { data, error } = await supabase.rpc("admin_students_for_week", {
    input_week_start: weekStart
  });

  if (error) {
    throw new Error("Unable to load admin student scope.");
  }

  const students = Array.isArray(data) ? (data as Array<Omit<AdminStudentForWeek, "membership_starts_on">>) : [];
  const studentIds = [...new Set(students.map((student) => student.student_id))];

  if (!studentIds.length) {
    return [];
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("student_group_memberships")
    .select("student_id,group_id,starts_on")
    .in("student_id", studentIds)
    .lte("starts_on", weekStart)
    .or(`ends_on.is.null,ends_on.gte.${weekStart}`)
    .order("starts_on", { ascending: false })
    .returns<Array<{ student_id: string; group_id: string; starts_on: string }>>();

  if (membershipsError) {
    throw new Error("Unable to load admin student membership starts.");
  }

  const membershipStartByStudentGroup = new Map<string, string>();

  for (const membership of memberships ?? []) {
    const key = studentGroupKey(membership.student_id, membership.group_id);

    if (!membershipStartByStudentGroup.has(key)) {
      membershipStartByStudentGroup.set(key, membership.starts_on);
    }
  }

  return students.map((student) => ({
    ...student,
    membership_starts_on: membershipStartByStudentGroup.get(studentGroupKey(student.student_id, student.group_id)) ?? null
  }));
}

export async function canAdminManageStudentForWeek(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const { data, error } = await supabase.rpc("can_admin_manage_student_for_week", {
    input_student_id: studentId,
    input_week_start: weekStart
  });

  if (error) {
    return false;
  }

  return data === true;
}
