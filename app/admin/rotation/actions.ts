"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  loadActiveRotationGroups,
  loadActiveRotationTeachers,
  loadRotationSettings,
  rotationRedirectPath,
  type RotationContext,
  validRotationWeekStart
} from "@/app/admin/rotation/data";
import { assertAdminCanManageCohort } from "@/lib/admin-scope";
import { rotationPath } from "@/lib/rotation-scope";
import { parseStudentRotationAbsences } from "@/lib/student-rotation-availability";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import {
  buildTeacherRotationPersistencePlan,
  plannerInputFromRotationPublicationSnapshot
} from "@/lib/teacher-rotation";
import type {
  RefreshSessionRosterDraftResponse,
  SessionRosterDraftResponse,
  SessionRosterHistoryResponse,
  SessionRosterPublishedResponse,
  SessionRosterWizardDraftResponse,
  SessionRosterWizardLegacyTransitionPreviewResponse,
  SessionRosterWizardLegacyTransitionResponse,
  SessionRosterWizardPublishedResponse
} from "@/lib/session-roster";
import { sessionRosterActionError, type SessionRosterActionError } from "@/lib/session-roster-ui";

function positiveInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function selectedContextIds(formData: FormData) {
  return {
    masjidId: String(formData.get("masjid_id") ?? ""),
    cohortId: String(formData.get("cohort_id") ?? "")
  };
}

async function requireRotationContext(formData: FormData, weekStart: string) {
  const { profile } = await requireProfile(["admin"]);
  const selection = selectedContextIds(formData);
  const adminSupabase = createSupabaseAdminClient();
  let cohort: Awaited<ReturnType<typeof assertAdminCanManageCohort>>;

  try {
    cohort = await assertAdminCanManageCohort({
      adminSupabase,
      admin: profile,
      cohortId: selection.cohortId || null
    });
  } catch {
    redirect(
      rotationPath({
        masjidId: selection.masjidId,
        cohortId: selection.cohortId,
        weekStart,
        status: "unauthorized"
      })
    );
  }

  if (!selection.masjidId || cohort.masjid_id !== selection.masjidId) {
    redirect(
      rotationPath({
        masjidId: selection.masjidId,
        cohortId: selection.cohortId,
        weekStart,
        status: "unauthorized"
      })
    );
  }

  const context: RotationContext = {
    masjid: {
      id: cohort.masjid.id,
      name: cohort.masjid.name,
      slug: cohort.masjid.slug
    },
    cohort: {
      id: cohort.id,
      name: cohort.name,
      kind: cohort.kind,
      masjid_id: cohort.masjid_id
    }
  };

  return { profile, context };
}

export async function saveRotationSettings(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const targetGroupCount = positiveInteger(formData.get("target_group_count"));
  const { profile, context } = await requireRotationContext(formData, weekStart);

  if (!targetGroupCount) {
    redirect(rotationRedirectPath(context, weekStart, "invalid"));
  }

  const adminSupabase = createSupabaseAdminClient();
  const activeGroups = await loadActiveRotationGroups(adminSupabase, context.cohort.id);

  if (targetGroupCount < activeGroups.length) {
    redirect(rotationRedirectPath(context, weekStart, "target-below-active-groups"));
  }

  const existingSettings = await loadRotationSettings(adminSupabase, context);
  const payload = {
    masjid_id: context.masjid.id,
    cohort_id: context.cohort.id,
    target_group_count: targetGroupCount,
    active: true,
    updated_by: profile.id,
    updated_at: new Date().toISOString()
  };
  const result = existingSettings
    ? await adminSupabase.from("cohort_rotation_settings").update(payload).eq("id", existingSettings.id)
    : await adminSupabase.from("cohort_rotation_settings").insert({
        ...payload,
        created_by: profile.id
      });

  if (result.error) {
    redirect(rotationRedirectPath(context, weekStart, "save-error"));
  }

  revalidatePath("/admin/rotation");
  redirect(rotationRedirectPath(context, weekStart, "settings-saved"));
}

