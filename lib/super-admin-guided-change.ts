import { friendlyDate, weekStartForDate } from "@/lib/dates";
import {
  adminMasjidConfirmationNamesForPlan,
  adminMasjidConfirmationText,
  buildSuperAdminAccessChangePlan,
  staffAccessLabel,
  staffMembershipIsActiveOn,
  SuperAdminAccessPlanError,
  type StaffMembershipWindow,
  type StudentMembershipWindow,
  type SuperAdminAccessChangePlan,
  type SuperAdminAccessPreset
} from "@/lib/super-admin-access";
import type { Role, StaffRole } from "@/lib/types";

export type GuidedAccessOperation =
  | "add_teacher"
  | "add_admin"
  | "add_admin_teacher"
  | "assign_student"
  | "deactivate_account";

const GUIDED_OPERATIONS = new Set<GuidedAccessOperation>([
  "add_teacher",
  "add_admin",
  "add_admin_teacher",
  "assign_student",
  "deactivate_account"
]);

export type GuidedStudentMembership = StudentMembershipWindow & {
  group_name: string;
  cohort_name: string;
  masjid_id: string;
  masjid_name: string;
};

export type GuidedStaffMembership = StaffMembershipWindow & {
  masjid_name: string;
};

export type GuidedTeacherAssignment = {
  id: string;
  week_start: string;
  group_name: string;
  cohort_name: string;
  masjid_id: string;
  masjid_name: string;
};

export type GuidedMasjidOption = {
  id: string;
  name: string;
};

export type GuidedGroupOption = {
  id: string;
  name: string;
  cohort_name: string;
  masjid_id: string;
  masjid_name: string;
};

export type GuidedAccessSnapshot = {
  profile: {
    id: string;
    name: string;
    role: Role;
    active: boolean;
  };
  studentMemberships: GuidedStudentMembership[];
  staffMemberships: GuidedStaffMembership[];
  teacherAssignments: GuidedTeacherAssignment[];
  masjids: GuidedMasjidOption[];
  groups: GuidedGroupOption[];
};

export type GuidedChangeDraft = {
  operation: GuidedAccessOperation;
  startsOn: string;
  masjidId?: string | null;
  groupId?: string | null;
};

export type GuidedChangeRow = {
  id: string;
  label: string;
  current: string;
  after: string;
  detail?: string;
};

export type GuidedChangeReview = {
  operation: GuidedAccessOperation;
  operationLabel: string;
  title: string;
  scopeLabel: string;
  dateLabel: string;
  timingLabel: string;
  preset: SuperAdminAccessPreset | null;
  plan: SuperAdminAccessChangePlan | null;
  rows: GuidedChangeRow[];
  unchanged: string[];
  warnings: string[];
  blockers: string[];
  personConfirmation: string;
  adminMasjidConfirmation: string | null;
  submitLabel: string;
};

export function parseGuidedAccessOperation(value: FormDataEntryValue | null): GuidedAccessOperation | null {
  return typeof value === "string" && GUIDED_OPERATIONS.has(value as GuidedAccessOperation)
    ? (value as GuidedAccessOperation)
    : null;
}

function activeStaffRolesAt(
  memberships: GuidedStaffMembership[],
  masjidId: string,
  date: string
): StaffRole[] {
  return memberships
    .filter(
      (membership) =>
        membership.masjid_id === masjidId && staffMembershipIsActiveOn(membership, date)
    )
    .map((membership) => membership.staff_role);
}

function hasOpenStaffRole(
  memberships: GuidedStaffMembership[],
  masjidId: string,
  role: StaffRole
) {
  return memberships.some(
    (membership) =>
      membership.masjid_id === masjidId &&
      membership.staff_role === role &&
      membership.active &&
      membership.ends_on === null
  );
}

export function presetForGuidedOperation(input: {
  operation: GuidedAccessOperation;
  masjidId?: string | null;
  staffMemberships: GuidedStaffMembership[];
}): SuperAdminAccessPreset {
  if (input.operation === "assign_student") return "student";
  if (input.operation === "deactivate_account") return "inactive";
  if (input.operation === "add_admin_teacher") return "admin_teacher";

  if (!input.masjidId) {
    throw new SuperAdminAccessPlanError("Choose an active masjid.");
  }

  if (input.operation === "add_teacher") {
    return hasOpenStaffRole(input.staffMemberships, input.masjidId, "admin")
      ? "admin_teacher"
      : "teacher";
  }

  return hasOpenStaffRole(input.staffMemberships, input.masjidId, "teacher")
    ? "admin_teacher"
    : "admin";
}

function roleLabel(role: Role) {
  if (role === "super_admin") return "Super admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function accessLabelForRoles(roles: StaffRole[]) {
  return staffAccessLabel({
    hasAdmin: roles.includes("admin"),
    hasTeacher: roles.includes("teacher")
  });
}

