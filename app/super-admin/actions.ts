"use server";

import { randomUUID } from "node:crypto";
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
  type StaffMembershipWindow
} from "@/lib/super-admin-access";
import {
  insertSuperAdminAuditEvent,
  loadActiveSuperAdminCount,
  requireSuperAdminAdminClient
} from "@/lib/super-admin";
import { assertProfileRoleTransition, SuperAdminGuardError } from "@/lib/super-admin-rules";
import {
  applySuperAdminAccessChangeTransactionally,
  parsePersonAccessState,
  superAdminAccessChangeRpcArguments,
  superAdminAccessStatusForError,
  type PersonAccessState,
  type SuperAdminAccessChangeResult
} from "@/lib/transactional-workflows";
import type { MasjidStaffMembership, Profile } from "@/lib/types";

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

    const requestIdValue = optionalFormString(formData, "request_id");
    const requestId = requestIdValue && requireUuid(requestIdValue) ? requestIdValue : randomUUID();
    const submittedExpectedStateValue = formString(formData, "expected_state");
    const submittedExpectedState = submittedExpectedStateValue
      ? parsePersonAccessState(submittedExpectedStateValue)
      : null;

    if (submittedExpectedStateValue && !submittedExpectedState) {
      throw new SuperAdminAccessPlanError("Invalid access state token.");
    }

    const canonicalMasjidId = preset === "student"
      ? selectedGroupMasjidId
      : preset === "inactive"
        ? null
        : selectedMasjid?.id ?? null;
    const canonicalGroupId = preset === "student" ? selectedGroupId : null;
    const outcome = await applySuperAdminAccessChangeTransactionally(
      {
        requestId,
        actorId: actor.id,
        targetProfileId: target.id,
        preset,
        startsOn,
        selectedMasjidId: canonicalMasjidId,
        selectedGroupId: canonicalGroupId,
        submittedExpectedState
      },
      {
        getPersonAccessState: async (actorId, targetProfileId) => {
          const { data, error } = await adminSupabase.rpc("get_person_access_state", {
            input_actor_id: actorId,
            input_target_profile_id: targetProfileId
          });

          return { data: data as PersonAccessState | null, error };
        },
        applyAccessChange: async (accessInput, expectedState) => {
          const { data, error } = await adminSupabase.rpc(
            "apply_super_admin_access_change",
            superAdminAccessChangeRpcArguments(accessInput, expectedState)
          );

          return { data: data as SuperAdminAccessChangeResult | null, error };
        }
      }
    );

    if (!outcome.ok) {
      failureStatus = superAdminAccessStatusForError(outcome.error);
    }
  } catch (error) {
    failureStatus ??= statusForError(error);
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
