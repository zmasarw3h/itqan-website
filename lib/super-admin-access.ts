import { addDays } from "@/lib/dates";
import type { Role, StaffRole } from "@/lib/types";

export type SuperAdminAccessPreset = "student" | "teacher" | "admin" | "admin_teacher" | "inactive";

const ACCESS_PRESETS = new Set<SuperAdminAccessPreset>([
  "student",
  "teacher",
  "admin",
  "admin_teacher",
  "inactive"
]);

export type StudentMembershipWindow = {
  id: string;
  group_id: string;
  starts_on: string;
  ends_on: string | null;
};

export type StaffMembershipWindow = {
  id: string;
  masjid_id: string;
  masjid_name?: string | null;
  staff_role: StaffRole;
  active: boolean;
  starts_on: string;
  ends_on: string | null;
};

export type MembershipClosePlan = {
  id: string;
  endsOn: string;
  /** A same-day replacement deactivates the row because dates are inclusive. */
  inactive?: boolean;
};

export type StaffMembershipInsertPlan = {
  masjidId: string;
  staffRole: StaffRole;
  startsOn: string;
};

export type StudentMembershipInsertPlan = {
  groupId: string;
  startsOn: string;
};

export type SuperAdminAccessChangePlan = {
  nextRole: Role;
  nextActive: boolean;
  effectiveRole: Role;
  effectiveActive: boolean;
  studentMembershipCloses: MembershipClosePlan[];
  studentMembershipInsert: StudentMembershipInsertPlan | null;
  staffMembershipCloses: MembershipClosePlan[];
  staffMembershipInserts: StaffMembershipInsertPlan[];
  requiresAdminMasjidConfirmation: boolean;
};

export type AdditiveStaffGrant = "admin" | "teacher" | "admin_teacher";

export type AdditiveStaffGrantPreview = {
  currentMasjidAccess: string;
  resultingMasjidAccess: string;
  currentRole: Role;
  currentActive: boolean;
  resultingRole: Role;
  resultingActive: boolean;
  effectiveRole: Role;
  effectiveActive: boolean;
  addedRoles: StaffRole[];
  noOp: boolean;
};

export class SuperAdminAccessPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuperAdminAccessPlanError";
  }
}

export function parseSuperAdminAccessPreset(value: FormDataEntryValue | null): SuperAdminAccessPreset | null {
  return typeof value === "string" && ACCESS_PRESETS.has(value as SuperAdminAccessPreset)
    ? (value as SuperAdminAccessPreset)
    : null;
}

export function displayAccessPreset(preset: SuperAdminAccessPreset) {
  if (preset === "admin_teacher") return "Admin + Teacher";
  return preset.charAt(0).toUpperCase() + preset.slice(1);
}

export function membershipIsActiveOn(
  membership: Pick<StudentMembershipWindow, "starts_on" | "ends_on">,
  date: string
) {
  return membership.starts_on <= date && (!membership.ends_on || membership.ends_on >= date);
}

export function staffMembershipIsActiveOn(
  membership: Pick<StaffMembershipWindow, "active" | "starts_on" | "ends_on">,
  date: string
) {
  return membership.active && membershipIsActiveOn(membership, date);
}

export function staffAccessLabel(input: { hasAdmin: boolean; hasTeacher: boolean }) {
  if (input.hasAdmin && input.hasTeacher) return "Admin + Teacher";
  if (input.hasAdmin) return "Admin only";
  if (input.hasTeacher) return "Teacher only";
  return "No staff access";
}

export function adminMasjidConfirmationText(names: string[]) {
  return [...names].sort((a, b) => a.localeCompare(b)).join(", ");
}

