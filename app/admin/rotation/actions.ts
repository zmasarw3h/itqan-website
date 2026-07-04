"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ensureTargetRotationGroups,
  loadActiveRotationGroups,
  loadActiveRotationTeachers,
  loadPriorTeacherAssignments,
  loadRotationSettings,
  loadRotationStudents,
  resolveAdminBrothersRotationContext,
  rotationRedirectPath,
  validRotationWeekStart
} from "@/app/admin/rotation/data";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import {
  balanceStudentsIntoGroups,
  buildTeacherRotationPersistencePlan,
  planBalancedMembershipChanges
} from "@/lib/teacher-rotation";

function positiveInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function requireRotationContext() {
  const { supabase, profile } = await requireProfile(["admin"]);
  const context = await resolveAdminBrothersRotationContext(supabase);

  if (!context) {
    redirect(rotationRedirectPath(validRotationWeekStart(undefined), "unauthorized"));
  }

  return { profile, context };
}

export async function saveRotationSettings(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const targetGroupCount = positiveInteger(formData.get("target_group_count"));

  if (!targetGroupCount) {
    redirect(rotationRedirectPath(weekStart, "invalid"));
  }

  const { profile, context } = await requireRotationContext();
  const adminSupabase = createSupabaseAdminClient();
  const activeGroups = await loadActiveRotationGroups(adminSupabase, context.cohort.id);

  if (targetGroupCount < activeGroups.length) {
    redirect(rotationRedirectPath(weekStart, "target-below-active-groups"));
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
    redirect(rotationRedirectPath(weekStart, "save-error"));
  }

  revalidatePath("/admin/rotation");
  redirect(rotationRedirectPath(weekStart, "settings-saved"));
}

export async function saveTeacherAvailability(formData: FormData) {
  const weekStart = validRotationWeekStart(String(formData.get("week_start") ?? ""));
  const { profile, context } = await requireRotationContext();
  const adminSupabase = createSupabaseAdminClient();
  const teachers = await loadActiveRotationTeachers({ adminSupabase, context, weekStart });

  if (teachers.length === 0) {
    redirect(rotationRedirectPath(weekStart, "setup-incomplete"));
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
    redirect(rotationRedirectPath(weekStart, "save-error"));
  }

  revalidatePath("/admin/rotation");
  redirect(rotationRedirectPath(weekStart, "availability-saved"));
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
  const { profile, context } = await requireRotationContext();
  const adminSupabase = createSupabaseAdminClient();
  const settings = await loadRotationSettings(adminSupabase, context);

  if (!settings) {
    redirect(rotationRedirectPath(weekStart, "setup-incomplete"));
  }

  try {
    const groups = await ensureTargetRotationGroups({
      adminSupabase,
      cohortId: context.cohort.id,
      targetGroupCount: settings.target_group_count
    });
    const studentData = await loadRotationStudents({ adminSupabase, groups, weekStart });
    const teachers = await loadActiveRotationTeachers({ adminSupabase, context, weekStart });

    if (studentData.students.length === 0 || teachers.length === 0) {
      redirect(rotationRedirectPath(weekStart, "setup-incomplete"));
    }

    const balancedGroups = balanceStudentsIntoGroups(studentData.students, groups);
    const membershipChanges = planBalancedMembershipChanges({
      currentMemberships: studentData.memberships,
      proposedGroups: balancedGroups,
      nextWeekStart: weekStart
    });

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
      membership_closes: membershipChanges.close,
      membership_inserts: membershipChanges.insert,
      membership_replaces: membershipChanges.replace,
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
    redirect(rotationRedirectPath(weekStart, "generate-error"));
  }

  revalidatePath("/admin/rotation");
  revalidatePath("/admin");
  revalidatePath("/student/grades");
  revalidatePath("/student/weekly-plan");
  redirect(rotationRedirectPath(weekStart, "generated"));
}