export async function saveTeacherAvailability(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const { profile, context } = await requireRotationContext(formData, weekStart);
  const adminSupabase = createSupabaseAdminClient();
  const teachers = await loadActiveRotationTeachers({ adminSupabase, context, weekStart });

  if (teachers.length === 0) {
    redirect(rotationPath({ masjidId: context.masjid.id, cohortId: context.cohort.id, weekStart, status: "setup-incomplete", step: "teachers" }));
  }

  const availableTeacherIds = new Set(
    formData.getAll("available_teacher_id").filter((value): value is string => typeof value === "string")
  );
  const { error } = await adminSupabase.rpc("apply_teacher_rotation_availability", {
    input_actor_id: profile.id,
    input_cohort_id: context.cohort.id,
    input_week_start: weekStart,
    input_available_teacher_ids: [...availableTeacherIds]
  });

  if (error) {
    redirect(rotationPath({ masjidId: context.masjid.id, cohortId: context.cohort.id, weekStart, status: "save-error", step: "teachers" }));
  }

  revalidatePath("/admin/rotation");
  redirect(rotationPath({ masjidId: context.masjid.id, cohortId: context.cohort.id, weekStart, status: "availability-saved", step: "teachers" }));
}

export async function saveStudentAvailability(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const { profile, context } = await requireRotationContext(formData, weekStart);
  let absences: ReturnType<typeof parseStudentRotationAbsences>;

  try {
    absences = parseStudentRotationAbsences(formData.get("absences"));
  } catch {
    redirect(rotationPath({ masjidId: context.masjid.id, cohortId: context.cohort.id, weekStart, status: "student-availability-invalid", step: "students" }));
  }

  const adminSupabase = createSupabaseAdminClient();
  const { error } = await adminSupabase.rpc("apply_student_rotation_availability", {
    input_actor_id: profile.id,
    input_cohort_id: context.cohort.id,
    input_week_start: weekStart,
    input_absences: absences
  });

  if (error) {
    redirect(rotationPath({ masjidId: context.masjid.id, cohortId: context.cohort.id, weekStart, status: "student-availability-error", step: "students" }));
  }

  revalidatePath("/admin/rotation");
  redirect(rotationPath({ masjidId: context.masjid.id, cohortId: context.cohort.id, weekStart, status: "student-availability-saved", step: "students" }));
}

export async function rebalanceStudentGroups(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const { profile, context } = await requireRotationContext(formData, weekStart);

  if (formData.get("confirm_rebalance") !== "confirmed") {
    redirect(rotationRedirectPath(context, weekStart, "rebalance-confirmation-required"));
  }

  const adminSupabase = createSupabaseAdminClient();
  const settings = await loadRotationSettings(adminSupabase, context);

  if (!settings) {
    redirect(rotationRedirectPath(context, weekStart, "setup-incomplete"));
  }

  const { error } = await adminSupabase.rpc("apply_cohort_group_rebalance", {
    input_cohort_id: context.cohort.id,
    input_week_start: weekStart,
    input_rebalanced_by: profile.id,
    input_target_group_count: settings.target_group_count
  });

  if (error) {
    redirect(rotationRedirectPath(context, weekStart, "rebalance-error"));
  }

  revalidatePath("/admin/rotation");
  revalidatePath("/admin");
  revalidatePath("/student/check-in");
  revalidatePath("/student/grades");
  revalidatePath("/student/weekly-plan");
  revalidatePath("/teacher");
  redirect(rotationRedirectPath(context, weekStart, "rebalanced"));
}

function throwIfRedirect(error: unknown) {
  if (
    error instanceof Error &&
    (error.message === "NEXT_REDIRECT" || error.message.includes("NEXT_REDIRECT"))
  ) {
    throw error;
  }
}

function rotationPublicationStatus(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";

  if (message.includes("rotation_publication_stale_state")) {
    return "publication-stale";
  }
  if (message.includes("rotation_publication_setup_incomplete")) {
    return "publication-setup-incomplete";
  }
  if (message.includes("teacher_unavailable_or_ineligible")) {
    return "publication-unavailable";
  }
  if (message.includes("rotation_publication_request_reused")) {
    return "publication-request-reused";
  }
  if (message.includes("40001") || message.includes("conflict")) {
    return "publication-conflict";
  }

  return "generate-error";
}