function resultingStaffRoles(input: {
  masjidId: string;
  startsOn: string;
  memberships: GuidedStaffMembership[];
  plan: SuperAdminAccessChangePlan;
}) {
  const closed = new Set(input.plan.staffMembershipCloses.map((membership) => membership.id));
  const roles = new Set<StaffRole>(
    input.memberships
      .filter(
        (membership) =>
          membership.masjid_id === input.masjidId &&
          !closed.has(membership.id) &&
          staffMembershipIsActiveOn(membership, input.startsOn)
      )
      .map((membership) => membership.staff_role)
  );

  for (const membership of input.plan.staffMembershipInserts) {
    if (membership.masjidId === input.masjidId) {
      roles.add(membership.staffRole);
    }
  }

  return [...roles];
}

function membershipDescription(membership: GuidedStudentMembership) {
  return `${membership.group_name} · ${membership.cohort_name} · ${membership.masjid_name}`;
}

function selectedStudentMembershipAt(snapshot: GuidedAccessSnapshot, date: string) {
  return snapshot.studentMemberships.find(
    (membership) =>
      membership.starts_on <= date && (!membership.ends_on || membership.ends_on >= date)
  );
}

function operationLabel(snapshot: GuidedAccessSnapshot, operation: GuidedAccessOperation, date: string) {
  const hasStudent = Boolean(selectedStudentMembershipAt(snapshot, date));
  const hasStaff = snapshot.staffMemberships.some((membership) =>
    staffMembershipIsActiveOn(membership, date)
  );

  if (!snapshot.profile.active) {
    if (operation === "add_teacher") return "Reactivate with teacher access";
    if (operation === "add_admin") return "Reactivate with admin access";
    if (operation === "add_admin_teacher") return "Reactivate with admin + teacher access";
    if (operation === "assign_student") return "Reactivate with student placement";
  }

  if (operation === "add_teacher") {
    return hasStudent ? "Convert student to teacher access" : "Add teacher access";
  }

  if (operation === "add_admin") {
    return hasStudent ? "Convert student to admin access" : "Add admin access";
  }

  if (operation === "add_admin_teacher") {
    return hasStudent ? "Convert student to admin + teacher" : "Add admin + teacher access";
  }

  if (operation === "assign_student") {
    return hasStaff ? "Convert staff account to student" : hasStudent ? "Move student placement" : "Assign student placement";
  }

  return "Deactivate account";
}

export function operationLabelForSnapshot(
  snapshot: GuidedAccessSnapshot,
  operation: GuidedAccessOperation,
  date: string
) {
  return operationLabel(snapshot, operation, date);
}

function addPlanRows(input: {
  snapshot: GuidedAccessSnapshot;
  draft: GuidedChangeDraft;
  plan: SuperAdminAccessChangePlan;
  selectedMasjid: GuidedMasjidOption | null;
  selectedGroup: GuidedGroupOption | null;
}) {
  const rows: GuidedChangeRow[] = [];
  const { snapshot, draft, plan } = input;

  if (snapshot.profile.role !== plan.nextRole || snapshot.profile.active !== plan.nextActive) {
    rows.push({
      id: "profile",
      label: "Account",
      current: `${roleLabel(snapshot.profile.role)} · ${snapshot.profile.active ? "Active" : "Inactive"}`,
      after: `${roleLabel(plan.nextRole)} · ${plan.nextActive ? "Active" : "Inactive"}`
    });
  }

  if (draft.operation === "assign_student" && input.selectedGroup) {
    const current = selectedStudentMembershipAt(snapshot, draft.startsOn);
    rows.push({
      id: "student-placement",
      label: "Student placement",
      current: current ? membershipDescription(current) : "No student placement",
      after: `${input.selectedGroup.name} · ${input.selectedGroup.cohort_name} · ${input.selectedGroup.masjid_name}`,
      detail: `Starts ${friendlyDate(draft.startsOn)}`
    });
  }

  if (input.selectedMasjid && draft.operation.startsWith("add_")) {
    const currentRoles = activeStaffRolesAt(snapshot.staffMemberships, input.selectedMasjid.id, draft.startsOn);
    const nextRoles = resultingStaffRoles({
      masjidId: input.selectedMasjid.id,
      startsOn: draft.startsOn,
      memberships: snapshot.staffMemberships,
      plan
    });
    rows.push({
      id: `staff-${input.selectedMasjid.id}`,
      label: input.selectedMasjid.name,
      current: accessLabelForRoles(currentRoles),
      after: accessLabelForRoles(nextRoles),
      detail: `Starts ${friendlyDate(draft.startsOn)}`
    });
  }

  for (const close of plan.studentMembershipCloses) {
    const membership = snapshot.studentMemberships.find((row) => row.id === close.id);

    if (membership && !rows.some((row) => row.id === "student-placement")) {
      rows.push({
        id: `student-close-${close.id}`,
        label: "Student placement",
        current: membershipDescription(membership),
        after: `Ends ${friendlyDate(close.endsOn)}`
      });
    }
  }

  for (const close of plan.staffMembershipCloses) {
    const membership = snapshot.staffMemberships.find((row) => row.id === close.id);

    if (!membership) continue;
    rows.push({
      id: `staff-close-${close.id}`,
      label: `${membership.masjid_name} · ${membership.staff_role === "admin" ? "Admin" : "Teacher"}`,
      current: "Active",
      after: `Ends ${friendlyDate(close.endsOn)}`
    });
  }

  return rows;
}

