import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import type { CohortKind } from "@/lib/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type StudentScopeMembershipRow = {
  group_id: string;
  starts_on: string;
  halaqa_groups: {
    id: string;
    name: string;
    cohort_id: string;
    cohorts: {
      id: string;
      name: string;
      kind: CohortKind;
      masjid_id: string;
      masajid: {
        id: string;
        name: string;
        slug: string;
      } | null;
    } | null;
  } | null;
};

export type StudentWeekScope = {
  studentId: string;
  weekStart: string;
  masjidId: string;
  masjidName: string;
  masjidSlug: string;
  cohortId: string;
  cohortName: string;
  cohortKind: CohortKind;
  groupId: string;
  groupName: string;
  startsOn: string;
};

export type StudentWeekTeacher = {
  teacher_name: string;
};

function mapScopeRow(
  row: StudentScopeMembershipRow | null,
  studentId: string,
  weekStart: string
): StudentWeekScope | null {
  const group = row?.halaqa_groups ?? null;
  const cohort = group?.cohorts ?? null;
  const masjid = cohort?.masajid ?? null;

  if (!row || !group || !cohort || !masjid) {
    return null;
  }

  return {
    studentId,
    weekStart,
    masjidId: masjid.id,
    masjidName: masjid.name,
    masjidSlug: masjid.slug,
    cohortId: cohort.id,
    cohortName: cohort.name,
    cohortKind: cohort.kind,
    groupId: group.id,
    groupName: group.name,
    startsOn: row.starts_on
  };
}

export async function loadStudentScopeForWeek(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
): Promise<StudentWeekScope | null> {
  const { data, error } = await supabase
    .from("student_group_memberships")
    .select(
      "group_id,starts_on,halaqa_groups(id,name,cohort_id,cohorts(id,name,kind,masjid_id,masajid(id,name,slug)))"
    )
    .eq("student_id", studentId)
    .lte("starts_on", weekStart)
    .or(`ends_on.is.null,ends_on.gte.${weekStart}`)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle<StudentScopeMembershipRow>();

  if (error) {
    throw new Error("Unable to load student halaqa assignment.");
  }

  return mapScopeRow(data ?? null, studentId, weekStart);
}

export async function loadStudentWeekTeacher(
  supabase: SupabaseClient,
  weekStart: string
): Promise<StudentWeekTeacher | null> {
  const { data, error } = await supabase
    .rpc("student_weekly_teacher_name", {
      input_week_start: weekStart
    })
    .maybeSingle<StudentWeekTeacher>();

  if (error) {
    throw new Error("Unable to load this week's teacher.");
  }

  return data ?? null;
}

export async function loadStudentWeekContext(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const scope = await loadStudentScopeForWeek(supabase, studentId, weekStart);

  return {
    scope,
    teacher: scope ? await loadStudentWeekTeacher(supabase, weekStart) : null
  };
}

export async function requireStudentScopeForWeek(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const scope = await loadStudentScopeForWeek(supabase, studentId, weekStart);

  if (!scope) {
    throw new Error("Your halaqa assignment is not ready yet.");
  }

  return scope;
}