export async function generateRotation(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const { profile, context } = await requireRotationContext(formData, weekStart);
  const adminSupabase = createSupabaseAdminClient();
  const requestId = String(formData.get("request_id") ?? "");

  try {
    const { data: expectedState, error: prepareError } = await adminSupabase.rpc(
      "prepare_teacher_rotation_publication",
      {
        input_request_id: requestId,
        input_actor_id: profile.id,
        input_cohort_id: context.cohort.id,
        input_week_start: weekStart
      }
    );

    if (prepareError || !expectedState) {
      throw prepareError ?? new Error("Unable to prepare teacher rotation publication.");
    }

    const persistencePlan = buildTeacherRotationPersistencePlan(
      plannerInputFromRotationPublicationSnapshot(expectedState, weekStart)
    );

    const { error: applyError } = await adminSupabase.rpc("apply_teacher_rotation_publication", {
      input_request_id: requestId,
      input_actor_id: profile.id,
      input_cohort_id: context.cohort.id,
      input_week_start: weekStart,
      input_expected_state: expectedState,
      input_desired_assignments: persistencePlan.assignmentUpserts
    });

    if (applyError) {
      throw applyError;
    }
  } catch (error) {
    throwIfRedirect(error);
    redirect(rotationRedirectPath(context, weekStart, rotationPublicationStatus(error)));
  }

  revalidatePath("/admin/rotation");
  revalidatePath("/admin");
  revalidatePath("/student/check-in");
  revalidatePath("/student/grades");
  revalidatePath("/student/weekly-plan");
  revalidatePath("/teacher");
  redirect(rotationRedirectPath(context, weekStart, "generated"));
}

type SessionRosterActionScope = {
  masjidId: string;
  cohortId: string;
  weekStart: string;
};

type SessionRosterActionResult<T> =
  | {
    ok: true;
    data: T;
    history: SessionRosterHistoryResponse;
    published: SessionRosterPublishedResponse;
  }
  | { ok: false; error: SessionRosterActionError; message: string };

async function requireSessionRosterActionContext(input: SessionRosterActionScope) {
  const weekStart = validRotationWeekStart(input.weekStart);
  const { profile } = await requireProfile(["admin"]);
  const adminSupabase = createSupabaseAdminClient();
  const cohort = await assertAdminCanManageCohort({
    adminSupabase,
    admin: profile,
    cohortId: input.cohortId || null
  });

  if (!input.masjidId || cohort.masjid_id !== input.masjidId) {
    throw new Error("session_roster_unauthorized_actor");
  }

  return { adminSupabase, profile, cohort, weekStart };
}

async function sessionRosterReadState(input: {
  adminSupabase: ReturnType<typeof createSupabaseAdminClient>;
  actorId: string;
  cohortId: string;
  weekStart: string;
}) {
  const [historyResult, publishedResult] = await Promise.all([
    input.adminSupabase.rpc("get_session_roster_history", {
      input_actor_id: input.actorId,
      input_cohort_id: input.cohortId,
      input_week_start: input.weekStart
    }),
    input.adminSupabase.rpc("get_current_session_roster", {
      input_actor_id: input.actorId,
      input_cohort_id: input.cohortId,
      input_week_start: input.weekStart
    })
  ]);

  if (historyResult.error || publishedResult.error || !historyResult.data || !publishedResult.data) {
    throw new Error(historyResult.error?.message || publishedResult.error?.message || "Unable to reload the session roster.");
  }

  return {
    history: historyResult.data as SessionRosterHistoryResponse,
    published: publishedResult.data as SessionRosterPublishedResponse
  };
}

