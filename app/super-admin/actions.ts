"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  loadActiveGroupScope,
  loadActiveMasjidScope,
  loadProfileById,
  loadStaffMembershipsForPerson,
  loadStudentMembershipsForPerson
} from "@/app/super-admin/data";
import { isValidDateString, todayDateString } from "@/lib/dates";
import { validateNewPassword } from "@/lib/password";
import {
  adminMasjidConfirmationNamesForPlan,
  adminMasjidConfirmationText,
  buildSuperAdminAccessChangePlan,
  parseSuperAdminAccessPreset,
  SuperAdminAccessPlanError,
  type StaffMembershipWindow,
  type StudentMembershipWindow
} from "@/lib/super-admin-access";
import {
  insertSuperAdminAuditEvent,
  loadActiveSuperAdminCount,
  requireSuperAdminAdminClient
} from "@/lib/super-admin";
import { assertProfileRoleTransition, SuperAdminGuardError } from "@/lib/super-admin-rules";
import type { MasjidStaffMembership, Profile, StaffRole, StudentGroupMembership } from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ConfirmationMismatchError extends Error {
  constructor() {
    super("Confirmation mismatch.");
    this.name = "ConfirmationMismatchError";
  }
}

function personPath(personId: string, status: string) {
  return `/super-admin/people/${personId}?${new URLSearchParams({ status }).toString()}`;
}