function unchangedImpact(input: {
  snapshot: GuidedAccessSnapshot;
  draft: GuidedChangeDraft;
  plan: SuperAdminAccessChangePlan;
  selectedMasjidId: string | null;
}) {
  const unchanged: string[] = [];
  const closedStaffIds = new Set(input.plan.staffMembershipCloses.map((membership) => membership.id));
  const unaffectedMasjids = new Map<string, Set<StaffRole>>();

  for (const membership of input.snapshot.staffMemberships) {
    if (
      membership.masjid_id !== input.selectedMasjidId &&
      !closedStaffIds.has(membership.id) &&
      staffMembershipIsActiveOn(membership, input.draft.startsOn)
    ) {
      const roles = unaffectedMasjids.get(membership.masjid_name) ?? new Set<StaffRole>();
      roles.add(membership.staff_role);
      unaffectedMasjids.set(membership.masjid_name, roles);
    }
  }

  for (const [masjidName, roles] of unaffectedMasjids) {
    unchanged.push(`${masjidName}: ${accessLabelForRoles([...roles])} remains unchanged.`);
  }

  if (input.plan.studentMembershipCloses.length === 0 && !input.plan.studentMembershipInsert) {
    unchanged.push("Student placement is unchanged.");
  }

  unchanged.push(
    input.snapshot.teacherAssignments.length === 0
      ? "No current or upcoming teacher assignments are affected."
      : `${input.snapshot.teacherAssignments.length} current or upcoming teacher assignment${input.snapshot.teacherAssignments.length === 1 ? " is" : "s are"} unchanged.`
  );

  if (input.snapshot.profile.role === input.plan.nextRole) {
    unchanged.push(`Global default role remains ${roleLabel(input.snapshot.profile.role)}.`);
  }

  return unchanged;
}

