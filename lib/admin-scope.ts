import "server-only";
import {
  AdminScopeError,
  isScopeWindowEffectiveOn
} from "@/lib/admin-scope-rules";
import type {
  AdminCreateUserScopeOptions,
  AdminUserCohortScope as AdminCohortScope,
  AdminUserGroupScope as AdminGroupScope,
  AdminUserMasjidScope as AdminMasjidScope
} from "@/lib/admin-user-scope";
import { todayDateString } from "@/lib/dates";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireProfile } from "@/lib/supabase-server";
import type { CohortKind, Masjid, Profile } from "@/lib/types";

export type {
  AdminCreateUserScopeOptions,
  AdminUserCohortScope as AdminCohortScope,
  AdminUserGroupScope as AdminGroupScope,
  AdminUserMasjidScope as AdminMasjidScope
} from "@/lib/admin-user-scope";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export type ScopedAdminProfile = Pick<Profile, "id" | "role">;

type AdminMasjidMembershipRow = {
  masjid_id: string;
  starts_on: string;
  ends_on: string | null;
  created_at: string | null;
  masajid: Pick<Masjid, "id" | "name" | "slug">;
};

export type AdminStudentForWeek = {
  student_id: string;
  student_name: string;
  student_email: string;
  student_phone: string | null;
  student_created_at: string | null;
  membership_starts_on: string | null;
  score_starts_on: string | null;
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
    created_at: student.student_created_at ?? undefined,
    score_starts_on: student.score_starts_on
  };
}

export async function requireScopedAdmin() {
  const auth = await requireProfile(["admin", "super_admin"]);

  return {
    ...auth,
    adminSupabase: createSupabaseAdminClient()
  };
}

function studentGroupKey(studentId: string, groupId: string) {
  return `${studentId}:${groupId}`;
}

