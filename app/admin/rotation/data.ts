import "server-only";
import { addDays, formatWeekRange, isValidDateString, todayDateString, weekStartForDate } from "@/lib/dates";
import { loadAdminCreateUserScopeOptions } from "@/lib/admin-scope";
import {
  buildRotationContexts,
  resolveRotationContext,
  rotationPath,
  type RotationContext
} from "@/lib/rotation-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildCohortGroupRebalancePreview,
  buildTeacherRotationPersistencePlan,
  type CohortGroupRebalancePreview,
  type CurrentStudentGroupMembership,
  type PriorTeacherAssignment,
  type RotationGroup,
  type RotationStudent,
  type RotationTeacher,
  type TeacherRotationPersistencePlan
} from "@/lib/teacher-rotation";
import type { HalaqaGroup, Profile } from "@/lib/types";

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export type RotationSearchParams = {
  masjid?: string;
  cohort?: string;
  week?: string;
  status?: string;
};

export type { RotationContext } from "@/lib/rotation-scope";

export type RotationSettings = {
  id: string;
  target_group_count: number;
};

export type RotationStudentRow = RotationStudent & {
  name: string;
  created_at: string | null;
  group_id: string;
  group_name: string;
};

export type RotationTeacherRow = RotationTeacher & {
  name: string;
  created_at: string | null;
  sort_order: number;
  email: string;
};

export type RotationGroupRow = RotationGroup & {
  student_count: number;
};

export type RotationAssignmentRow = {
  group_id: string;
  group_name: string;
  teacher_id: string | null;
  teacher_name: string | null;
  active: boolean;
};

export type RotationPageData = {
  context: RotationContext | null;
  contexts: RotationContext[];
  canonicalPath: string | null;
  selectedWeekStart: string;
  selectedWeekLabel: string;
  settings: RotationSettings | null;
  groups: RotationGroupRow[];
  students: RotationStudentRow[];
  teachers: RotationTeacherRow[];
  assignments: RotationAssignmentRow[];
  rebalancePreview: CohortGroupRebalancePreview | null;
  persistencePlan: TeacherRotationPersistencePlan | null;
  setupIssues: string[];
};

type TeacherProfile = Pick<Profile, "id" | "name" | "email" | "created_at">;
export const ROTATION_STATUS_MESSAGES: Record<string, { text: string; className: string }> = {
  "settings-saved": {
    text: "Rotation settings saved.",
    className: "bg-green-50 text-green-800"
  },
  "availability-saved": {
    text: "Teacher availability saved.",
    className: "bg-green-50 text-green-800"
  },
  generated: {
    text: "Teacher assignments published.",
    className: "bg-green-50 text-green-800"
  },
  rebalanced: {
    text: "Student groups rebalanced.",
    className: "bg-green-50 text-green-800"
  },
  "rebalance-confirmation-required": {
    text: "Confirm the student group changes before applying the rebalance.",
    className: "bg-red-50 text-red-700"
  },
  "rebalance-error": {
    text: "Unable to rebalance student groups.",
    className: "bg-red-50 text-red-700"
  },
  invalid: {
    text: "Use a valid Sunday week and positive group count.",
    className: "bg-red-50 text-red-700"
  },
  unauthorized: {
    text: "You do not have access to manage this rotation.",
    className: "bg-red-50 text-red-700"
  },
  "setup-incomplete": {
    text: "Rotation setup is incomplete.",
    className: "bg-amber-50 text-amber-800"
  },
  "save-error": {
    text: "Unable to save rotation data.",
    className: "bg-red-50 text-red-700"
  },
  "target-below-active-groups": {
    text: "Target group count cannot be lower than the current active group count.",
    className: "bg-red-50 text-red-700"
  },
  "generate-error": {
    text: "Unable to generate rotation.",
    className: "bg-red-50 text-red-700"
  }
};

export function defaultRotationWeekStart(today = todayDateString()) {
  return addDays(weekStartForDate(today), 7);
}

export function validRotationWeekStart(value: string | undefined, fallback = defaultRotationWeekStart()) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

export function rotationRedirectPath(context: RotationContext, weekStart: string, status: string) {
  return rotationPath({
    masjidId: context.masjid.id,
    cohortId: context.cohort.id,
    weekStart,
    status
  });
}