async function runSessionRosterAction<T>(
  scope: SessionRosterActionScope,
  operation: (input: Awaited<ReturnType<typeof requireSessionRosterActionContext>>) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>
): Promise<SessionRosterActionResult<T>> {
  try {
    const context = await requireSessionRosterActionContext(scope);
    const result = await operation(context);

    if (result.error || !result.data) {
      const message = result.error?.message || "The session roster action did not return a result.";
      return { ok: false, error: sessionRosterActionError(message), message };
    }

    const state = await sessionRosterReadState({
      adminSupabase: context.adminSupabase,
      actorId: context.profile.id,
      cohortId: context.cohort.id,
      weekStart: context.weekStart
    });
    revalidatePath("/admin/rotation");
    return { ok: true, data: result.data as T, ...state };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the session roster.";
    return { ok: false, error: sessionRosterActionError(message), message };
  }
}

export async function moveSessionRosterStudent(input: SessionRosterActionScope & {
  draftId: string;
  studentId: string;
  sessionGroupId: string | null;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("move_session_roster_student", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_student_id: input.studentId,
      input_session_group_id: input.sessionGroupId,
      input_expected_state_version: input.expectedStateVersion
    })
  );
}

export async function assignSessionRosterPrimaryTeacher(input: SessionRosterActionScope & {
  draftId: string;
  groupId: string;
  primaryTeacherId: string | null;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("assign_session_roster_primary_teacher", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_group_id: input.groupId,
      input_primary_teacher_id: input.primaryTeacherId,
      input_expected_state_version: input.expectedStateVersion
    })
  );
}

export async function reviewSessionRosterDraft(input: SessionRosterActionScope & {
  draftId: string;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("review_session_roster_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_expected_state_version: input.expectedStateVersion
    })
  );
}

export async function publishSessionRosterDraft(input: SessionRosterActionScope & {
  draftId: string;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterPublishedResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("publish_session_roster_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_expected_state_version: input.expectedStateVersion
    })
  );
}

export async function createSessionRosterRevision(input: SessionRosterActionScope & {
  expectedPublishedVersionId: string;
}) {
  return runSessionRosterAction<SessionRosterDraftResponse>(input, ({ adminSupabase, profile, cohort, weekStart }) =>
    adminSupabase.rpc("create_session_roster_revision", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_cohort_id: cohort.id,
      input_week_start: weekStart,
      input_expected_published_version_id: input.expectedPublishedVersionId
    })
  );
}

export async function refreshSessionRosterDraft(input: SessionRosterActionScope & {
  draftId: string;
  expectedStateVersion: number;
  expectedSourceStateDigest: string;
  expectedPublishedVersionId: string | null;
  confirmDiscardChanges: boolean;
}) {
  return runSessionRosterAction<RefreshSessionRosterDraftResponse>(input, ({ adminSupabase, profile, cohort, weekStart }) =>
    adminSupabase.rpc("refresh_session_roster_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_cohort_id: cohort.id,
      input_week_start: weekStart,
      input_draft_id: input.draftId,
      input_expected_state_version: input.expectedStateVersion,
      input_expected_source_state_digest: input.expectedSourceStateDigest,
      input_expected_published_version_id: input.expectedPublishedVersionId,
      input_confirm_discard_changes: input.confirmDiscardChanges
    })
  );
}

export async function loadOrCreateSessionRosterWizardDraft(input: SessionRosterActionScope) {
  return runSessionRosterAction<SessionRosterWizardDraftResponse>(input, ({ adminSupabase, profile, cohort, weekStart }) =>
    adminSupabase.rpc("load_or_create_session_roster_wizard_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_cohort_id: cohort.id,
      input_week_start: weekStart
    })
  );
}

export async function generateSessionRosterWizardGroups(input: SessionRosterActionScope & {
  draftId: string;
  expectedStateVersion: number;
  expectedDependencyDigest: string;
  targetGroupCount?: number | null;
  confirmGroupCountMismatch?: boolean;
  confirmDiscardChanges: boolean;
}) {
  return runSessionRosterAction<SessionRosterWizardDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("generate_session_roster_wizard_groups_v2", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_expected_state_version: input.expectedStateVersion,
      input_expected_dependency_digest: input.expectedDependencyDigest,
      input_target_group_count: input.targetGroupCount ?? null,
      input_confirm_group_count_mismatch: input.confirmGroupCountMismatch ?? false,
      input_confirm_discard_changes: input.confirmDiscardChanges
    })
  );
}

