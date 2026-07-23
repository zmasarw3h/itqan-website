import "server-only";
import { todayDateString, weekStartForDate } from "@/lib/dates";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  Cohort,
  GroupTeacherAssignment,
  HalaqaGroup,
  Masjid,
  MasjidStaffMembership,
  Profile,
  StudentGroupMembership
} from "@/lib/types";

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export type RepairIssueKind =
  | "student_without_group"
  | "teacher_without_staff"
  | "inactive_with_open_access"
  | "active_without_access"
  | "masjid_without_admin"
  | "assignment_without_teacher_access"
  | "profile_without_auth"
  | "auth_without_profile";

export type RepairIssue = {
  id: string;
  kind: RepairIssueKind;
  severity: "high" | "medium";
  title: string;
  description: string;
  scope: string;
  href: string | null;
  actionLabel: string | null;
};

const PAGE_SIZE = 1000;

async function loadAll<T>(loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("Unable to scan super-admin repair state.");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function currentWindow(row: { active: boolean; starts_on: string; ends_on: string | null }, date: string) {
  return row.active && row.starts_on <= date && (!row.ends_on || row.ends_on >= date);
}

function currentStudentWindow(row: { starts_on: string; ends_on: string | null }, date: string) {
  return row.starts_on <= date && (!row.ends_on || row.ends_on >= date);
}

function coversDate(row: { active: boolean; starts_on: string; ends_on: string | null }, date: string) {
  return row.active && row.starts_on <= date && (!row.ends_on || row.ends_on >= date);
}

export async function loadRepairIssues(adminSupabase: AdminSupabaseClient) {
  const today = todayDateString();
  const currentWeek = weekStartForDate(today);

  const [profiles, masajid, cohorts, groups, studentMemberships, staffMemberships, assignments] = await Promise.all([
    loadAll<Pick<Profile, "id" | "name" | "email" | "role" | "active">>((from, to) =>
      adminSupabase.from("profiles").select("id,name,email,role,active").order("id").range(from, to)
    ),
    loadAll<Pick<Masjid, "id" | "name" | "active">>((from, to) =>
      adminSupabase.from("masajid").select("id,name,active").order("id").range(from, to)
    ),
    loadAll<Pick<Cohort, "id" | "masjid_id" | "name">>((from, to) =>
      adminSupabase.from("cohorts").select("id,masjid_id,name").order("id").range(from, to)
    ),
    loadAll<Pick<HalaqaGroup, "id" | "cohort_id" | "name">>((from, to) =>
      adminSupabase.from("halaqa_groups").select("id,cohort_id,name").order("id").range(from, to)
    ),
    loadAll<Pick<StudentGroupMembership, "id" | "student_id" | "starts_on" | "ends_on">>((from, to) =>
      adminSupabase.from("student_group_memberships").select("id,student_id,starts_on,ends_on").order("id").range(from, to)
    ),
    loadAll<Pick<MasjidStaffMembership, "id" | "profile_id" | "masjid_id" | "staff_role" | "active" | "starts_on" | "ends_on">>((from, to) =>
      adminSupabase.from("masjid_staff_memberships").select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on").order("id").range(from, to)
    ),
    loadAll<Pick<GroupTeacherAssignment, "id" | "teacher_id" | "group_id" | "week_start" | "active">>((from, to) =>
      adminSupabase.from("group_teacher_assignments").select("id,teacher_id,group_id,week_start,active").eq("active", true).gte("week_start", currentWeek).order("id").range(from, to)
    )
  ]);

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const masjidById = new Map(masajid.map((masjid) => [masjid.id, masjid]));
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const currentStudents = new Set(
    studentMemberships.filter((membership) => currentStudentWindow(membership, today)).map((membership) => membership.student_id)
  );
  const currentStaff = staffMemberships.filter((membership) => currentWindow(membership, today));
  const currentStaffProfiles = new Set(currentStaff.map((membership) => membership.profile_id));
  const currentTeachers = new Set(
    currentStaff.filter((membership) => membership.staff_role === "teacher").map((membership) => membership.profile_id)
  );
  const currentAdminsByMasjid = new Set(
    currentStaff.filter((membership) => membership.staff_role === "admin").map((membership) => membership.masjid_id)
  );
  const issues: RepairIssue[] = [];

  for (const profile of profiles) {
    if (profile.active && profile.role === "student" && !currentStudents.has(profile.id)) {
      issues.push({
        id: `student-without-group:${profile.id}`,
        kind: "student_without_group",
        severity: "high",
        title: `${profile.name} has no current student placement`,
        description: "The account is active and routed as a student, but no effective group membership grants student access today.",
        scope: profile.email,
        href: `/super-admin/people/${profile.id}/access`,
        actionLabel: "Assign placement"
      });
    }

    if (profile.active && profile.role === "teacher" && !currentTeachers.has(profile.id)) {
      issues.push({
        id: `teacher-without-staff:${profile.id}`,
        kind: "teacher_without_staff",
        severity: "high",
        title: `${profile.name} has no current teacher capability`,
        description: "The profile is routed as a teacher, but no effective teacher staff membership exists at a masjid.",
        scope: profile.email,
        href: `/super-admin/people/${profile.id}/access`,
        actionLabel: "Add teacher access"
      });
    }

    const openStudentCount = studentMemberships.filter((membership) => membership.student_id === profile.id && membership.ends_on === null).length;
    const openStaffCount = staffMemberships.filter((membership) => membership.profile_id === profile.id && membership.active && membership.ends_on === null).length;

    if (!profile.active && openStudentCount + openStaffCount > 0) {
      issues.push({
        id: `inactive-open-access:${profile.id}`,
        kind: "inactive_with_open_access",
        severity: "medium",
        title: `${profile.name} is inactive with open access history`,
        description: `${openStudentCount + openStaffCount} membership row${openStudentCount + openStaffCount === 1 ? " remains" : "s remain"} open-ended and should be reviewed.`,
        scope: profile.email,
        href: `/super-admin/people/${profile.id}`,
        actionLabel: "Review account"
      });
    }

    if (
      profile.active &&
      profile.role !== "super_admin" &&
      !currentStudents.has(profile.id) &&
      !currentStaffProfiles.has(profile.id)
    ) {
      issues.push({
        id: `active-without-access:${profile.id}`,
        kind: "active_without_access",
        severity: "medium",
        title: `${profile.name} is active without effective access`,
        description: "The person can have an active login but has no current student or staff scope.",
        scope: profile.email,
        href: `/super-admin/people/${profile.id}/access`,
        actionLabel: "Choose access"
      });
    }
  }

  for (const masjid of masajid) {
    if (masjid.active && !currentAdminsByMasjid.has(masjid.id)) {
      issues.push({
        id: `masjid-without-admin:${masjid.id}`,
        kind: "masjid_without_admin",
        severity: "high",
        title: `${masjid.name} has no current admin coverage`,
        description: "This active masjid has no effective admin membership today.",
        scope: "Masjid readiness",
        href: `/super-admin/masajid/${masjid.id}#staff`,
        actionLabel: "Review staff access"
      });
    }
  }

  for (const assignment of assignments) {
    const group = groupById.get(assignment.group_id);
    const cohort = group ? cohortById.get(group.cohort_id) : null;
    const masjid = cohort ? masjidById.get(cohort.masjid_id) : null;
    const hasTeacherCapability = Boolean(
      masjid && staffMemberships.some((membership) =>
        membership.profile_id === assignment.teacher_id &&
        membership.masjid_id === masjid.id &&
        membership.staff_role === "teacher" &&
        coversDate(membership, assignment.week_start)
      )
    );

    if (!hasTeacherCapability) {
      const teacher = profileById.get(assignment.teacher_id);
      issues.push({
        id: `assignment-without-access:${assignment.id}`,
        kind: "assignment_without_teacher_access",
        severity: "high",
        title: `${teacher?.name ?? "Unknown teacher"} lacks access for an assignment`,
        description: `The ${assignment.week_start} assignment to ${group?.name ?? "an unknown group"} has no matching teacher capability at ${masjid?.name ?? "its masjid"}.`,
        scope: masjid?.name ?? "Unknown masjid",
        href: teacher ? `/super-admin/people/${teacher.id}/access` : null,
        actionLabel: teacher ? "Review teacher access" : null
      });
    }
  }

  const authUserIds = new Set<string>();
  const authUsers: Array<{ id: string; email?: string | null }> = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error("Unable to scan authentication accounts.");
    authUsers.push(...data.users);
    data.users.forEach((user) => authUserIds.add(user.id));
    if (data.users.length < PAGE_SIZE) break;
  }

  for (const profile of profiles) {
    if (!authUserIds.has(profile.id)) {
      issues.push({
        id: `profile-without-auth:${profile.id}`,
        kind: "profile_without_auth",
        severity: "high",
        title: `${profile.name} has no matching login identity`,
        description: "A profile row exists, but the same identifier is missing from Supabase Auth.",
        scope: profile.email,
        href: `/super-admin/people/${profile.id}`,
        actionLabel: "Inspect profile"
      });
    }
  }

  for (const user of authUsers) {
    if (!profileById.has(user.id)) {
      issues.push({
        id: `auth-without-profile:${user.id}`,
        kind: "auth_without_profile",
        severity: "high",
        title: "Login identity has no profile",
        description: "A Supabase Auth user exists without the application profile required for authorization.",
        scope: user.email ?? user.id,
        href: null,
        actionLabel: null
      });
    }
  }

  return issues.sort((left, right) => {
    const severity = left.severity === right.severity ? 0 : left.severity === "high" ? -1 : 1;
    return severity || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
}