export function buildGuidedChangeReview(input: {
  snapshot: GuidedAccessSnapshot;
  draft: GuidedChangeDraft;
  today: string;
}): GuidedChangeReview {
  const { snapshot, draft, today } = input;
  const label = operationLabel(snapshot, draft.operation, draft.startsOn || today);
  const selectedMasjid = snapshot.masjids.find((masjid) => masjid.id === draft.masjidId) ?? null;
  const selectedGroup = snapshot.groups.find((group) => group.id === draft.groupId) ?? null;
  const blockers: string[] = [];
  const warnings: string[] = [];
  let preset: SuperAdminAccessPreset | null = null;
  let plan: SuperAdminAccessChangePlan | null = null;

  if (!draft.startsOn) {
    blockers.push("Choose an effective date.");
  }

  if (draft.startsOn && draft.startsOn < today) {
    blockers.push("Guided Change cannot make historical corrections. Choose today or a future date.");
  }

  if (draft.operation === "assign_student") {
    if (!selectedGroup) blockers.push("Choose an active student group.");
    if (selectedGroup && draft.masjidId && selectedGroup.masjid_id !== draft.masjidId) {
      blockers.push("Choose a student group inside the selected masjid.");
    }
    if (draft.startsOn && weekStartForDate(draft.startsOn) !== draft.startsOn) {
      blockers.push("Student placement must start on a Sunday tracker-week boundary.");
    }
  } else if (draft.operation !== "deactivate_account" && !selectedMasjid) {
    blockers.push("Choose an active masjid.");
  }

  if (snapshot.profile.role === "super_admin") {
    blockers.push(
      "Super-admin privilege and account state require the dedicated privilege-safe workflow and cannot be changed here yet."
    );
  }

  if (
    draft.operation === "assign_student" &&
    snapshot.staffMemberships.some((membership) => membership.active && membership.ends_on === null)
  ) {
    blockers.push(
      "This person has open staff access. End those capabilities through their guarded workflows before assigning student placement."
    );
  }

  if (
    draft.operation === "deactivate_account" &&
    snapshot.staffMemberships.some(
      (membership) => membership.active && membership.ends_on === null && membership.staff_role === "teacher"
    )
  ) {
    blockers.push(
      "Open teacher access must be ended through its assignment-aware workflow before this account can be deactivated."
    );
  }

  if (draft.operation === "deactivate_account" && draft.startsOn && draft.startsOn !== today) {
    blockers.push("Account deactivation is immediate and must use today’s application date.");
  }

  try {
    preset = presetForGuidedOperation({
      operation: draft.operation,
      masjidId: selectedMasjid?.id,
      staffMemberships: snapshot.staffMemberships
    });
    plan = buildSuperAdminAccessChangePlan({
      targetRole: snapshot.profile.role,
      targetActive: snapshot.profile.active,
      preset,
      startsOn: draft.startsOn,
      selectedMasjidId: selectedMasjid?.id,
      selectedGroupId: selectedGroup?.id,
      studentMemberships: snapshot.studentMemberships,
      staffMemberships: snapshot.staffMemberships
    });
  } catch (error) {
    blockers.push(
      error instanceof SuperAdminAccessPlanError ? error.message : "Unable to calculate this access change."
    );
  }

  if (plan && draft.startsOn > today && (plan.nextRole !== snapshot.profile.role || plan.nextActive !== snapshot.profile.active)) {
    blockers.push(
      "This change would update the global account before the selected date. Choose today, or use a membership-only change that preserves the current role."
    );
  }

  const closesTeacherAccess = Boolean(
    plan?.staffMembershipCloses.some((close) =>
      snapshot.staffMemberships.some(
        (membership) => membership.id === close.id && membership.staff_role === "teacher"
      )
    )
  );

  if (
    snapshot.teacherAssignments.length > 0 &&
    (closesTeacherAccess || draft.operation === "deactivate_account")
  ) {
    blockers.push(
      "Current or upcoming teacher assignments must be resolved before this operation can remove teacher access."
    );
  }

  if (plan) {
    const hasMutation =
      plan.nextRole !== snapshot.profile.role ||
      plan.nextActive !== snapshot.profile.active ||
      plan.studentMembershipCloses.length > 0 ||
      Boolean(plan.studentMembershipInsert) ||
      plan.staffMembershipCloses.length > 0 ||
      plan.staffMembershipInserts.length > 0;

    if (!hasMutation) {
      blockers.push("The selected access is already in effect; there is no change to apply.");
    }

    if (draft.operation.startsWith("add_") && plan.studentMembershipCloses.length > 0) {
      warnings.push("This is an account conversion: the current student placement will end when staff access starts.");
    }

    if (draft.operation === "assign_student" && plan.staffMembershipCloses.length > 0) {
      warnings.push("This is an account conversion: all current staff access will end when student placement starts.");
    }
  }

  const adminNames = plan
    ? adminMasjidConfirmationNamesForPlan({
        staffMemberships: snapshot.staffMemberships,
        staffMembershipCloses: plan.staffMembershipCloses,
        staffMembershipInserts: plan.staffMembershipInserts,
        selectedMasjid
      })
    : [];
  const rows = plan
    ? addPlanRows({ snapshot, draft, plan, selectedMasjid, selectedGroup })
    : [];
  const unchanged = plan
    ? unchangedImpact({ snapshot, draft, plan, selectedMasjidId: selectedMasjid?.id ?? null })
    : [];
  const scopeLabel =
    draft.operation === "assign_student"
      ? selectedGroup
        ? `${selectedGroup.masjid_name} / ${selectedGroup.cohort_name} / ${selectedGroup.name}`
        : "Student group not selected"
      : draft.operation === "deactivate_account"
        ? "Entire account and all open access"
        : selectedMasjid?.name ?? "Masjid not selected";
  const isScheduled = Boolean(draft.startsOn && draft.startsOn > today);

  return {
    operation: draft.operation,
    operationLabel: label,
    title: `Review change for ${snapshot.profile.name}`,
    scopeLabel,
    dateLabel: draft.startsOn ? friendlyDate(draft.startsOn) : "Not selected",
    timingLabel: isScheduled
      ? `Scheduled for ${friendlyDate(draft.startsOn)}`
      : "Takes effect immediately",
    preset,
    plan,
    rows,
    unchanged,
    warnings,
    blockers: [...new Set(blockers)],
    personConfirmation: snapshot.profile.name,
    adminMasjidConfirmation: adminNames.length ? adminMasjidConfirmationText(adminNames) : null,
    submitLabel:
      draft.operation === "deactivate_account"
        ? "Deactivate account"
        : draft.operation === "assign_student"
          ? "Confirm student placement"
          : "Confirm access change"
  };
}
