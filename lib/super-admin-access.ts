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
  studentMembershipCloses: MembershipClosePlan[];
  studentMembershipInsert: StudentMembershipInsertPlan | null;
  staffMembershipCloses: MembershipClosePlan[];
  staffMembershipInserts: StaffMembershipInsertPlan[];
  requiresAdminMasjidConfirmation: boolean;
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
  if (membership.ends_on !== null) {
    return null;
  }

  if (membership.starts_on > endsOn) {
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
  const futureOpenMembership = input.staffMemberships.find(
    (membership) =>
      membership.masjid_id === input.masjidId &&
      membership.staff_role === input.staffRole &&
      membership.active &&
      membership.ends_on === null &&
      membership.starts_on > input.startsOn
  );

  if (futureOpenMembership) {
    throw new SuperAdminAccessPlanError(
      `Choose an effective date on or after ${futureOpenMembership.starts_on} before replacing this staff membership.`
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

function activeAdminStaffExistsAfterPlan(input: {
  staffMemberships: StaffMembershipWindow[];
  staffMembershipCloses: MembershipClosePlan[];
  staffMembershipInserts: StaffMembershipInsertPlan[];
  startsOn: string;
}) {
  if (input.staffMembershipInserts.some((membership) => membership.staffRole === "admin")) {
    return true;
  }

  const closedMembershipIds = new Set(input.staffMembershipCloses.map((membership) => membership.id));

  return input.staffMemberships.some(
    (membership) =>
      membership.staff_role === "admin" &&
      !closedMembershipIds.has(membership.id) &&
      staffMembershipIsActiveOn(membership, input.startsOn)
  );
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
}): SuperAdminAccessChangePlan {
  const endBeforeStart = addDays(input.startsOn, -1);
  const base = {
    nextRole: input.targetRole,
    nextActive: input.targetActive,
    studentMembershipCloses: [],
    studentMembershipInsert: null,
    staffMembershipCloses: [],
    staffMembershipInserts: [],
    requiresAdminMasjidConfirmation: false
  } satisfies SuperAdminAccessChangePlan;

  if (input.preset === "inactive") {
    return {
      ...base,
      nextActive: false,
      studentMembershipCloses: closeOpenMemberships(input.studentMemberships, input.startsOn),
      staffMembershipCloses: closeOpenMemberships(
        input.staffMemberships.filter((membership) => membership.active),
        input.startsOn
      ),
      requiresAdminMasjidConfirmation: input.staffMemberships.some(
        (membership) => membership.active && membership.staff_role === "admin" && membership.ends_on === null
      )
    };
  }

  if (input.preset === "student") {
    if (!input.selectedGroupId) {
      throw new SuperAdminAccessPlanError("Choose an active student group.");
    }

    const existingSelectedMembership = input.studentMemberships.find(
      (membership) =>
        membership.group_id === input.selectedGroupId && membership.ends_on === null && membership.starts_on <= input.startsOn
    );
    const studentMembershipsToClose = input.studentMemberships.filter(
      (membership) => membership.ends_on === null && membership.id !== existingSelectedMembership?.id
    );

    return {
      ...base,
      nextRole: "student",
      nextActive: true,
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
  const nextRole: Role =
    input.preset === "teacher" &&
    !activeAdminStaffExistsAfterPlan({
      staffMemberships: input.staffMemberships,
      staffMembershipCloses,
      staffMembershipInserts,
      startsOn: input.startsOn
    })
      ? "teacher"
      : "admin";

  return {
    ...base,
    nextRole,
    nextActive: true,
    studentMembershipCloses: closeOpenMemberships(input.studentMemberships, endBeforeStart),
    staffMembershipCloses,
    staffMembershipInserts,
    requiresAdminMasjidConfirmation:
      staffMembershipInserts.some((membership) => membership.staffRole === "admin") ||
      staffMembershipCloses.some((close) =>
        input.staffMemberships.some((membership) => membership.id === close.id && membership.staff_role === "admin")
      )
  };
}