export async function loadRotationSettings(
  adminSupabase: AdminSupabaseClient,
  context: RotationContext
): Promise<RotationSettings | null> {
  const { data } = await adminSupabase
    .from("cohort_rotation_settings")
    .select("id,target_group_count")
    .eq("masjid_id", context.masjid.id)
    .eq("cohort_id", context.cohort.id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RotationSettings>();

  return data ?? null;
}

export async function loadActiveRotationGroups(
  adminSupabase: AdminSupabaseClient,
  cohortId: string
): Promise<HalaqaGroup[]> {
  const { data, error } = await adminSupabase
    .from("halaqa_groups")
    .select("id,cohort_id,name,active,sort_order,created_at,updated_at")
    .eq("cohort_id", cohortId)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<HalaqaGroup[]>();

  if (error) {
    throw new Error("Unable to load rotation groups.");
  }

  return data ?? [];
}

async function loadCurrentMembershipsForGroups(input: {
  adminSupabase: AdminSupabaseClient;
  groupIds: string[];
  weekStart: string;
}) {
  if (input.groupIds.length === 0) {
    return [];
  }

  const { data, error } = await input.adminSupabase
    .from("student_group_memberships")
    .select("id,student_id,group_id,starts_on,ends_on")
    .in("group_id", input.groupIds)
    .lte("starts_on", input.weekStart)
    .or(`ends_on.is.null,ends_on.gte.${input.weekStart}`)
    .returns<CurrentStudentGroupMembership[]>();

  if (error) {
    throw new Error("Unable to load student group memberships.");
  }

  return data ?? [];
}

async function loadActiveStudentProfiles(adminSupabase: AdminSupabaseClient, studentIds: string[]) {
  if (studentIds.length === 0) {
    return [];
  }

  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .in("id", studentIds)
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Profile[]>();

  if (error) {
    throw new Error("Unable to load rotation students.");
  }

  return data ?? [];
}

export async function loadRotationStudents(input: {
  adminSupabase: AdminSupabaseClient;
  groups: HalaqaGroup[];
  weekStart: string;
}) {
  const groupIds = input.groups.map((group) => group.id);
  const memberships = await loadCurrentMembershipsForGroups({
    adminSupabase: input.adminSupabase,
    groupIds,
    weekStart: input.weekStart
  });
  const profiles = await loadActiveStudentProfiles(
    input.adminSupabase,
    [...new Set(memberships.map((membership) => membership.student_id))]
  );
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const groupById = new Map(input.groups.map((group) => [group.id, group]));

  return {
    memberships: memberships.filter((membership) => profileById.has(membership.student_id)),
    students: memberships
      .map((membership) => {
        const profile = profileById.get(membership.student_id);
        const group = groupById.get(membership.group_id);

        if (!profile || !group) {
          return null;
        }

        return {
          id: profile.id,
          name: profile.name,
          created_at: profile.created_at ?? null,
          group_id: group.id,
          group_name: group.name
        };
      })
      .filter((student): student is RotationStudentRow => student !== null)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  };
}

export async function loadActiveRotationTeachers(input: {
  adminSupabase: AdminSupabaseClient;
  context: RotationContext;
  weekStart: string;
}): Promise<RotationTeacherRow[]> {
  const { data: staffRows, error: staffError } = await input.adminSupabase
    .from("masjid_staff_memberships")
    .select("profile_id,starts_on")
    .eq("masjid_id", input.context.masjid.id)
    .eq("staff_role", "teacher")
    .eq("active", true)
    .lte("starts_on", input.weekStart)
    .or(`ends_on.is.null,ends_on.gte.${input.weekStart}`)
    .order("starts_on", { ascending: true })
    .returns<Array<{ profile_id: string; starts_on: string }>>();

  if (staffError) {
    throw new Error("Unable to load teacher staff memberships.");
  }

  const orderedTeacherIds = [...new Set((staffRows ?? []).map((row) => row.profile_id))];

  if (orderedTeacherIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await input.adminSupabase
    .from("profiles")
    .select("id,name,email,created_at")
    .in("id", orderedTeacherIds)
    .in("role", ["teacher", "admin", "super_admin"])
    .eq("active", true)
    .returns<TeacherProfile[]>();

  if (profileError) {
    throw new Error("Unable to load teachers.");
  }

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const { data: availabilityRows, error: availabilityError } = await input.adminSupabase
    .from("teacher_rotation_availability")
    .select("teacher_id,available")
    .eq("masjid_id", input.context.masjid.id)
    .eq("cohort_id", input.context.cohort.id)
    .eq("week_start", input.weekStart)
    .returns<Array<{ teacher_id: string; available: boolean }>>();

  if (availabilityError) {
    throw new Error("Unable to load teacher availability.");
  }

  const availabilityByTeacherId = new Map((availabilityRows ?? []).map((row) => [row.teacher_id, row.available]));

  return orderedTeacherIds
    .map((teacherId, index) => {
      const profile = profileById.get(teacherId);

      if (!profile) {
        return null;
      }

      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        created_at: profile.created_at ?? null,
        sort_order: index + 1,
        available: availabilityByTeacherId.get(profile.id) ?? false
      };
    })
    .filter((teacher): teacher is RotationTeacherRow => teacher !== null);
}

export async function loadPriorTeacherAssignments(input: {
  adminSupabase: AdminSupabaseClient;
  groupIds: string[];
  weekStart: string;
}): Promise<PriorTeacherAssignment[]> {
  if (input.groupIds.length === 0) {
    return [];
  }

  const { data, error } = await input.adminSupabase
    .from("group_teacher_assignments")
    .select("group_id,teacher_id,week_start,active,created_at")
    .in("group_id", input.groupIds)
    .lte("week_start", input.weekStart)
    .order("week_start", { ascending: false })
    .returns<PriorTeacherAssignment[]>();

  if (error) {
    throw new Error("Unable to load teacher assignments.");
  }

  return data ?? [];
}

function buildGroupRows(groups: HalaqaGroup[], memberships: CurrentStudentGroupMembership[]) {
  const studentCountByGroupId = new Map<string, number>();

  for (const membership of memberships) {
    studentCountByGroupId.set(membership.group_id, (studentCountByGroupId.get(membership.group_id) ?? 0) + 1);
  }

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    sort_order: group.sort_order,
    created_at: group.created_at,
    student_count: studentCountByGroupId.get(group.id) ?? 0
  }));
}

