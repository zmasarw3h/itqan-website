import "server-only";
import { staffAccessLabel, staffMembershipIsActiveOn, membershipIsActiveOn } from "@/lib/super-admin-access";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { todayDateString, weekStartForDate } from "@/lib/dates";
import type {
  Cohort,
  CohortKind,
  GroupTeacherAssignment,
  HalaqaGroup,
  Masjid,
  MasjidStaffMembership,
  Profile,
  Role,
  StaffRole,
  StudentGroupMembership
} from "@/lib/types";

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export type PeopleSearchParams = {
  q?: string;
  active?: string;
  role?: string;
  status?: string;
};

export type AccessOptionMasjid = Pick<Masjid, "id" | "name" | "slug">;

export type AccessOptionGroup = Pick<HalaqaGroup, "id" | "name" | "cohort_id"> & {
  cohort_name: string;
  cohort_kind: CohortKind;
  masjid_id: string;
  masjid_name: string;
};

export type AccessOptions = {
  masjids: AccessOptionMasjid[];
  groups: AccessOptionGroup[];
};

export type CurrentStudentAccess = {
  student_id: string;
  group_id: string;
  group_name: string;
  cohort_name: string;
  masjid_id: string;
  masjid_name: string;
};

export type CurrentStaffAccess = {
  profile_id: string;
  masjid_id: string;
  masjid_name: string;
  staff_role: StaffRole;
};

export type PeopleSearchResult = {
  profile: Profile;
  studentAccess: CurrentStudentAccess[];
  staffAccessByMasjid: Array<{
    masjid_id: string;
    masjid_name: string;
    label: string;
  }>;
  accessSummaries: string[];
};

export type PeopleSearchData = {
  searched: boolean;
  query: string;
  activeFilter: "active" | "inactive" | "all";
  roleFilter: Role | "all";
  results: PeopleSearchResult[];
};

export type StudentMembershipDetail = StudentGroupMembership & {
  group_name: string;
  cohort_name: string;
  cohort_kind: CohortKind;
  masjid_id: string;
  masjid_name: string;
};

export type StaffMembershipDetail = MasjidStaffMembership & {
  masjid_name: string;
};

export type TeacherAssignmentDetail = GroupTeacherAssignment & {
  group_name: string;
  cohort_name: string;
  masjid_id: string;
  masjid_name: string;
};

export type PersonDetailData = {
  profile: Profile;
  authEmail: string | null;
  authMissing: boolean;
  studentMemberships: StudentMembershipDetail[];
  staffMemberships: StaffMembershipDetail[];
  teacherAssignments: TeacherAssignmentDetail[];
  warnings: string[];
  options: AccessOptions;
};

export type ActiveGroupScope = {
  group: Pick<HalaqaGroup, "id" | "name" | "cohort_id">;
  cohort: Pick<Cohort, "id" | "name" | "kind" | "masjid_id">;
  masjid: Pick<Masjid, "id" | "name" | "slug">;
};

export type ActiveMasjidScope = Pick<Masjid, "id" | "name" | "slug">;

const ROLES = new Set<Role>(["student", "teacher", "admin", "super_admin"]);

