"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  loadActiveRotationGroups,
  loadActiveRotationTeachers,
  loadPriorTeacherAssignments,
  loadRotationSettings,
  loadRotationStudents,
  rotationRedirectPath,
  type RotationContext,
  validRotationWeekStart
} from "@/app/admin/rotation/data";
import { assertAdminCanManageCohort } from "@/lib/admin-scope";
import { rotationPath } from "@/lib/rotation-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import { buildTeacherRotationPersistencePlan } from "@/lib/teacher-rotation";

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
    redirect(rotationRedirectPath(context, weekStart, "setup-incomplete"));
  }

  const availableTeacherIds = new Set(
    formData.getAll("available_teacher_id").filter((value): value is string => typeof value === "string")
  );
  const now = new Date().toISOString();
  const rows = teachers.map((teacher) => ({
    teacher_id: teacher.id,
    masjid_id: context.masjid.id,
    cohort_id: context.cohort.id,
    week_start: weekStart,
    available: availableTeacherIds.has(teacher.id),
    created_by: profile.id,
    updated_by: profile.id,
    updated_at: now
  }));
  const { error } = await adminSupabase.from("teacher_rotation_availability").upsert(rows, {
    onConflict: "teacher_id,cohort_id,week_start"
  });

  if (error) {
    redirect(rotationRedirectPath(context, weekStart, "save-error"));
  }

  revalidatePath("/admin/rotation");
  redirect(rotationRedirectPath(context, weekStart, "availability-saved"));
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

export async function generateRotation(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const { profile, context } = await requireRotationContext(formData, weekStart);
  const adminSupabase = createSupabaseAdminClient();
  const settings = await loadRotationSettings(adminSupabase, context);

  if (!settings) {
    redirect(rotationRedirectPath(context, weekStart, "setup-incomplete"));
  }

  try {
    const groups = await loadActiveRotationGroups(adminSupabase, context.cohort.id);
    const studentData = await loadRotationStudents({ adminSupabase, groups, weekStart });
    const teachers = await loadActiveRotationTeachers({ adminSupabase, context, weekStart });

    if (
      groups.length !== settings.target_group_count ||
      studentData.students.length === 0 ||
      teachers.length === 0
    ) {
      redirect(rotationRedirectPath(context, weekStart, "setup-incomplete"));
    }

    const groupIds = groups.map((group) => group.id);
    const priorAssignments = await loadPriorTeacherAssignments({ adminSupabase, groupIds, weekStart });
    const persistencePlan = buildTeacherRotationPersistencePlan({
      groups,
      teachers,
      priorAssignments,
      weekStart
    });

    const { error: applyError } = await adminSupabase.rpc("apply_teacher_rotation_generation", {
      input_cohort_id: context.cohort.id,
      input_week_start: weekStart,
      input_generated_by: profile.id,
      membership_closes: [],
      membership_inserts: [],
      membership_replaces: [],
      assignment_upserts: persistencePlan.assignmentUpserts,
      assignment_deactivations: persistencePlan.assignmentDeactivations,
      available_teacher_count: persistencePlan.run.available_teacher_count,
      group_count: persistencePlan.run.group_count,
      assigned_count: persistencePlan.run.assigned_count,
      warning_count: persistencePlan.run.warning_count
    });

    if (applyError) {
      throw new Error("Unable to apply rotation generation.");
    }
  } catch (error) {
    throwIfRedirect(error);
    redirect(rotationRedirectPath(context, weekStart, "generate-error"));
  }

  revalidatePath("/admin/rotation");
  revalidatePath("/admin");
  revalidatePath("/student/check-in");
  revalidatePath("/student/grades");
  revalidatePath("/student/weekly-plan");
  revalidatePath("/teacher");
  redirect(rotationRedirectPath(context, weekStart, "generated"));
}