function buildAssignmentRows(input: {
  groups: HalaqaGroup[];
  teachers: RotationTeacherRow[];
  priorAssignments: PriorTeacherAssignment[];
  weekStart: string;
}) {
  const teacherById = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
  const activeTargetAssignmentByGroupId = new Map(
    input.priorAssignments
      .filter((assignment) => assignment.week_start === input.weekStart && assignment.active !== false)
      .map((assignment) => [assignment.group_id, assignment])
  );

  return input.groups.map((group) => {
    const assignment = activeTargetAssignmentByGroupId.get(group.id);
    const teacher = assignment ? teacherById.get(assignment.teacher_id) : null;

    return {
      group_id: group.id,
      group_name: group.name,
      teacher_id: assignment?.teacher_id ?? null,
      teacher_name: teacher?.name ?? null,
      active: Boolean(assignment && teacher)
    };
  });
}

export async function loadRotationPageData(input: {
  profile: Pick<Profile, "id" | "role">;
  searchParams: RotationSearchParams;
}): Promise<RotationPageData> {
  const selectedWeekStart = validRotationWeekStart(input.searchParams.week);
  const adminSupabase = createSupabaseAdminClient();
  const scopeOptions = await loadAdminCreateUserScopeOptions({
    adminSupabase,
    admin: input.profile
  });
  const contexts = buildRotationContexts(scopeOptions);
  const resolution = resolveRotationContext(contexts, {
    masjidId: input.searchParams.masjid,
    cohortId: input.searchParams.cohort
  });
  const context = resolution.context;

  if (!context) {
    return {
      context: null,
      contexts,
      canonicalPath: null,
      selectedWeekStart,
      selectedWeekLabel: formatWeekRange(selectedWeekStart),
      settings: null,
      groups: [],
      students: [],
      teachers: [],
      assignments: [],
      rebalancePreview: null,
      persistencePlan: null,
      setupIssues: [
        resolution.error === "invalid-selection"
          ? "The selected masjid and cohort are not available for this admin."
          : "No active rotation cohort is available for this admin."
      ]
    };
  }

  const canonicalPath =
    resolution.usedDefault || input.searchParams.week !== selectedWeekStart
      ? rotationPath({
          masjidId: context.masjid.id,
          cohortId: context.cohort.id,
          weekStart: selectedWeekStart,
          status: input.searchParams.status
        })
      : null;
  const [settings, groups, teachers] = await Promise.all([
    loadRotationSettings(adminSupabase, context),
    loadActiveRotationGroups(adminSupabase, context.cohort.id),
    loadActiveRotationTeachers({ adminSupabase, context, weekStart: selectedWeekStart })
  ]);
  const groupIds = groups.map((group) => group.id);
  const [studentData, priorAssignments] = await Promise.all([
    loadRotationStudents({ adminSupabase, groups, weekStart: selectedWeekStart }),
    loadPriorTeacherAssignments({ adminSupabase, groupIds, weekStart: selectedWeekStart })
  ]);
  const setupIssues = [
    settings ? null : "Set a target group count before generating.",
    settings && groups.length > settings.target_group_count
      ? "Active group count is above the saved target. Increase the target or manually review groups before generating."
      : null,
    settings && groups.length < settings.target_group_count
      ? "Apply the student rebalance to create the missing target groups before publishing assignments."
      : null,
    groups.length ? null : "No active halaqa groups exist yet.",
    studentData.students.length ? null : "No active students are assigned to this cohort for the selected week.",
    teachers.length ? null : "No active teachers are assigned to this masjid for the selected week."
  ].filter((issue): issue is string => Boolean(issue));
  const persistencePlan =
    groups.length > 0
      ? buildTeacherRotationPersistencePlan({
          groups,
          teachers,
          priorAssignments,
          weekStart: selectedWeekStart
        })
      : null;
  const rebalancePreview = settings
    ? buildCohortGroupRebalancePreview({
        students: studentData.students,
        groups,
        targetGroupCount: settings.target_group_count
      })
    : null;

  return {
    context,
    contexts,
    canonicalPath,
    selectedWeekStart,
    selectedWeekLabel: formatWeekRange(selectedWeekStart),
    settings,
    groups: buildGroupRows(groups, studentData.memberships),
    students: studentData.students,
    teachers,
    assignments: buildAssignmentRows({ groups, teachers, priorAssignments, weekStart: selectedWeekStart }),
    rebalancePreview,
    persistencePlan,
    setupIssues
  };
}