export const SUPER_ADMIN_PEOPLE_STATUS_MESSAGES: Record<string, { text: string; className: string }> = {
  "access-updated": {
    text: "Access changes saved.",
    className: "bg-green-50 text-green-800"
  },
  "membership-ended": {
    text: "Membership ended without deleting history.",
    className: "bg-green-50 text-green-800"
  },
  "password-reset": {
    text: "Temporary password set. Share it directly and ask them to change it after signing in.",
    className: "bg-green-50 text-green-800"
  },
  invalid: {
    text: "Check the submitted values and try again.",
    className: "bg-red-50 text-red-700"
  },
  "confirmation-mismatch": {
    text: "Confirmation did not match the required name or masjid.",
    className: "bg-red-50 text-red-700"
  },
  "scope-invalid": {
    text: "Choose active masjid and group scope before saving.",
    className: "bg-red-50 text-red-700"
  },
  "guard-denied": {
    text: "That change is blocked by super-admin safety rules.",
    className: "bg-red-50 text-red-700"
  },
  "access-stale": {
    text: "Access changed while this form was open. Review the current access and submit again.",
    className: "bg-amber-50 text-amber-900"
  },
  "save-error": {
    text: "Unable to save access changes.",
    className: "bg-red-50 text-red-700"
  },
  "password-invalid": {
    text: "Temporary password must match confirmation and be at least 8 characters.",
    className: "bg-red-50 text-red-700"
  },
  "password-error": {
    text: "Unable to reset this password.",
    className: "bg-red-50 text-red-700"
  }
};

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function digitsOnly(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function parseActiveFilter(value: string | undefined): PeopleSearchData["activeFilter"] {
  if (value === "inactive") return "inactive";
  if (value === "all") return "all";
  return "active";
}

function parseRoleFilter(value: string | undefined): PeopleSearchData["roleFilter"] {
  return value && ROLES.has(value as Role) ? (value as Role) : "all";
}

function profileMatchesQuery(profile: Profile, query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  const queryDigits = digitsOnly(query);

  if (!normalizedQuery && !queryDigits) {
    return true;
  }

  const normalizedFields = [profile.name, profile.phone, profile.email].map(normalizeSearchValue);
  const fieldMatches = normalizedFields.some((field) => field.includes(normalizedQuery));
  const digitFields = [profile.phone, profile.email].map(digitsOnly);
  const digitMatches = queryDigits ? digitFields.some((field) => field.includes(queryDigits)) : false;

  return fieldMatches || digitMatches;
}

function uniq<T>(values: T[]) {
  return [...new Set(values)];
}

async function loadMasjidsById(adminSupabase: AdminSupabaseClient, masjidIds: string[]) {
  const ids = uniq(masjidIds).filter(Boolean);

  if (ids.length === 0) {
    return new Map<string, Pick<Masjid, "id" | "name" | "slug">>();
  }

  const { data, error } = await adminSupabase
    .from("masajid")
    .select("id,name,slug")
    .in("id", ids)
    .returns<Array<Pick<Masjid, "id" | "name" | "slug">>>();

  if (error) {
    throw new Error("Unable to load masajid.");
  }

  return new Map((data ?? []).map((masjid) => [masjid.id, masjid]));
}

async function loadCohortsById(adminSupabase: AdminSupabaseClient, cohortIds: string[]) {
  const ids = uniq(cohortIds).filter(Boolean);

  if (ids.length === 0) {
    return new Map<string, Pick<Cohort, "id" | "name" | "kind" | "masjid_id">>();
  }

  const { data, error } = await adminSupabase
    .from("cohorts")
    .select("id,name,kind,masjid_id")
    .in("id", ids)
    .returns<Array<Pick<Cohort, "id" | "name" | "kind" | "masjid_id">>>();

  if (error) {
    throw new Error("Unable to load cohorts.");
  }

  return new Map((data ?? []).map((cohort) => [cohort.id, cohort]));
}

async function loadGroupsById(adminSupabase: AdminSupabaseClient, groupIds: string[]) {
  const ids = uniq(groupIds).filter(Boolean);

  if (ids.length === 0) {
    return new Map<string, Pick<HalaqaGroup, "id" | "name" | "cohort_id">>();
  }

  const { data, error } = await adminSupabase
    .from("halaqa_groups")
    .select("id,name,cohort_id")
    .in("id", ids)
    .returns<Array<Pick<HalaqaGroup, "id" | "name" | "cohort_id">>>();

  if (error) {
    throw new Error("Unable to load groups.");
  }

  return new Map((data ?? []).map((group) => [group.id, group]));
}

async function buildStudentMembershipDetails(
  adminSupabase: AdminSupabaseClient,
  memberships: StudentGroupMembership[]
): Promise<StudentMembershipDetail[]> {
  const groupById = await loadGroupsById(
    adminSupabase,
    memberships.map((membership) => membership.group_id)
  );
  const cohortById = await loadCohortsById(
    adminSupabase,
    [...groupById.values()].map((group) => group.cohort_id)
  );
  const masjidById = await loadMasjidsById(
    adminSupabase,
    [...cohortById.values()].map((cohort) => cohort.masjid_id)
  );

  return memberships.map((membership) => {
    const group = groupById.get(membership.group_id);
    const cohort = group ? cohortById.get(group.cohort_id) : null;
    const masjid = cohort ? masjidById.get(cohort.masjid_id) : null;

    return {
      ...membership,
      group_name: group?.name ?? "Missing group",
      cohort_name: cohort?.name ?? "Missing cohort",
      cohort_kind: cohort?.kind ?? "brothers",
      masjid_id: cohort?.masjid_id ?? "",
      masjid_name: masjid?.name ?? "Missing masjid"
    };
  });
}

async function buildStaffMembershipDetails(
  adminSupabase: AdminSupabaseClient,
  memberships: MasjidStaffMembership[]
): Promise<StaffMembershipDetail[]> {
  const masjidById = await loadMasjidsById(
    adminSupabase,
    memberships.map((membership) => membership.masjid_id)
  );

  return memberships.map((membership) => ({
    ...membership,
    masjid_name: masjidById.get(membership.masjid_id)?.name ?? "Missing masjid"
  }));
}

function groupStaffAccessByMasjid(rows: CurrentStaffAccess[]) {
  const byMasjid = new Map<string, { masjid_id: string; masjid_name: string; hasAdmin: boolean; hasTeacher: boolean }>();

  for (const row of rows) {
    const existing = byMasjid.get(row.masjid_id) ?? {
      masjid_id: row.masjid_id,
      masjid_name: row.masjid_name,
      hasAdmin: false,
      hasTeacher: false
    };

    if (row.staff_role === "admin") {
      existing.hasAdmin = true;
    } else {
      existing.hasTeacher = true;
    }

    byMasjid.set(row.masjid_id, existing);
  }

  return [...byMasjid.values()]
    .sort((a, b) => a.masjid_name.localeCompare(b.masjid_name))
    .map((row) => ({
      masjid_id: row.masjid_id,
      masjid_name: row.masjid_name,
      label: staffAccessLabel(row)
    }));
}

async function loadCurrentStudentAccessForPeople(input: {
  adminSupabase: AdminSupabaseClient;
  profileIds: string[];
  today: string;
}) {
  if (input.profileIds.length === 0) {
    return [];
  }

  const { data, error } = await input.adminSupabase
    .from("student_group_memberships")
    .select("id,student_id,group_id,starts_on,ends_on,assigned_by,created_at,updated_at")
    .in("student_id", input.profileIds)
    .lte("starts_on", input.today)
    .or(`ends_on.is.null,ends_on.gte.${input.today}`)
    .returns<StudentGroupMembership[]>();

  if (error) {
    throw new Error("Unable to load current student access.");
  }

  const details = await buildStudentMembershipDetails(input.adminSupabase, data ?? []);

  return details.map((membership) => ({
    student_id: membership.student_id,
    group_id: membership.group_id,
    group_name: membership.group_name,
    cohort_name: membership.cohort_name,
    masjid_id: membership.masjid_id,
    masjid_name: membership.masjid_name
  }));
}

async function loadCurrentStaffAccessForPeople(input: {
  adminSupabase: AdminSupabaseClient;
  profileIds: string[];
  today: string;
}) {
  if (input.profileIds.length === 0) {
    return [];
  }

  const { data, error } = await input.adminSupabase
    .from("masjid_staff_memberships")
    .select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on,created_by,created_at,updated_at")
    .in("profile_id", input.profileIds)
    .eq("active", true)
    .lte("starts_on", input.today)
    .or(`ends_on.is.null,ends_on.gte.${input.today}`)
    .returns<MasjidStaffMembership[]>();

  if (error) {
    throw new Error("Unable to load current staff access.");
  }

  const details = await buildStaffMembershipDetails(input.adminSupabase, data ?? []);

  return details.map((membership) => ({
    profile_id: membership.profile_id,
    masjid_id: membership.masjid_id,
    masjid_name: membership.masjid_name,
    staff_role: membership.staff_role
  }));
}

export async function loadPeopleSearchData(
  adminSupabase: AdminSupabaseClient,
  searchParams: PeopleSearchParams
): Promise<PeopleSearchData> {
  const query = String(searchParams.q ?? "").trim();
  const activeFilter = parseActiveFilter(searchParams.active);
  const roleFilter = parseRoleFilter(searchParams.role);
  const searched = Boolean(query || activeFilter !== "active" || roleFilter !== "all");

  if (!searched) {
    return { searched, query, activeFilter, roleFilter, results: [] };
  }

  let profileQuery = adminSupabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .order("name", { ascending: true })
    .limit(500);

  if (activeFilter !== "all") {
    profileQuery = profileQuery.eq("active", activeFilter === "active");
  }

  if (roleFilter !== "all") {
    profileQuery = profileQuery.eq("role", roleFilter);
  }

  const { data, error } = await profileQuery.returns<Profile[]>();

  if (error) {
    throw new Error("Unable to load people.");
  }

  const profiles = (data ?? []).filter((profile) => profileMatchesQuery(profile, query)).slice(0, 50);
  const profileIds = profiles.map((profile) => profile.id);
  const today = todayDateString();
  const [studentAccessRows, staffAccessRows] = await Promise.all([
    loadCurrentStudentAccessForPeople({ adminSupabase, profileIds, today }),
    loadCurrentStaffAccessForPeople({ adminSupabase, profileIds, today })
  ]);
  const studentAccessByProfileId = new Map<string, CurrentStudentAccess[]>();
  const staffAccessByProfileId = new Map<string, CurrentStaffAccess[]>();

  for (const row of studentAccessRows) {
    studentAccessByProfileId.set(row.student_id, [...(studentAccessByProfileId.get(row.student_id) ?? []), row]);
  }

  for (const row of staffAccessRows) {
    staffAccessByProfileId.set(row.profile_id, [...(staffAccessByProfileId.get(row.profile_id) ?? []), row]);
  }

  return {
    searched,
    query,
    activeFilter,
    roleFilter,
    results: profiles.map((profile) => {
      const studentAccess = studentAccessByProfileId.get(profile.id) ?? [];
      const staffAccessByMasjid = groupStaffAccessByMasjid(staffAccessByProfileId.get(profile.id) ?? []);
      const accessSummaries = [
        ...studentAccess.map((access) => `${access.masjid_name}: Student in ${access.group_name}`),
        ...staffAccessByMasjid.map((access) => `${access.masjid_name}: ${access.label}`)
      ];

      return {
        profile,
        studentAccess,
        staffAccessByMasjid,
        accessSummaries: accessSummaries.length ? accessSummaries : ["No active access"]
      };
    })
  };
}

export async function loadAccessOptions(adminSupabase: AdminSupabaseClient): Promise<AccessOptions> {
  const { data: masjids, error: masjidError } = await adminSupabase
    .from("masajid")
    .select("id,name,slug")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<AccessOptionMasjid[]>();

  if (masjidError) {
    throw new Error("Unable to load masjid options.");
  }

  const masjidIds = (masjids ?? []).map((masjid) => masjid.id);
  const { data: cohorts, error: cohortError } = masjidIds.length
    ? await adminSupabase
        .from("cohorts")
        .select("id,name,kind,masjid_id")
        .in("masjid_id", masjidIds)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .returns<Array<Pick<Cohort, "id" | "name" | "kind" | "masjid_id">>>()
    : { data: [], error: null };

  if (cohortError) {
    throw new Error("Unable to load cohort options.");
  }

  const cohortById = new Map((cohorts ?? []).map((cohort) => [cohort.id, cohort]));
  const masjidById = new Map((masjids ?? []).map((masjid) => [masjid.id, masjid]));
  const cohortIds = (cohorts ?? []).map((cohort) => cohort.id);
  const { data: groups, error: groupError } = cohortIds.length
    ? await adminSupabase
        .from("halaqa_groups")
        .select("id,name,cohort_id")
        .in("cohort_id", cohortIds)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .returns<Array<Pick<HalaqaGroup, "id" | "name" | "cohort_id">>>()
    : { data: [], error: null };

  if (groupError) {
    throw new Error("Unable to load group options.");
  }

  return {
    masjids: masjids ?? [],
    groups: (groups ?? [])
      .map((group) => {
        const cohort = cohortById.get(group.cohort_id);
        const masjid = cohort ? masjidById.get(cohort.masjid_id) : null;

        if (!cohort || !masjid) {
          return null;
        }

        return {
          ...group,
          cohort_name: cohort.name,
          cohort_kind: cohort.kind,
          masjid_id: masjid.id,
          masjid_name: masjid.name
        };
      })
      .filter((group): group is AccessOptionGroup => group !== null)
  };
}

export async function loadActiveMasjidScope(
  adminSupabase: AdminSupabaseClient,
  masjidId: string
): Promise<ActiveMasjidScope | null> {
  const { data, error } = await adminSupabase
    .from("masajid")
    .select("id,name,slug")
    .eq("id", masjidId)
    .eq("active", true)
    .maybeSingle<ActiveMasjidScope>();

  if (error) {
    throw new Error("Unable to load selected masjid.");
  }

  return data ?? null;
}

export async function loadActiveGroupScope(
  adminSupabase: AdminSupabaseClient,
  groupId: string
): Promise<ActiveGroupScope | null> {
  const { data: group, error: groupError } = await adminSupabase
    .from("halaqa_groups")
    .select("id,name,cohort_id")
    .eq("id", groupId)
    .eq("active", true)
    .maybeSingle<Pick<HalaqaGroup, "id" | "name" | "cohort_id">>();

  if (groupError) {
    throw new Error("Unable to load selected group.");
  }

  if (!group) {
    return null;
  }

  const { data: cohort, error: cohortError } = await adminSupabase
    .from("cohorts")
    .select("id,name,kind,masjid_id")
    .eq("id", group.cohort_id)
    .eq("active", true)
    .maybeSingle<Pick<Cohort, "id" | "name" | "kind" | "masjid_id">>();

  if (cohortError) {
    throw new Error("Unable to load selected cohort.");
  }

  if (!cohort) {
    return null;
  }

  const masjid = await loadActiveMasjidScope(adminSupabase, cohort.masjid_id);

  if (!masjid) {
    return null;
  }

  return { group, cohort, masjid };
}

export async function loadProfileById(adminSupabase: AdminSupabaseClient, profileId: string) {
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("id", profileId)
    .maybeSingle<Profile>();

  if (error) {
    throw new Error("Unable to load profile.");
  }

  return data ?? null;
}

export async function loadStudentMembershipsForPerson(adminSupabase: AdminSupabaseClient, profileId: string) {
  const { data, error } = await adminSupabase
    .from("student_group_memberships")
    .select("id,student_id,group_id,starts_on,ends_on,assigned_by,created_at,updated_at")
    .eq("student_id", profileId)
    .order("starts_on", { ascending: false })
    .returns<StudentGroupMembership[]>();

  if (error) {
    throw new Error("Unable to load student memberships.");
  }

  return buildStudentMembershipDetails(adminSupabase, data ?? []);
}

export async function loadStaffMembershipsForPerson(adminSupabase: AdminSupabaseClient, profileId: string) {
  const { data, error } = await adminSupabase
    .from("masjid_staff_memberships")
    .select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on,created_by,created_at,updated_at")
    .eq("profile_id", profileId)
    .order("starts_on", { ascending: false })
    .returns<MasjidStaffMembership[]>();

  if (error) {
    throw new Error("Unable to load staff memberships.");
  }

  return buildStaffMembershipDetails(adminSupabase, data ?? []);
}

async function loadTeacherAssignmentsForPerson(adminSupabase: AdminSupabaseClient, profileId: string) {
  const weekStart = weekStartForDate(todayDateString());
  const { data, error } = await adminSupabase
    .from("group_teacher_assignments")
    .select("id,group_id,teacher_id,week_start,active,assigned_by,created_at,updated_at")
    .eq("teacher_id", profileId)
    .eq("active", true)
    .gte("week_start", weekStart)
    .order("week_start", { ascending: true })
    .limit(12)
    .returns<GroupTeacherAssignment[]>();

  if (error) {
    throw new Error("Unable to load teacher assignments.");
  }

  const assignments = data ?? [];
  const groupById = await loadGroupsById(
    adminSupabase,
    assignments.map((assignment) => assignment.group_id)
  );
  const cohortById = await loadCohortsById(
    adminSupabase,
    [...groupById.values()].map((group) => group.cohort_id)
  );
  const masjidById = await loadMasjidsById(
    adminSupabase,
    [...cohortById.values()].map((cohort) => cohort.masjid_id)
  );

  return assignments.map((assignment) => {
    const group = groupById.get(assignment.group_id);
    const cohort = group ? cohortById.get(group.cohort_id) : null;
    const masjid = cohort ? masjidById.get(cohort.masjid_id) : null;

    return {
      ...assignment,
      group_name: group?.name ?? "Missing group",
      cohort_name: cohort?.name ?? "Missing cohort",
      masjid_id: cohort?.masjid_id ?? "",
      masjid_name: masjid?.name ?? "Missing masjid"
    };
  });
}

function buildWarnings(input: {
  profile: Profile;
  authMissing: boolean;
  studentMemberships: StudentMembershipDetail[];
  staffMemberships: StaffMembershipDetail[];
}) {
  const today = todayDateString();
  const activeStudentMemberships = input.studentMemberships.filter((membership) => membershipIsActiveOn(membership, today));
  const activeStaffMemberships = input.staffMemberships.filter((membership) => staffMembershipIsActiveOn(membership, today));
  const activeTeacherStaffMemberships = activeStaffMemberships.filter((membership) => membership.staff_role === "teacher");
  const activeStaffByMasjid = groupStaffAccessByMasjid(
    activeStaffMemberships.map((membership) => ({
      profile_id: membership.profile_id,
      masjid_id: membership.masjid_id,
      masjid_name: membership.masjid_name,
      staff_role: membership.staff_role
    }))
  );
  const warnings: string[] = [];

  if (input.authMissing) {
    warnings.push("Profile exists, but the Supabase Auth user could not be found.");
  }

  if (input.profile.active && activeStudentMemberships.length === 0 && activeStaffMemberships.length === 0) {
    warnings.push("Active profile has no active masjid access.");
  }

  if (
    !input.profile.active &&
    (input.studentMemberships.some((membership) => membership.ends_on === null) ||
      input.staffMemberships.some((membership) => membership.active && membership.ends_on === null))
  ) {
    warnings.push("Inactive profile still has open memberships.");
  }

  if (input.profile.active && input.profile.role === "student" && activeStudentMemberships.length === 0) {
    warnings.push("Active student has no active group membership.");
  }

  if (input.profile.active && input.profile.role === "teacher" && activeTeacherStaffMemberships.length === 0) {
    warnings.push("Active teacher has no active teacher staff membership.");
  }

  for (const access of activeStaffByMasjid) {
    if (access.label === "Teacher only") {
      warnings.push(`${access.masjid_name}: Teacher only access cannot add teachers or manage students.`);
    }
  }

  return warnings;
}

export async function loadPersonDetailData(
  adminSupabase: AdminSupabaseClient,
  profileId: string
): Promise<PersonDetailData | null> {
  const profile = await loadProfileById(adminSupabase, profileId);

  if (!profile) {
    return null;
  }

  const [{ data: authData, error: authError }, studentMemberships, staffMemberships, teacherAssignments, options] =
    await Promise.all([
      adminSupabase.auth.admin.getUserById(profile.id),
      loadStudentMembershipsForPerson(adminSupabase, profile.id),
      loadStaffMembershipsForPerson(adminSupabase, profile.id),
      loadTeacherAssignmentsForPerson(adminSupabase, profile.id),
      loadAccessOptions(adminSupabase)
    ]);
  const authEmail = authData.user?.email ?? null;
  const authMissing = Boolean(authError || !authData.user);

  return {
    profile,
    authEmail,
    authMissing,
    studentMemberships,
    staffMemberships,
    teacherAssignments,
    options,
    warnings: buildWarnings({ profile, authMissing, studentMemberships, staffMemberships })
  };
}
