"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  loadActiveGroupScope,
  loadActiveMasjidScope,
  loadPersonDetailData,
  loadProfileById,
  loadStaffMembershipsForPerson,
  loadStudentMembershipsForPerson
} from "@/app/super-admin/data";
import { isValidDateString, todayDateString, weekStartForDate } from "@/lib/dates";
import { reconcilePersonDetailWithAccessState } from "@/lib/person-access-state";
import { validateNewPassword } from "@/lib/password";
import {
  adminMasjidConfirmationNamesForPlan,
  adminMasjidConfirmationText,
  buildSuperAdminAccessChangePlan,
  parseSuperAdminAccessPreset,
  SuperAdminAccessPlanError
} from "@/lib/super-admin-access";
import {
  buildGuidedChangeReview,
  parseGuidedAccessOperation,
  type GuidedAccessSnapshot,
  type GuidedChangeReview
} from "@/lib/super-admin-guided-change";
import {
  insertSuperAdminAuditEvent,
  loadActiveSuperAdminCount,
  requireSuperAdminAdminClient
} from "@/lib/super-admin";
import { assertProfileRoleTransition, SuperAdminGuardError } from "@/lib/super-admin-rules";
import {
  applySuperAdminAccessChangeTransactionally,
  endStaffMembershipTransactionally,
  parsePersonAccessState,
  staffMembershipEndRpcArguments,
  superAdminAccessChangeRpcArguments,
  superAdminMutationStatusForOutcome,
  type PersonAccessState,
  type StaffMembershipEndResult,
  type SuperAdminAccessChangeResult
} from "@/lib/transactional-workflows";

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