export async function moveSessionRosterWizardStudent(input: SessionRosterActionScope & {
  draftId: string;
  studentId: string;
  sessionGroupSlotId: string | null;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterWizardDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("move_session_roster_wizard_student", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_student_id: input.studentId,
      input_session_group_slot_id: input.sessionGroupSlotId,
      input_expected_state_version: input.expectedStateVersion
    })
  );
}

export async function assignSessionRosterWizardPrimaryTeacher(input: SessionRosterActionScope & {
  draftId: string;
  sessionGroupSlotId: string;
  primaryTeacherId: string | null;
  expectedStateVersion: number;
  confirmMismatch: boolean;
}) {
  return runSessionRosterAction<SessionRosterWizardDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("assign_session_roster_wizard_primary_teacher", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_session_group_slot_id: input.sessionGroupSlotId,
      input_primary_teacher_id: input.primaryTeacherId,
      input_expected_state_version: input.expectedStateVersion,
      input_confirm_mismatch: input.confirmMismatch
    })
  );
}

export async function reviewSessionRosterWizardDraft(input: SessionRosterActionScope & {
  draftId: string;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterWizardDraftResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("review_session_roster_wizard_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_expected_state_version: input.expectedStateVersion
    })
  );
}

export async function publishSessionRosterWizardDraft(input: SessionRosterActionScope & {
  draftId: string;
  expectedStateVersion: number;
}) {
  return runSessionRosterAction<SessionRosterWizardPublishedResponse>(input, ({ adminSupabase, profile }) =>
    adminSupabase.rpc("publish_session_roster_wizard_draft_v2", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_draft_id: input.draftId,
      input_expected_state_version: input.expectedStateVersion,
      input_confirm_publish: true
    })
  );
}

export async function createSessionRosterWizardRevision(input: SessionRosterActionScope & {
  expectedPublishedVersionId: string;
}) {
  return runSessionRosterAction<SessionRosterWizardDraftResponse>(input, ({ adminSupabase, profile, cohort, weekStart }) =>
    adminSupabase.rpc("create_session_roster_wizard_revision", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_cohort_id: cohort.id,
      input_week_start: weekStart,
      input_expected_published_version_id: input.expectedPublishedVersionId
    })
  );
}

export async function previewSessionRosterWizardLegacyTransition(input: SessionRosterActionScope) {
  return runSessionRosterAction<SessionRosterWizardLegacyTransitionPreviewResponse>(input, ({ adminSupabase, profile, cohort, weekStart }) =>
    adminSupabase.rpc("preview_session_roster_wizard_legacy_transition", {
      input_actor_id: profile.id,
      input_cohort_id: cohort.id,
      input_week_start: weekStart
    })
  );
}

export async function transitionSessionRosterWizardLegacyDraft(input: SessionRosterActionScope & {
  legacyDraftId: string;
  expectedLegacyStateVersion: number;
  expectedLegacySourceStateDigest: string;
  expectedPublishedVersionId: string | null;
  confirmDiscardLegacyDraft: true;
}) {
  return runSessionRosterAction<SessionRosterWizardLegacyTransitionResponse>(input, ({ adminSupabase, profile, cohort, weekStart }) =>
    adminSupabase.rpc("transition_session_roster_wizard_legacy_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: profile.id,
      input_cohort_id: cohort.id,
      input_week_start: weekStart,
      input_expected_legacy_draft_id: input.legacyDraftId,
      input_expected_legacy_state_version: input.expectedLegacyStateVersion,
      input_expected_legacy_source_state_digest: input.expectedLegacySourceStateDigest,
      input_expected_published_version_id: input.expectedPublishedVersionId,
      input_confirm_discard_legacy_draft: input.confirmDiscardLegacyDraft
    })
  );
}