function sortByNameThenId<T extends { id: string; name: string }>(left: T, right: T) {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function toAdminMasjidScopes(rows: AdminMasjidMembershipRow[], effectiveDate: string) {
  const scopes: AdminMasjidScope[] = [];
  const seenMasjidIds = new Set<string>();

  for (const row of rows) {
    if (seenMasjidIds.has(row.masjid_id) || !isScopeWindowEffectiveOn(row, effectiveDate)) {
      continue;
    }

    seenMasjidIds.add(row.masjid_id);
    scopes.push({
      id: row.masajid.id,
      name: row.masajid.name,
      slug: row.masajid.slug,
      membership_starts_on: row.starts_on
    });
  }

  return scopes.sort(sortByNameThenId);
}

async function loadAllActiveMasjidScopes(adminSupabase: AdminSupabaseClient): Promise<AdminMasjidScope[]> {
  const { data, error } = await adminSupabase
    .from("masajid")
    .select("id,name,slug")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<Pick<Masjid, "id" | "name" | "slug">>>();

  if (error) {
    throw new Error("Unable to load active masajid.");
  }

  return (data ?? []).map((masjid) => ({
    ...masjid,
    membership_starts_on: null
  }));
}

export async function loadAdminMasjidScopes(
  adminSupabase: AdminSupabaseClient,
  adminId: string,
  effectiveDate = todayDateString()
): Promise<AdminMasjidScope[]> {
  const { data, error } = await adminSupabase
    .from("masjid_staff_memberships")
    .select("masjid_id,starts_on,ends_on,created_at,masajid!inner(id,name,slug)")
    .eq("profile_id", adminId)
    .eq("staff_role", "admin")
    .eq("active", true)
    .eq("masajid.active", true)
    .lte("starts_on", effectiveDate)
    .or(`ends_on.is.null,ends_on.gte.${effectiveDate}`)
    .order("starts_on", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<AdminMasjidMembershipRow[]>();

  if (error) {
    throw new Error("Unable to load admin masjid scope.");
  }

  return toAdminMasjidScopes(data ?? [], effectiveDate);
}

async function loadScopedAdminMasjids(input: {
  adminSupabase: AdminSupabaseClient;
  admin: ScopedAdminProfile;
  effectiveDate?: string;
}) {
  if (input.admin.role === "super_admin") {
    return loadAllActiveMasjidScopes(input.adminSupabase);
  }

  return loadAdminMasjidScopes(input.adminSupabase, input.admin.id, input.effectiveDate);
}

export async function loadAdminCreateUserScopeOptions(input: {
  adminSupabase: AdminSupabaseClient;
  admin: ScopedAdminProfile;
  effectiveDate?: string;
}): Promise<AdminCreateUserScopeOptions> {
  const masjids = await loadScopedAdminMasjids(input);
  const masjidIds = masjids.map((masjid) => masjid.id);

  if (masjidIds.length === 0) {
    return { masjids, cohorts: [], groups: [] };
  }

  const { data: cohorts, error: cohortError } = await input.adminSupabase
    .from("cohorts")
    .select("id,masjid_id,kind,name,sort_order")
    .in("masjid_id", masjidIds)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<AdminCohortScope[]>();

  if (cohortError) {
    throw new Error("Unable to load admin cohort scope.");
  }

  const cohortIds = (cohorts ?? []).map((cohort) => cohort.id);

  if (cohortIds.length === 0) {
    return { masjids, cohorts: [], groups: [] };
  }

  const { data: groups, error: groupError } = await input.adminSupabase
    .from("halaqa_groups")
    .select("id,cohort_id,name,sort_order")
    .in("cohort_id", cohortIds)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<AdminGroupScope[]>();

  if (groupError) {
    throw new Error("Unable to load admin group scope.");
  }

  return {
    masjids,
    cohorts: cohorts ?? [],
    groups: groups ?? []
  };
}

export async function assertAdminCanManageMasjid(input: {
  adminSupabase: AdminSupabaseClient;
  admin: ScopedAdminProfile;
  masjidId: string | null;
  effectiveDate?: string;
}): Promise<AdminMasjidScope> {
  if (!input.masjidId) {
    throw new AdminScopeError("missing-scope", "Choose a masjid.");
  }

  if (input.admin.role === "super_admin") {
    const { data, error } = await input.adminSupabase
      .from("masajid")
      .select("id,name,slug")
      .eq("id", input.masjidId)
      .eq("active", true)
      .maybeSingle<Pick<Masjid, "id" | "name" | "slug">>();

    if (error || !data) {
      throw new AdminScopeError("invalid-scope", "The selected masjid is not active.");
    }

    return {
      ...data,
      membership_starts_on: null
    };
  }

  const scopes = await loadAdminMasjidScopes(input.adminSupabase, input.admin.id, input.effectiveDate);
  const scope = scopes.find((candidate) => candidate.id === input.masjidId);

  if (!scope) {
    throw new AdminScopeError("scope-denied", "You do not administer the selected masjid.");
  }

  return scope;
}

export async function assertAdminCanManageCohort(input: {
  adminSupabase: AdminSupabaseClient;
  admin: ScopedAdminProfile;
  cohortId: string | null;
  effectiveDate?: string;
}): Promise<AdminCohortScope & { masjid: AdminMasjidScope }> {
  if (!input.cohortId) {
    throw new AdminScopeError("missing-scope", "Choose a cohort.");
  }

  const { data: cohort, error } = await input.adminSupabase
    .from("cohorts")
    .select("id,masjid_id,kind,name,sort_order")
    .eq("id", input.cohortId)
    .eq("active", true)
    .maybeSingle<AdminCohortScope>();

  if (error || !cohort) {
    throw new AdminScopeError("invalid-scope", "The selected cohort is not active.");
  }

  const masjid = await assertAdminCanManageMasjid({
    adminSupabase: input.adminSupabase,
    admin: input.admin,
    masjidId: cohort.masjid_id,
    effectiveDate: input.effectiveDate
  });

  return { ...cohort, masjid };
}

export async function assertAdminCanManageGroup(input: {
  adminSupabase: AdminSupabaseClient;
  admin: ScopedAdminProfile;
  groupId: string | null;
  effectiveDate?: string;
}): Promise<AdminGroupScope & { cohort: AdminCohortScope; masjid: AdminMasjidScope }> {
  if (!input.groupId) {
    throw new AdminScopeError("missing-scope", "Choose a group.");
  }

  const { data: group, error } = await input.adminSupabase
    .from("halaqa_groups")
    .select("id,cohort_id,name,sort_order")
    .eq("id", input.groupId)
    .eq("active", true)
    .maybeSingle<AdminGroupScope>();

  if (error || !group) {
    throw new AdminScopeError("invalid-scope", "The selected group is not active.");
  }

  const cohort = await assertAdminCanManageCohort({
    adminSupabase: input.adminSupabase,
    admin: input.admin,
    cohortId: group.cohort_id,
    effectiveDate: input.effectiveDate
  });

  return {
    ...group,
    cohort,
    masjid: cohort.masjid
  };
}

export async function loadAdminStudentsForWeek(supabase: SupabaseClient, weekStart: string) {
  const { data, error } = await supabase.rpc("admin_students_for_week", {
    input_week_start: weekStart
  });

  if (error) {
    throw new Error("Unable to load admin student scope.");
  }

  const students = Array.isArray(data)
    ? (data as Array<Omit<AdminStudentForWeek, "membership_starts_on" | "score_starts_on">>)
    : [];
  const studentIds = [...new Set(students.map((student) => student.student_id))];

  if (!studentIds.length) {
    return [];
  }

  const [{ data: memberships, error: membershipsError }, { data: profiles, error: profilesError }] =
    await Promise.all([
      supabase
        .from("student_group_memberships")
        .select("student_id,group_id,starts_on")
        .in("student_id", studentIds)
        .lte("starts_on", weekStart)
        .or(`ends_on.is.null,ends_on.gte.${weekStart}`)
        .order("starts_on", { ascending: false })
        .returns<Array<{ student_id: string; group_id: string; starts_on: string }>>(),
      supabase
        .from("profiles")
        .select("id,score_starts_on")
        .in("id", studentIds)
        .returns<Array<{ id: string; score_starts_on: string | null }>>()
    ]);

  if (membershipsError || profilesError) {
    throw new Error("Unable to load admin student scoring scope.");
  }

  const membershipStartByStudentGroup = new Map<string, string>();

  for (const membership of memberships ?? []) {
    const key = studentGroupKey(membership.student_id, membership.group_id);

    if (!membershipStartByStudentGroup.has(key)) {
      membershipStartByStudentGroup.set(key, membership.starts_on);
    }
  }

  const scoreStartByStudent = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.score_starts_on])
  );

  return students.map((student) => ({
    ...student,
    membership_starts_on:
      membershipStartByStudentGroup.get(studentGroupKey(student.student_id, student.group_id)) ?? null,
    score_starts_on: scoreStartByStudent.get(student.student_id) ?? null
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

export async function canAdminDeleteStudent(supabase: SupabaseClient, studentId: string) {
  const { data, error } = await supabase.rpc("can_admin_delete_student", {
    input_student_id: studentId
  });

  return !error && data === true;
}