function personAccessPath(personId: string, status: string) {
  return `/super-admin/people/${personId}/access?${new URLSearchParams({ status }).toString()}`;
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

export type GuidedChangePreparation = {
  status: "ready" | "blocked" | "error";
  message: string | null;
  requestId: string | null;
  expiresAt: string | null;
  review: GuidedChangeReview | null;
  snapshot: GuidedAccessSnapshot | null;
  expectedState: PersonAccessState | null;
};

export async function prepareGuidedPersonAccessChange(formData: FormData): Promise<GuidedChangePreparation> {
  const personId = formString(formData, "person_id");
  const operation = parseGuidedAccessOperation(formData.get("access_operation"));
  const startsOn = formString(formData, "starts_on");
  const masjidId = optionalFormString(formData, "masjid_id");
  const groupId = optionalFormString(formData, "group_id");

  if (!requireUuid(personId) || !operation || !isValidDateString(startsOn)) {
    return {
      status: "error",
      message: "Choose a valid operation, scope, and effective date.",
      requestId: null,
      expiresAt: null,
      review: null,
      snapshot: null,
      expectedState: null
    };
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const [detail, expectedStateResult] = await Promise.all([
    loadPersonDetailData(adminSupabase, personId),
    adminSupabase.rpc("get_person_access_state", {
      input_actor_id: actor.id,
      input_target_profile_id: personId
    })
  ]);

  if (!detail || expectedStateResult.error || !expectedStateResult.data) {
    return {
      status: "error",
      message: "The current access state could not be loaded safely.",
      requestId: null,
      expiresAt: null,
      review: null,
      snapshot: null,
      expectedState: null
    };
  }

  const expectedState = expectedStateResult.data as PersonAccessState;
  const canonicalDetail = reconcilePersonDetailWithAccessState(detail, expectedState);
  const snapshot: GuidedAccessSnapshot = {
    profile: canonicalDetail.profile,
    studentMemberships: canonicalDetail.studentMemberships,
    staffMemberships: canonicalDetail.staffMemberships,
    teacherAssignments: canonicalDetail.teacherAssignments,
    masjids: canonicalDetail.options.masjids,
    groups: canonicalDetail.options.groups
  };
  const review = buildGuidedChangeReview({
    snapshot,
    draft: { operation, startsOn, masjidId, groupId },
    today: todayDateString()
  });

  if (review.blockers.length > 0 || !review.plan || !review.preset) {
    return {
      status: "blocked",
      message: review.blockers[0] ?? "This change cannot be applied.",
      requestId: null,
      expiresAt: null,
      review,
      snapshot,
      expectedState
    };
  }

  const requestId = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error } = await adminSupabase.from("super_admin_guided_change_reviews").insert({
    request_id: requestId,
    actor_id: actor.id,
    target_profile_id: personId,
    operation,
    starts_on: startsOn,
    masjid_id: masjidId,
    group_id: groupId,
    expected_state: expectedState,
    review_payload: review,
    expires_at: expiresAt
  });

  if (error) {
    console.error("Unable to persist the Guided Change review intent.", {
      actorId: actor.id,
      targetProfileId: personId,
      errorCode: error.code ?? null
    });
    return {
      status: "error",
      message: "The reviewed change could not be secured for submission. Review it again.",
      requestId: null,
      expiresAt: null,
      review,
      snapshot,
      expectedState
    };
  }

  return {
    status: "ready",
    message: null,
    requestId,
    expiresAt,
    review,
    snapshot,
    expectedState
  };
}

export async function savePersonAccess(formData: FormData) {
  const personId = formString(formData, "person_id");
  const isGuidedChange = formString(formData, "guided_change") === "true";

  if (!requireUuid(personId)) {
    redirect(invalidPeoplePath());
  }

  let guidedOperation = null;
  let preset = isGuidedChange ? null : parseSuperAdminAccessPreset(formData.get("access_preset"));
  let startsOn = isGuidedChange ? todayDateString() : formString(formData, "starts_on");

  if ((!isGuidedChange && !preset) || (!isGuidedChange && !isValidDateString(startsOn))) {
    redirect(isGuidedChange ? personAccessPath(personId, "invalid") : personPath(personId, "invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const target = await loadProfileById(adminSupabase, personId);

  if (!target) {
    redirect(invalidPeoplePath());
  }

  if (formString(formData, "confirmation_name") !== target.name) {
    redirect(
      isGuidedChange
        ? personAccessPath(target.id, "confirmation-mismatch")
        : personPath(target.id, "confirmation-mismatch")
    );
  }

  let selectedMasjidId = optionalFormString(formData, "masjid_id");
  let selectedGroupId = optionalFormString(formData, "group_id");
  const requestIdValue = optionalFormString(formData, "request_id");
  let guidedExpectedState: PersonAccessState | null = null;

  if (isGuidedChange) {
    if (!requireUuid(requestIdValue)) {
      redirect(personAccessPath(target.id, "review-expired"));
    }

    const { data: reviewedIntent, error: reviewedIntentError } = await adminSupabase
      .from("super_admin_guided_change_reviews")
      .select("request_id,actor_id,target_profile_id,operation,starts_on,masjid_id,group_id,expected_state,expires_at")
      .eq("request_id", requestIdValue)
      .eq("actor_id", actor.id)
      .eq("target_profile_id", target.id)
      .maybeSingle<{
        request_id: string;
        actor_id: string;
        target_profile_id: string;
        operation: string;
        starts_on: string;
        masjid_id: string | null;
        group_id: string | null;
        expected_state: PersonAccessState;
        expires_at: string;
      }>();

    const reviewedOperation = parseGuidedAccessOperation(reviewedIntent?.operation ?? null);
    guidedExpectedState = reviewedIntent
      ? parsePersonAccessState(JSON.stringify(reviewedIntent.expected_state))
      : null;

    if (
      reviewedIntentError ||
      !reviewedIntent ||
      !reviewedOperation ||
      !guidedExpectedState ||
      new Date(reviewedIntent.expires_at).getTime() <= Date.now()
    ) {
      redirect(personAccessPath(target.id, "review-expired"));
    }

    guidedOperation = reviewedOperation;
    startsOn = reviewedIntent.starts_on;
    selectedMasjidId = reviewedIntent.masjid_id;
    selectedGroupId = reviewedIntent.group_id;
  }
  let selectedMasjid: { id: string; name: string } | null = null;
  let selectedGroupMasjidId: string | null = null;
  let failureStatus: string | null = null;

  try {
    const isStudentOperation = guidedOperation === "assign_student" || preset === "student";
    const isInactiveOperation = guidedOperation === "deactivate_account" || preset === "inactive";

    if (isStudentOperation) {
      if (!selectedGroupId || !requireUuid(selectedGroupId)) {
        throw new SuperAdminAccessPlanError("Choose an active group.");
      }

      const groupScope = await loadActiveGroupScope(adminSupabase, selectedGroupId);

      if (!groupScope || (selectedMasjidId && groupScope.masjid.id !== selectedMasjidId)) {
        throw new SuperAdminAccessPlanError("Choose active group scope.");
      }

      selectedMasjid = { id: groupScope.masjid.id, name: groupScope.masjid.name };
      selectedGroupMasjidId = groupScope.masjid.id;
    } else if (!isInactiveOperation) {
      if (!selectedMasjidId || !requireUuid(selectedMasjidId)) {
        throw new SuperAdminAccessPlanError("Choose an active masjid.");
      }

      const masjid = await loadActiveMasjidScope(adminSupabase, selectedMasjidId);

      if (!masjid) {
        throw new SuperAdminAccessPlanError("Choose an active masjid.");
      }

      selectedMasjid = { id: masjid.id, name: masjid.name };
    }

    const [studentMemberships, staffMemberships, activeSuperAdminCount, guidedDetail] = await Promise.all([
      loadStudentMembershipsForPerson(adminSupabase, target.id),
      loadStaffMembershipsForPerson(adminSupabase, target.id),
      loadActiveSuperAdminCount(adminSupabase),
      guidedOperation ? loadPersonDetailData(adminSupabase, target.id) : Promise.resolve(null)
    ]);
    let guidedReview = null;

    if (guidedOperation) {
      if (!guidedDetail) {
        throw new SuperAdminAccessPlanError("Unable to load the current person access state.");
      }

      const guidedSnapshot: GuidedAccessSnapshot = {
        profile: guidedDetail.profile,
        studentMemberships: guidedDetail.studentMemberships,
        staffMemberships: guidedDetail.staffMemberships,
        teacherAssignments: guidedDetail.teacherAssignments,
        masjids: guidedDetail.options.masjids,
        groups: guidedDetail.options.groups
      };
      guidedReview = buildGuidedChangeReview({
        snapshot: guidedSnapshot,
        draft: {
          operation: guidedOperation,
          startsOn,
          masjidId: selectedMasjidId,
          groupId: selectedGroupId
        },
        today: todayDateString()
      });

      if (guidedReview.blockers.length > 0 || !guidedReview.preset || !guidedReview.plan) {
        throw new SuperAdminAccessPlanError(guidedReview.blockers[0] ?? "Unable to prepare this access change.");
      }

      preset = guidedReview.preset;
    }

    if (!preset) {
      throw new SuperAdminAccessPlanError("Choose an access operation.");
    }

    const plan = guidedReview?.plan ?? buildSuperAdminAccessChangePlan({
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

    if (guidedOperation && !requireUuid(requestIdValue)) {
      throw new SuperAdminAccessPlanError("The reviewed change reference is missing. Review the change again.");
    }
    const requestId = requestIdValue && requireUuid(requestIdValue) ? requestIdValue : randomUUID();
    const submittedExpectedStateValue = formString(formData, "expected_state");
    const submittedExpectedState = guidedOperation
      ? guidedExpectedState
      : submittedExpectedStateValue
        ? parsePersonAccessState(submittedExpectedStateValue)
        : null;

    if (submittedExpectedStateValue && !submittedExpectedState) {
      throw new SuperAdminAccessPlanError("Invalid access state token.");
    }

    if (guidedOperation && !submittedExpectedState) {
      throw new SuperAdminAccessPlanError("The reviewed access state is missing. Review the change again.");
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
      failureStatus = superAdminMutationStatusForOutcome(outcome);

      if (outcome.uncertain) {
        console.error("Super-admin access change requires operator review.", {
          requestId,
          targetProfileId: target.id,
          mutationErrorCode: outcome.error.code ?? null
        });
      }
    }
  } catch (error) {
    failureStatus ??= statusForError(error);
  }

  if (failureStatus) {
    redirect(isGuidedChange ? personAccessPath(personId, failureStatus) : personPath(personId, failureStatus));
  }

  revalidatePath("/super-admin/people");
  revalidatePath(`/super-admin/people/${personId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  redirect(isGuidedChange ? personAccessPath(personId, "access-updated") : personPath(personId, "access-updated"));
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

    const requestIdValue = optionalFormString(formData, "request_id");
    const requestId = requestIdValue && requireUuid(requestIdValue) ? requestIdValue : randomUUID();
    const submittedExpectedStateValue = formString(formData, "expected_state");
    const submittedExpectedState = submittedExpectedStateValue
      ? parsePersonAccessState(submittedExpectedStateValue)
      : null;

    if (submittedExpectedStateValue && !submittedExpectedState) {
      throw new SuperAdminAccessPlanError("Invalid access state token.");
    }

    const outcome = await endStaffMembershipTransactionally(
      {
        requestId,
        actorId: actor.id,
        targetProfileId: target.id,
        membershipId: membership.id,
        endsOn,
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
        applyMembershipEnd: async (endInput, expectedState) => {
          const { data, error } = await adminSupabase.rpc(
            "apply_super_admin_staff_membership_end",
            staffMembershipEndRpcArguments(endInput, expectedState)
          );

          return { data: data as StaffMembershipEndResult | null, error };
        }
      }
    );

    if (!outcome.ok) {
      failureStatus = superAdminMutationStatusForOutcome(outcome);

      if (outcome.uncertain) {
        console.error("Staff membership end requires operator review.", {
          requestId,
          targetProfileId: target.id,
          membershipId: membership.id,
          mutationErrorCode: outcome.error.code ?? null
        });
      }
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

export async function correctStudentScoreStart(formData: FormData) {
  const personId = formString(formData, "person_id");
  const scoreStartsOn = formString(formData, "score_starts_on");
  const expectedValue = formData.get("expected_score_starts_on");
  const expectedScoreStartsOn = typeof expectedValue === "string" && expectedValue ? expectedValue : null;

  if (
    !requireUuid(personId)
    || !scoreStartsOn
    || !isValidDateString(scoreStartsOn)
    || weekStartForDate(scoreStartsOn) !== scoreStartsOn
  ) {
    redirect(personId && requireUuid(personId) ? personPath(personId, "invalid") : invalidPeoplePath());
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const target = await loadProfileById(adminSupabase, personId);

  if (!target || target.role !== "student") {
    redirect(invalidPeoplePath());
  }

  if (formString(formData, "confirmation_name") !== target.name) {
    redirect(personPath(target.id, "confirmation-mismatch"));
  }

  const { error } = await adminSupabase.rpc("apply_super_admin_score_start_correction", {
    input_actor_id: actor.id,
    input_student_id: target.id,
    input_score_starts_on: scoreStartsOn,
    input_expected_score_starts_on: expectedScoreStartsOn
  });

  if (error) {
    redirect(personPath(target.id, error.code === "P0001" ? "score-start-stale" : "save-error"));
  }

  revalidatePath(`/super-admin/people/${target.id}`);
  revalidatePath("/admin");
  revalidatePath("/admin/leaderboard");
  redirect(personPath(target.id, "score-start-corrected"));
}
