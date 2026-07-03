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
  masjid_id: string;
  cohort_id: string;
  cohort_kind: CohortKind;
  cohort_name: string;
  group_id: string;
  group_name: string;
};

export function adminScopedStudentToProfile(student: AdminStudentForWeek): Profile {
  return {
    id: student.student_id,
    name: student.student_name,
    email: student.student_email,
    phone: student.student_phone,
    role: "student",
    active: true,
    created_at: student.student_created_at ?? undefined
  };
}

export async function loadAdminStudentsForWeek(supabase: SupabaseClient, weekStart: string) {
  const { data, error } = await supabase.rpc("admin_students_for_week", {
    input_week_start: weekStart
  });

  if (error) {
    throw new Error("Unable to load admin student scope.");
  }

  return Array.isArray(data) ? (data as AdminStudentForWeek[]) : [];
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