function invalidPeoplePath(status = "invalid") {
  return `/super-admin/people?${new URLSearchParams({ status }).toString()}`;
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalFormString(formData: FormData, key: string) {
  const value = formString(formData, key);
  return value || null;
}

function requireUuid(value: string | null) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function statusForError(error: unknown) {
  if (error instanceof ConfirmationMismatchError) {
    return "confirmation-mismatch";
  }

  if (error instanceof SuperAdminGuardError) {
    return "guard-denied";
  }

  if (error instanceof SuperAdminAccessPlanError) {
    return "scope-invalid";
  }

  return "save-error";
}

function profileAuditData(profile: Pick<Profile, "role" | "active">) {
  return {
    role: profile.role,
    active: profile.active
  };
}

function studentMembershipAuditData(membership: Pick<StudentGroupMembership, "student_id" | "group_id" | "starts_on" | "ends_on">) {
  return {
    student_id: membership.student_id,
    group_id: membership.group_id,
    starts_on: membership.starts_on,
    ends_on: membership.ends_on
  };
}

function staffMembershipAuditData(
  membership: Pick<MasjidStaffMembership, "profile_id" | "masjid_id" | "staff_role" | "active" | "starts_on" | "ends_on">
) {
  return {
    profile_id: membership.profile_id,
    masjid_id: membership.masjid_id,
    staff_role: membership.staff_role,
    active: membership.active,
    starts_on: membership.starts_on,
    ends_on: membership.ends_on
  };
}

async function auditProfileChange(input: {
  actor: Profile;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  target: Profile;
  nextRole: Profile["role"];
  nextActive: boolean;
  preset: string;
}) {
  if (input.target.role === input.nextRole && input.target.active === input.nextActive) {
    return;
  }

  await insertSuperAdminAuditEvent({
    actor: input.actor,
    adminSupabase: input.adminSupabase,
    event: {
      action: "profile_access_update",
      targetTable: "profiles",
      targetId: input.target.id,
      beforeData: profileAuditData(input.target),
      afterData: {
        role: input.nextRole,
        active: input.nextActive
      },
      metadata: {
        preset: input.preset
      }
    }
  });
}

async function closeStudentMembership(input: {
  actor: Profile;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  before: StudentMembershipWindow & { masjid_id?: string };
  endsOn: string;
}) {
  const { data, error } = await input.adminSupabase
    .from("student_group_memberships")
    .update({ ends_on: input.endsOn, updated_at: new Date().toISOString() })
    .eq("id", input.before.id)
    .select("id,student_id,group_id,starts_on,ends_on,assigned_by,created_at,updated_at")
    .single<StudentGroupMembership>();

  if (error || !data) {
    throw new Error("Unable to close student membership.");
  }

  await insertSuperAdminAuditEvent({
    actor: input.actor,
    adminSupabase: input.adminSupabase,
    event: {
      action: "student_membership_closed",
      targetTable: "student_group_memberships",
      targetId: input.before.id,
      targetMasjidId: input.before.masjid_id ?? null,
      beforeData: {
        id: input.before.id,
        group_id: input.before.group_id,
        starts_on: input.before.starts_on,
        ends_on: input.before.ends_on
      },
      afterData: studentMembershipAuditData(data)
    }
  });
}

async function insertStudentMembership(input: {
  actor: Profile;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  targetId: string;
  groupId: string;
  startsOn: string;
  targetMasjidId: string;
}) {
  const { data, error } = await input.adminSupabase
    .from("student_group_memberships")
    .insert({
      student_id: input.targetId,
      group_id: input.groupId,
      starts_on: input.startsOn,
      assigned_by: input.actor.id
    })
    .select("id,student_id,group_id,starts_on,ends_on,assigned_by,created_at,updated_at")
    .single<StudentGroupMembership>();

  if (error || !data) {
    throw new Error("Unable to create student membership.");
  }

  await insertSuperAdminAuditEvent({
    actor: input.actor,
    adminSupabase: input.adminSupabase,
    event: {
      action: "student_membership_created",
      targetTable: "student_group_memberships",
      targetId: data.id,
      targetMasjidId: input.targetMasjidId,
      afterData: studentMembershipAuditData(data)
    }
  });
}

async function closeStaffMembership(input: {
  actor: Profile;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  before: StaffMembershipWindow & Pick<MasjidStaffMembership, "profile_id">;
  endsOn: string;
  action?: string;
}) {
  const { data, error } = await input.adminSupabase
    .from("masjid_staff_memberships")
    .update({ ends_on: input.endsOn, updated_at: new Date().toISOString() })
    .eq("id", input.before.id)
    .select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on,created_by,created_at,updated_at")
    .single<MasjidStaffMembership>();

  if (error || !data) {
    throw new Error("Unable to close staff membership.");
  }

  await insertSuperAdminAuditEvent({
    actor: input.actor,
    adminSupabase: input.adminSupabase,
    event: {
      action: input.action ?? "staff_membership_closed",
      targetTable: "masjid_staff_memberships",
      targetId: input.before.id,
      targetMasjidId: input.before.masjid_id,
      beforeData: staffMembershipAuditData(input.before),
      afterData: staffMembershipAuditData(data)
    }
  });
}

async function insertStaffMembership(input: {
  actor: Profile;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  targetId: string;
  masjidId: string;
  staffRole: StaffRole;
  startsOn: string;
}) {
  const { data, error } = await input.adminSupabase
    .from("masjid_staff_memberships")
    .insert({
      profile_id: input.targetId,
      masjid_id: input.masjidId,
      staff_role: input.staffRole,
      active: true,
      starts_on: input.startsOn,
      created_by: input.actor.id
    })
    .select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on,created_by,created_at,updated_at")
    .single<MasjidStaffMembership>();

  if (error || !data) {
    throw new Error("Unable to create staff membership.");
  }

  await insertSuperAdminAuditEvent({
    actor: input.actor,
    adminSupabase: input.adminSupabase,
    event: {
      action: "staff_membership_created",
      targetTable: "masjid_staff_memberships",
      targetId: data.id,
      targetMasjidId: input.masjidId,
      afterData: staffMembershipAuditData(data)
    }
  });
}

export async function savePersonAccess(formData: FormData) {
  const personId = formString(formData, "person_id");

  if (!requireUuid(personId)) {
    redirect(invalidPeoplePath());
  }

  const preset = parseSuperAdminAccessPreset(formData.get("access_preset"));
  const startsOn = formString(formData, "starts_on");

  if (!preset || !isValidDateString(startsOn)) {
    redirect(personPath(personId, "invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const target = await loadProfileById(adminSupabase, personId);

  if (!target) {
    redirect(invalidPeoplePath());
  }

  if (formString(formData, "confirmation_name") !== target.name) {
    redirect(personPath(target.id, "confirmation-mismatch"));
  }

  const selectedMasjidId = optionalFormString(formData, "masjid_id");
  const selectedGroupId = optionalFormString(formData, "group_id");
  let selectedMasjid: { id: string; name: string } | null = null;
  let selectedGroupMasjidId: string | null = null;
  let failureStatus: string | null = null;

  try {
    if (preset === "student") {
      if (!selectedGroupId || !requireUuid(selectedGroupId)) {
        throw new SuperAdminAccessPlanError("Choose an active group.");
      }

      const groupScope = await loadActiveGroupScope(adminSupabase, selectedGroupId);

      if (!groupScope || (selectedMasjidId && groupScope.masjid.id !== selectedMasjidId)) {
        throw new SuperAdminAccessPlanError("Choose active group scope.");
      }

      selectedMasjid = { id: groupScope.masjid.id, name: groupScope.masjid.name };
      selectedGroupMasjidId = groupScope.masjid.id;
    } else if (preset !== "inactive") {
      if (!selectedMasjidId || !requireUuid(selectedMasjidId)) {
        throw new SuperAdminAccessPlanError("Choose an active masjid.");
      }

      const masjid = await loadActiveMasjidScope(adminSupabase, selectedMasjidId);

      if (!masjid) {
        throw new SuperAdminAccessPlanError("Choose an active masjid.");
      }

      selectedMasjid = { id: masjid.id, name: masjid.name };
    }

    const [studentMemberships, staffMemberships, activeSuperAdminCount] = await Promise.all([
      loadStudentMembershipsForPerson(adminSupabase, target.id),
      loadStaffMembershipsForPerson(adminSupabase, target.id),
      loadActiveSuperAdminCount(adminSupabase)
    ]);
    const plan = buildSuperAdminAccessChangePlan({
      targetRole: target.role,
      targetActive: target.active,
      preset,
      startsOn,
      selectedMasjidId,
      selectedGroupId,
      studentMemberships,
      staffMemberships
    });

    assertProfileRoleTransition({
      actorId: actor.id,
      targetProfileId: target.id,
      targetRole: target.role,
      targetActive: target.active,
      nextRole: plan.nextRole,
      nextActive: plan.nextActive,
      activeSuperAdminCount
    });

    const adminMasjidConfirmationNames = adminMasjidConfirmationNamesForPlan({
      staffMemberships,
      staffMembershipCloses: plan.staffMembershipCloses,
      staffMembershipInserts: plan.staffMembershipInserts,
      selectedMasjid
    });

    if (
      adminMasjidConfirmationNames.length > 0 &&
      formString(formData, "confirmation_masjid") !== adminMasjidConfirmationText(adminMasjidConfirmationNames)
    ) {
      throw new ConfirmationMismatchError();
    }

    if (target.role !== plan.nextRole || target.active !== plan.nextActive) {
      const { error } = await adminSupabase
        .from("profiles")
        .update({ role: plan.nextRole, active: plan.nextActive })
        .eq("id", target.id);

      if (error) {
        throw new Error("Unable to update profile.");
      }

      await auditProfileChange({
        actor,
        adminSupabase,
        target,
        nextRole: plan.nextRole,
        nextActive: plan.nextActive,
        preset
      });
    }

    const studentMembershipById = new Map(studentMemberships.map((membership) => [membership.id, membership]));
    const staffMembershipById = new Map(staffMemberships.map((membership) => [membership.id, membership]));

    for (const close of plan.studentMembershipCloses) {
      const before = studentMembershipById.get(close.id);

      if (!before) {
        throw new Error("Unable to find student membership.");
      }

      await closeStudentMembership({
        actor,
        adminSupabase,
        before,
        endsOn: close.endsOn
      });
    }

    if (plan.studentMembershipInsert) {
      if (!selectedGroupMasjidId) {
        throw new Error("Missing student masjid scope.");
      }

      await insertStudentMembership({
        actor,
        adminSupabase,
        targetId: target.id,
        groupId: plan.studentMembershipInsert.groupId,
        startsOn: plan.studentMembershipInsert.startsOn,
        targetMasjidId: selectedGroupMasjidId
      });
    }

    for (const close of plan.staffMembershipCloses) {
      const before = staffMembershipById.get(close.id);

      if (!before) {
        throw new Error("Unable to find staff membership.");
      }

      await closeStaffMembership({
        actor,
        adminSupabase,
        before,
        endsOn: close.endsOn
      });
    }

    for (const insert of plan.staffMembershipInserts) {
      await insertStaffMembership({
        actor,
        adminSupabase,
        targetId: target.id,
        masjidId: insert.masjidId,
        staffRole: insert.staffRole,
        startsOn: insert.startsOn
      });
    }
  } catch (error) {
    failureStatus = statusForError(error);
  }

  if (failureStatus) {
    redirect(personPath(personId, failureStatus));
  }

  revalidatePath("/super-admin/people");
  revalidatePath(`/super-admin/people/${personId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  redirect(personPath(personId, "access-updated"));
}

export async function endStaffMembership(formData: FormData) {
  const personId = formString(formData, "person_id");
  const membershipId = formString(formData, "membership_id");
  const endsOn = formString(formData, "ends_on") || todayDateString();

  if (!requireUuid(personId) || !requireUuid(membershipId) || !isValidDateString(endsOn)) {
    redirect(invalidPeoplePath());
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const target = await loadProfileById(adminSupabase, personId);

  if (!target) {
    redirect(invalidPeoplePath());
  }

  if (formString(formData, "confirmation_name") !== target.name) {
    redirect(personPath(target.id, "confirmation-mismatch"));
  }

  let failureStatus: string | null = null;

  try {
    const staffMemberships = await loadStaffMembershipsForPerson(adminSupabase, target.id);
    const membership = staffMemberships.find((row) => row.id === membershipId);

    if (!membership || membership.ends_on !== null || !membership.active || membership.starts_on > endsOn) {
      throw new SuperAdminAccessPlanError("Choose a valid open staff membership.");
    }

    if (membership.staff_role === "admin" && formString(formData, "confirmation_masjid") !== membership.masjid_name) {
      throw new ConfirmationMismatchError();
    }

    await closeStaffMembership({
      actor,
      adminSupabase,
      before: membership,
      endsOn,
      action: "staff_membership_ended"
    });
  } catch (error) {
    failureStatus = statusForError(error);
  }

  if (failureStatus) {
    redirect(personPath(personId, failureStatus));
  }

  revalidatePath("/super-admin/people");
  revalidatePath(`/super-admin/people/${personId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  redirect(personPath(personId, "membership-ended"));
}

export async function resetPersonPassword(formData: FormData) {
  const personId = formString(formData, "person_id");

  if (!requireUuid(personId)) {
    redirect(invalidPeoplePath());
  }

  const temporaryPassword = String(formData.get("temporary_password") ?? "");
  const confirmPassword = String(formData.get("confirm_temporary_password") ?? "");
  const validation = validateNewPassword(temporaryPassword, confirmPassword);

  if (!validation.ok) {
    redirect(personPath(personId, "password-invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const target = await loadProfileById(adminSupabase, personId);

  if (!target) {
    redirect(invalidPeoplePath());
  }

  if (formString(formData, "confirmation_name") !== target.name) {
    redirect(personPath(target.id, "confirmation-mismatch"));
  }

  const { error } = await adminSupabase.auth.admin.updateUserById(target.id, {
    password: validation.password
  });

  if (error) {
    redirect(personPath(target.id, "password-error"));
  }

  await insertSuperAdminAuditEvent({
    actor,
    adminSupabase,
    event: {
      action: "password_reset",
      targetTable: "profiles",
      targetId: target.id,
      metadata: {
        method: "typed_temporary_password"
      }
    }
  });

  revalidatePath(`/super-admin/people/${personId}`);
  redirect(personPath(personId, "password-reset"));
}