export function adminMasjidConfirmationNamesForPlan(input: {
  staffMemberships: StaffMembershipWindow[];
  staffMembershipCloses: MembershipClosePlan[];
  staffMembershipInserts: StaffMembershipInsertPlan[];
  selectedMasjid?: { id: string; name: string } | null;
}) {
  const names = new Set<string>();
  const selectedMasjidName =
    input.selectedMasjid && input.selectedMasjid.name.trim() ? input.selectedMasjid.name.trim() : null;

  for (const close of input.staffMembershipCloses) {
    const membership = input.staffMemberships.find((row) => row.id === close.id);

    if (membership?.staff_role === "admin") {
      names.add((membership.masjid_name ?? membership.masjid_id).trim());
    }
  }

  for (const insert of input.staffMembershipInserts) {
    if (insert.staffRole !== "admin") {
      continue;
    }

    names.add(
      selectedMasjidName && input.selectedMasjid?.id === insert.masjidId ? selectedMasjidName : insert.masjidId
    );
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function closeOpenMembership(
  membership: Pick<StudentMembershipWindow, "id" | "starts_on" | "ends_on">,
  endsOn: string
): MembershipClosePlan | null {
  if (membership.ends_on !== null && membership.ends_on <= endsOn) {
    return null;
  }

  if (membership.starts_on > endsOn) {
    if (membership.starts_on === addDays(endsOn, 1)) {
      return { id: membership.id, endsOn: membership.starts_on, inactive: true };
    }

    throw new SuperAdminAccessPlanError(
      `Choose an effective date on or after ${membership.starts_on} before replacing this membership.`
    );
  }

  return { id: membership.id, endsOn };
}

function closeOpenMemberships(
  memberships: Array<Pick<StudentMembershipWindow, "id" | "starts_on" | "ends_on">>,
  endsOn: string
) {
  return memberships
    .map((membership) => closeOpenMembership(membership, endsOn))
    .filter((membership): membership is MembershipClosePlan => membership !== null);
}

function activeStaffRoleExists(input: {
  staffMemberships: StaffMembershipWindow[];
  masjidId: string;
  staffRole: StaffRole;
  startsOn: string;
}) {
  return input.staffMemberships.some(
    (membership) =>
      membership.masjid_id === input.masjidId &&
      membership.staff_role === input.staffRole &&
      staffMembershipIsActiveOn(membership, input.startsOn)
  );
}

function assertNoFutureOpenStaffOverlap(input: {
  staffMemberships: StaffMembershipWindow[];
  masjidId: string;
  staffRole: StaffRole;
  startsOn: string;
}) {
  const futureMembership = input.staffMemberships.find(
    (membership) =>
      membership.masjid_id === input.masjidId &&
      membership.staff_role === input.staffRole &&
      membership.active &&
      membership.starts_on > input.startsOn
  );

  if (futureMembership) {
    throw new SuperAdminAccessPlanError(
      `Choose an effective date on or after ${futureMembership.starts_on} before replacing this staff membership.`
    );
  }
}

function staffInsertPlans(input: {
  staffMemberships: StaffMembershipWindow[];
  masjidId: string;
  startsOn: string;
  desiredRoles: StaffRole[];
}) {
  return input.desiredRoles.flatMap((staffRole): StaffMembershipInsertPlan[] => {
    if (
      activeStaffRoleExists({
        staffMemberships: input.staffMemberships,
        masjidId: input.masjidId,
        staffRole,
        startsOn: input.startsOn
      })
    ) {
      return [];
    }

    assertNoFutureOpenStaffOverlap({
      staffMemberships: input.staffMemberships,
      masjidId: input.masjidId,
      staffRole,
      startsOn: input.startsOn
    });

    return [{ masjidId: input.masjidId, staffRole, startsOn: input.startsOn }];
  });
}

function closeOpenStaffByRole(input: {
  staffMemberships: StaffMembershipWindow[];
  masjidId: string;
  staffRoles: StaffRole[];
  endsOn: string;
}) {
  return closeOpenMemberships(
    input.staffMemberships.filter(
      (membership) =>
        membership.masjid_id === input.masjidId &&
        input.staffRoles.includes(membership.staff_role) &&
        membership.active
    ),
    input.endsOn
  );
}

function staffRolesAtDate(
  memberships: StaffMembershipWindow[],
  date: string,
  closes: MembershipClosePlan[] = [],
  inserts: StaffMembershipInsertPlan[] = []
) {
  const closed = new Map(closes.map((membership) => [membership.id, membership]));
  const roles = new Set<StaffRole>();

  for (const membership of memberships) {
    const close = closed.get(membership.id);
    if (close?.inactive || (close && close.endsOn < date)) continue;

    if (staffMembershipIsActiveOn(membership, date)) {
      roles.add(membership.staff_role);
    }
  }

  for (const membership of inserts) {
    if (membership.startsOn <= date) {
      roles.add(membership.staffRole);
    }
  }

  return roles;
}

function projectAccessAtDate(input: {
  targetRole: Role;
  targetActive: boolean;
  date: string;
  preset: SuperAdminAccessPreset;
  startsOn: string;
  studentMemberships: StudentMembershipWindow[];
  staffMemberships: StaffMembershipWindow[];
  plan: Pick<SuperAdminAccessChangePlan, "studentMembershipCloses" | "studentMembershipInsert" | "staffMembershipCloses" | "staffMembershipInserts">;
}) {
  if (input.targetRole === "super_admin") {
    return { role: "super_admin" as Role, active: input.targetActive };
  }

  if (input.preset === "inactive" && input.date >= input.startsOn) {
    return { role: input.targetRole, active: false };
  }

  const staffRoles = staffRolesAtDate(
    input.staffMemberships,
    input.date,
    input.plan.staffMembershipCloses,
    input.plan.staffMembershipInserts
  );

  if (staffRoles.has("admin")) return { role: "admin" as Role, active: true };
  if (staffRoles.has("teacher")) return { role: "teacher" as Role, active: true };

  const closedStudents = new Map(input.plan.studentMembershipCloses.map((membership) => [membership.id, membership]));
  const hasStudent = input.studentMemberships.some((membership) => {
    const close = closedStudents.get(membership.id);
    return !close?.inactive && membershipIsActiveOn(membership, input.date) && (!close || close.endsOn >= input.date);
  }) || Boolean(
    input.plan.studentMembershipInsert && input.plan.studentMembershipInsert.startsOn <= input.date
  );

  if (hasStudent) return { role: "student" as Role, active: true };
  return { role: input.targetRole, active: false };
}

function grantRoles(grant: AdditiveStaffGrant): StaffRole[] {
  return grant === "admin_teacher" ? ["admin", "teacher"] : [grant];
}

export function previewAdditiveStaffGrant(input: {
  targetRole: Role;
  targetActive: boolean;
  masjidId: string;
  grant: AdditiveStaffGrant;
  startsOn: string;
  currentDate: string;
  staffMemberships: StaffMembershipWindow[];
  studentMemberships?: StudentMembershipWindow[];
}): AdditiveStaffGrantPreview {
  const desiredRoles = grantRoles(input.grant);
  const currentMasjidRoles = [...staffRolesAtDate(
    input.staffMemberships.filter((membership) => membership.masjid_id === input.masjidId),
    input.currentDate
  )];
  const rolesAtStart = staffRolesAtDate(
    input.staffMemberships.filter((membership) => membership.masjid_id === input.masjidId),
    input.startsOn
  );
  const inserted = staffInsertPlans({
    staffMemberships: input.staffMemberships,
    masjidId: input.masjidId,
    startsOn: input.startsOn,
    desiredRoles
  });
  const addedRoles = inserted.map((membership) => membership.staffRole);
  const resultingMasjidRoles = new Set(rolesAtStart);
  for (const staffRole of addedRoles) resultingMasjidRoles.add(staffRole);
  const currentProjection = projectAccessAtDate({
    targetRole: input.targetRole,
    targetActive: input.targetActive,
    date: input.currentDate,
    preset: "admin_teacher",
    startsOn: input.startsOn,
    studentMemberships: input.studentMemberships ?? [],
    staffMemberships: input.staffMemberships,
    plan: { studentMembershipCloses: [], studentMembershipInsert: null, staffMembershipCloses: [], staffMembershipInserts: [] }
  });
  const effectiveProjection = projectAccessAtDate({
    targetRole: input.targetRole,
    targetActive: input.targetActive,
    date: input.startsOn,
    preset: "admin_teacher",
    startsOn: input.startsOn,
    studentMemberships: input.studentMemberships ?? [],
    staffMemberships: input.staffMemberships,
    plan: { studentMembershipCloses: [], studentMembershipInsert: null, staffMembershipCloses: [], staffMembershipInserts: inserted }
  });

  const resultingCurrentProjection = projectAccessAtDate({
    targetRole: input.targetRole,
    targetActive: input.targetActive,
    date: input.currentDate,
    preset: "admin_teacher",
    startsOn: input.startsOn,
    studentMemberships: input.studentMemberships ?? [],
    staffMemberships: input.staffMemberships,
    plan: { studentMembershipCloses: [], studentMembershipInsert: null, staffMembershipCloses: [], staffMembershipInserts: inserted }
  });

  return {
    currentMasjidAccess: staffAccessLabel({ hasAdmin: currentMasjidRoles.includes("admin"), hasTeacher: currentMasjidRoles.includes("teacher") }),
    resultingMasjidAccess: staffAccessLabel({ hasAdmin: resultingMasjidRoles.has("admin"), hasTeacher: resultingMasjidRoles.has("teacher") }),
    currentRole: currentProjection.role,
    currentActive: currentProjection.active,
    resultingRole: resultingCurrentProjection.role,
    resultingActive: resultingCurrentProjection.active,
    effectiveRole: effectiveProjection.role,
    effectiveActive: effectiveProjection.active,
    addedRoles,
    noOp: addedRoles.length === 0
  };
}

function selectedMasjidIdOrThrow(selectedMasjidId: string | null | undefined) {
  if (!selectedMasjidId) {
    throw new SuperAdminAccessPlanError("Choose an active masjid.");
  }

  return selectedMasjidId;
}

export function buildSuperAdminAccessChangePlan(input: {
  targetRole: Role;
  targetActive: boolean;
  preset: SuperAdminAccessPreset;
  startsOn: string;
  selectedMasjidId?: string | null;
  selectedGroupId?: string | null;
  studentMemberships: StudentMembershipWindow[];
  staffMemberships: StaffMembershipWindow[];
  currentDate?: string;
}): SuperAdminAccessChangePlan {
  const endBeforeStart = addDays(input.startsOn, -1);
  const currentDate = input.currentDate ?? input.startsOn;
  const base = {
    nextRole: input.targetRole,
    nextActive: input.targetActive,
    effectiveRole: input.targetRole,
    effectiveActive: input.targetActive,
    studentMembershipCloses: [],
    studentMembershipInsert: null,
    staffMembershipCloses: [],
    staffMembershipInserts: [],
    requiresAdminMasjidConfirmation: false
  } satisfies SuperAdminAccessChangePlan;

  if (input.preset === "inactive") {
    const plan = {
      ...base,
      nextActive: false,
      studentMembershipCloses: closeOpenMemberships(input.studentMemberships, endBeforeStart),
      staffMembershipCloses: closeOpenMemberships(
        input.staffMemberships.filter((membership) => membership.active),
        endBeforeStart
      ),
      requiresAdminMasjidConfirmation: input.staffMemberships.some(
        (membership) => membership.active && membership.staff_role === "admin" && membership.ends_on === null
      )
    };
    const currentProjection = projectAccessAtDate({ ...input, date: currentDate, plan });
    const effectiveProjection = projectAccessAtDate({ ...input, date: input.startsOn, plan });
    return { ...plan, nextRole: currentProjection.role, nextActive: currentProjection.active, effectiveRole: effectiveProjection.role, effectiveActive: effectiveProjection.active };
  }

  if (input.preset === "student") {
    if (!input.selectedGroupId) {
      throw new SuperAdminAccessPlanError("Choose an active student group.");
    }

    const existingSelectedMembership = input.studentMemberships.find(
      (membership) =>
        membership.group_id === input.selectedGroupId && membershipIsActiveOn(membership, input.startsOn)
    );
    const studentMembershipsToClose = input.studentMemberships.filter(
      (membership) =>
        (membership.ends_on === null || membership.ends_on > endBeforeStart) &&
        membership.id !== existingSelectedMembership?.id
    );

    const plan = {
      ...base,
      studentMembershipCloses: closeOpenMemberships(studentMembershipsToClose, endBeforeStart),
      studentMembershipInsert: existingSelectedMembership
        ? null
        : { groupId: input.selectedGroupId, startsOn: input.startsOn },
      staffMembershipCloses: closeOpenMemberships(
        input.staffMemberships.filter((membership) => membership.active),
        endBeforeStart
      ),
      requiresAdminMasjidConfirmation: input.staffMemberships.some(
        (membership) => membership.active && membership.staff_role === "admin" && membership.ends_on === null
      )
    };
    const currentProjection = projectAccessAtDate({ ...input, date: currentDate, plan });
    const effectiveProjection = projectAccessAtDate({ ...input, date: input.startsOn, plan });
    return { ...plan, nextRole: currentProjection.role, nextActive: currentProjection.active, effectiveRole: effectiveProjection.role, effectiveActive: effectiveProjection.active };
  }

  const masjidId = selectedMasjidIdOrThrow(input.selectedMasjidId);
  const desiredRoles: StaffRole[] =
    input.preset === "admin_teacher" ? ["admin", "teacher"] : input.preset === "admin" ? ["admin"] : ["teacher"];
  const undesiredRoles: StaffRole[] =
    input.preset === "admin_teacher" ? [] : input.preset === "admin" ? ["teacher"] : ["admin"];
  const staffMembershipInserts = staffInsertPlans({
    staffMemberships: input.staffMemberships,
    masjidId,
    startsOn: input.startsOn,
    desiredRoles
  });
  const staffMembershipCloses = closeOpenStaffByRole({
    staffMemberships: input.staffMemberships,
    masjidId,
    staffRoles: undesiredRoles,
    endsOn: endBeforeStart
  });
  const plan = {
    ...base,
    staffMembershipCloses,
    staffMembershipInserts,
    requiresAdminMasjidConfirmation:
      staffMembershipInserts.some((membership) => membership.staffRole === "admin") ||
      staffMembershipCloses.some((close) =>
        input.staffMemberships.some((membership) => membership.id === close.id && membership.staff_role === "admin")
      )
  };
  const currentProjection = projectAccessAtDate({ ...input, date: currentDate, plan });
  const effectiveProjection = projectAccessAtDate({ ...input, date: input.startsOn, plan });
  return { ...plan, nextRole: currentProjection.role, nextActive: currentProjection.active, effectiveRole: effectiveProjection.role, effectiveActive: effectiveProjection.active };
}
