"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assertAdminCanManageGroup,
  assertAdminCanManageMasjid,
  canAdminDeleteStudent,
  canAdminManageStudentForWeek,
  requireScopedAdmin
} from "@/lib/admin-scope";
import {
  adminScopeStatusForError,
  assertSelectedStudentScopeMatchesResolved
} from "@/lib/admin-scope-rules";
import { buildAdminUserCreateInput, scopedUserSetupFailureSearchParams } from "@/lib/admin-users";
import { normalizeNote } from "@/lib/checkins";
import { isValidDateString, todayDateString, weekStartForDate } from "@/lib/dates";
import { PARTNER_RECITATION_ROUNDS, parsePartnerRecitationRounds, partnerRecitationPayloads } from "@/lib/partner-recitations";
import { HALAQA_ATTENDANCE_POINTS } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import {
  createScopedUserTransactionally,
  scopedUserSetupAuthMetadata,
  scopedUserSetupLookupRpcArguments,
  scopedUserSetupRpcArguments,
  scopedUserSetupStatusForOutcome,
  type ScopedUserSetupResult
} from "@/lib/transactional-workflows";
import type { PartnerRecitation } from "@/lib/types";
import { WEEKLY_PLAN_BUCKET, weeklyPlanPathBelongsToStudent } from "@/lib/weekly-plans";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adminStudentStatusPath(studentId: string, status: string, weekStart?: string) {
  const params = new URLSearchParams({ status });

  if (weekStart) {
    params.set("week", weekStart);
  }

  return `/admin/students/${studentId}?${params.toString()}`;
}

function formString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function createUser(formData: FormData) {
  const { adminSupabase, profile } = await requireScopedAdmin();
  const createUserPath = profile.role === "super_admin" && formString(formData.get("return_to")) === "super_admin"
    ? "/super-admin/people/new"
    : "/admin/students/new";

  let input: ReturnType<typeof buildAdminUserCreateInput>;

  try {
    input = buildAdminUserCreateInput({
      name: formData.get("name"),
      phone: formData.get("phone"),
      role: formData.get("role")
    });
  } catch {
    redirect(`${createUserPath}?status=invalid`);
  }

  const today = todayDateString();
  const startsOn = weekStartForDate(today);
  const submittedScoreStartsOn = formString(formData.get("score_starts_on"));
  const selectedStudentMasjidId = formString(formData.get("student_masjid_id"));
  const selectedStudentCohortId = formString(formData.get("student_cohort_id"));
  const selectedStudentGroupId = formString(formData.get("student_group_id"));
  const selectedTeacherMasjidId = formString(formData.get("teacher_masjid_id"));
  let setupMasjidId: string | null = null;
  let studentGroupId: string | null = null;

  try {
    if (input.role === "teacher") {
      const masjid = await assertAdminCanManageMasjid({
        adminSupabase,
        admin: profile,
        masjidId: selectedTeacherMasjidId,
        effectiveDate: today
      });
      setupMasjidId = masjid.id;
    }

    if (input.role === "student") {
      const group = await assertAdminCanManageGroup({
        adminSupabase,
        admin: profile,
        groupId: selectedStudentGroupId,
        effectiveDate: today
      });

      assertSelectedStudentScopeMatchesResolved(
        {
          masjidId: selectedStudentMasjidId,
          cohortId: selectedStudentCohortId,
          groupId: selectedStudentGroupId
        },
        {
          masjidId: group.masjid.id,
          cohortId: group.cohort.id,
          groupId: group.id
        }
      );

      setupMasjidId = group.masjid.id;
      studentGroupId = group.id;
    }
  } catch (error) {
    const params = new URLSearchParams({ status: adminScopeStatusForError(error), role: input.role });
    redirect(`${createUserPath}?${params.toString()}`);
  }

  if (input.role !== "student" && input.role !== "teacher") {
    redirect(`${createUserPath}?status=invalid`);
  }

  if (!setupMasjidId || (input.role === "student" && !studentGroupId)) {
    redirect(`${createUserPath}?status=missing-scope&role=${input.role}`);
  }

  const scoreStartsOn = input.role === "student" ? submittedScoreStartsOn : null;
  if (
    input.role === "student"
    && (
      !scoreStartsOn
      || !isValidDateString(scoreStartsOn)
      || weekStartForDate(scoreStartsOn) !== scoreStartsOn
      || scoreStartsOn < startsOn
    )
  ) {
    const params = new URLSearchParams({ status: "invalid-score-start", role: input.role });
    redirect(`${createUserPath}?${params.toString()}`);
  }

  const requestIdValue = formString(formData.get("request_id"));
  const requestId = requestIdValue && UUID_PATTERN.test(requestIdValue) ? requestIdValue : randomUUID();
  const outcome = await createScopedUserTransactionally(
    {
      requestId,
      actorId: profile.id,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      startsOn,
      scoreStartsOn,
      masjidId: setupMasjidId,
      groupId: studentGroupId
    },
    {
      lookupCompletedSetup: async (setupInput) => {
        const { data, error } = await adminSupabase.rpc(
          "get_scoped_user_setup_request_result",
          scopedUserSetupLookupRpcArguments(setupInput)
        );

        return { data: data as ScopedUserSetupResult | null, error };
      },
      createAuthUser: async () => {
        const { data: existingProfiles, error: existingProfileError } = await adminSupabase
          .from("profiles")
          .select("id")
          .or(`email.eq.${input.email},phone.eq.${input.phone}`)
          .limit(1)
          .returns<Array<{ id: string }>>();

        if (existingProfileError) {
          return { data: null, error: existingProfileError };
        }

        if (existingProfiles?.length) {
          return {
            data: null,
            error: { code: "email_exists", message: "An account already exists.", status: 422 }
          };
        }

        const { data, error } = await adminSupabase.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true,
          app_metadata: scopedUserSetupAuthMetadata({
            requestId,
            actorId: profile.id,
            name: input.name,
            email: input.email,
            phone: input.phone,
            role: input.role as "student" | "teacher",
            startsOn,
            scoreStartsOn,
            masjidId: setupMasjidId,
            groupId: studentGroupId
          })
        });

        return { data: data.user ? { id: data.user.id } : null, error };
      },
      recoverAuthOnlySetup: async (setupInput) => {
        const { data, error } = await adminSupabase.rpc(
          "get_scoped_user_setup_auth_recovery",
          scopedUserSetupLookupRpcArguments(setupInput)
        );

        return { data: typeof data === "string" ? { id: data } : null, error };
      },
      applyScopedUserSetup: async (profileId, setupInput) => {
        const { data, error } = await adminSupabase.rpc(
          "apply_scoped_user_setup",
          scopedUserSetupRpcArguments(profileId, setupInput)
        );

        return { data: data as ScopedUserSetupResult | null, error };
      },
      isScopedUserSetupCommitted: async (profileId) => {
        const { data, error } = await adminSupabase
          .from("profiles")
          .select("id")
          .eq("id", profileId)
          .maybeSingle<{ id: string }>();

        return { data: data?.id === profileId, error };
      },
      waitBeforeVerification: async (attempt) => {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      },
      deleteAuthUser: async (profileId) => {
        const { error } = await adminSupabase.auth.admin.deleteUser(profileId);
        return { error };
      }
    }
  );

  if (!outcome.ok) {
    if (outcome.stage === "database" && (outcome.cleanup === "failed" || outcome.uncertain)) {
      console.error("Scoped user setup requires operator review.", {
        requestId,
        profileId: outcome.profileId,
        setupErrorCode: outcome.error.code ?? null,
        cleanupErrorCode: outcome.cleanupError?.code ?? null,
        uncertain: outcome.uncertain
      });
    } else if (outcome.stage === "auth" && outcome.authErrorKind !== "exists") {
      console.error("Auth user creation did not complete normally.", {
        requestId,
        authErrorCode: outcome.error.code ?? null,
        authErrorKind: outcome.authErrorKind
      });
    } else if (outcome.stage === "lookup") {
      console.error("Scoped setup request lookup failed.", {
        requestId,
        lookupErrorCode: outcome.error.code ?? null,
        uncertain: outcome.uncertain
      });
    }

    const params = scopedUserSetupFailureSearchParams({
      status: scopedUserSetupStatusForOutcome(outcome),
      requestId,
      role: input.role,
      studentMasjidId: selectedStudentMasjidId,
      studentCohortId: selectedStudentCohortId,
      studentGroupId: selectedStudentGroupId,
      teacherMasjidId: selectedTeacherMasjidId,
      scoreStartsOn
    });
    redirect(`${createUserPath}?${params.toString()}`);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  revalidatePath("/super-admin");
  revalidatePath("/super-admin/people");
  const params = new URLSearchParams({ status: "created", role: input.role });

  if (input.role === "student") {
    params.set("student", outcome.profileId);
  }

  redirect(`${createUserPath}?${params.toString()}`);
}

export async function correctCheckIn(formData: FormData) {
  const { supabase } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const status = String(formData.get("status") ?? "submitted");
  const redirectWeek = String(formData.get("redirect_week") ?? "");
  const note = normalizeNote(formData.get("note"));
  const completedTaskKeys = formData.getAll("task_keys").filter((value): value is string => typeof value === "string");

  if (
    !studentId
    || !isValidDateString(date)
    || !["submitted", "missing"].includes(status)
  ) {
    redirect("/admin?status=invalid-correction");
  }

  if (date > todayDateString()) {
    redirect(adminStudentStatusPath(studentId, "correction-future-date", redirectWeek));
  }

  const correctionWeekStart = weekStartForDate(date);
  const canManageStudent = await canAdminManageStudentForWeek(supabase, studentId, correctionWeekStart);

  if (!canManageStudent) {
    redirect("/admin?status=student-scope-denied");
  }

  const { error } = await supabase.rpc("apply_admin_checkin_correction", {
    input_student_id: studentId,
    input_date: date,
    input_status: status,
    input_note: note,
    input_completed_task_keys: completedTaskKeys
  });

  if (error) {
    redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(adminStudentStatusPath(studentId, "corrected", redirectWeek));
}

export async function correctPartnerRecitations(formData: FormData) {
  const { supabase } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const weekStart = String(formData.get("week_start") ?? "");
  const redirectWeek = String(formData.get("redirect_week") ?? weekStart);

  if (!studentId || !isValidDateString(weekStart) || weekStartForDate(weekStart) !== weekStart) {
    redirect("/admin?status=invalid-partner-correction");
  }

  let completedRounds: PartnerRecitation["round"][];

  try {
    completedRounds = parsePartnerRecitationRounds(formData.getAll("completed_rounds"));
  } catch {
    redirect(adminStudentStatusPath(studentId, "partner-correction-invalid", redirectWeek || weekStart));
  }

  const canManageStudent = await canAdminManageStudentForWeek(supabase, studentId, weekStart);

  if (!canManageStudent) {
    redirect("/admin?status=student-scope-denied");
  }

  const { data: existingRecitations, error: existingError } = await supabase
    .from("partner_recitations")
    .select("round")
    .eq("student_id", studentId)
    .eq("week_start", weekStart)
    .returns<Array<Pick<PartnerRecitation, "round">>>();

  if (existingError) {
    redirect(adminStudentStatusPath(studentId, "partner-correction-error", redirectWeek || weekStart));
  }

  const completedRoundSet = new Set(completedRounds);
  const existingRoundSet = new Set((existingRecitations ?? []).map((recitation) => recitation.round));
  const roundsToDelete = PARTNER_RECITATION_ROUNDS.filter(
    (round) => existingRoundSet.has(round) && !completedRoundSet.has(round)
  );
  const roundsToInsert = completedRounds.filter((round) => !existingRoundSet.has(round));

  if (roundsToDelete.length) {
    const { error } = await supabase
      .from("partner_recitations")
      .delete()
      .eq("student_id", studentId)
      .eq("week_start", weekStart)
      .in("round", roundsToDelete);

    if (error) {
      redirect(adminStudentStatusPath(studentId, "partner-correction-error", redirectWeek || weekStart));
    }
  }

  if (roundsToInsert.length) {
    const { error } = await supabase.from("partner_recitations").upsert(
      partnerRecitationPayloads({
        studentId,
        weekStart,
        rounds: roundsToInsert
      }),
      { onConflict: "student_id,week_start,round", ignoreDuplicates: true }
    );

    if (error) {
      redirect(adminStudentStatusPath(studentId, "partner-correction-error", redirectWeek || weekStart));
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(adminStudentStatusPath(studentId, "partner-corrected", redirectWeek || weekStart));
}

export async function saveHalaqaGrade(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const weekStart = String(formData.get("week_start") ?? "");
  const redirectWeek = String(formData.get("redirect_week") ?? "");
  const attended = formData.get("attended") === "true";
  const recitationPointsValue = Number(formData.get("recitation_points") ?? 0);
  const notes = normalizeNote(formData.get("notes"));

  if (!studentId || !weekStart) {
    redirect("/admin?status=invalid-grade");
  }

  const canManageStudent = await canAdminManageStudentForWeek(supabase, studentId, weekStart);

  if (!canManageStudent) {
    redirect("/admin?status=student-scope-denied");
  }

  if (attended && (!Number.isFinite(recitationPointsValue) || recitationPointsValue < 10 || recitationPointsValue > 50)) {
    redirect(adminStudentStatusPath(studentId, "grade-invalid", redirectWeek || weekStart));
  }

  const grade = {
    attended,
    attendance_points: attended ? HALAQA_ATTENDANCE_POINTS : 0,
    recitation_points: attended ? recitationPointsValue : 0
  };

  const now = new Date().toISOString();
  const { error } = await supabase.from("halaqa_grades").upsert(
    {
      student_id: studentId,
      week_start: weekStart,
      attended: grade.attended,
      attendance_points: grade.attendance_points,
      recitation_points: grade.recitation_points,
      notes,
      graded_by: profile.id,
      graded_at: now,
      updated_at: now
    },
    { onConflict: "student_id,week_start" }
  );

  if (error) {
    redirect(adminStudentStatusPath(studentId, "grade-error", redirectWeek || weekStart));
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  redirect(adminStudentStatusPath(studentId, "grade-saved", redirectWeek || weekStart));
}

export async function deleteStudent(formData: FormData) {
  const { supabase } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const confirmationName = String(formData.get("confirmation_name") ?? "").trim();

  if (!studentId || !confirmationName) {
    redirect("/admin?status=invalid-delete");
  }

  const { data: student } = await supabase
    .from("profiles")
    .select("id,name,role")
    .eq("id", studentId)
    .eq("role", "student")
    .maybeSingle<{ id: string; name: string; role: "student" }>();

  if (!student) {
    redirect("/admin?status=student-delete-missing");
  }

  if (confirmationName !== student.name) {
    redirect(`/admin/students/${student.id}?status=delete-name-mismatch`);
  }

  const canManageStudent = await canAdminManageStudentForWeek(supabase, student.id, weekStartForDate(todayDateString()));

  if (!canManageStudent) {
    redirect("/admin?status=student-scope-denied");
  }

  if (!(await canAdminDeleteStudent(supabase, student.id))) {
    redirect("/admin?status=student-scope-denied");
  }

  const adminSupabase = createSupabaseAdminClient();
  const { data: weeklyPlans, error: weeklyPlansError } = await adminSupabase
    .from("weekly_plans")
    .select("file_path,week_start")
    .eq("student_id", student.id)
    .returns<Array<{ file_path: string; week_start: string }>>();

  if (weeklyPlansError) {
    redirect(`/admin/students/${student.id}?status=student-delete-error`);
  }

  const hasUnsafeWeeklyPlanPath = (weeklyPlans ?? []).some(
    (plan) => !weeklyPlanPathBelongsToStudent(student.id, plan.week_start, plan.file_path)
  );

  if (hasUnsafeWeeklyPlanPath) {
    redirect(`/admin/students/${student.id}?status=student-delete-error`);
  }

  const weeklyPlanPaths = [
    ...new Set(
      (weeklyPlans ?? []).map((plan) => plan.file_path)
    )
  ];

  const { error } = await adminSupabase.auth.admin.deleteUser(student.id);

  if (error) {
    redirect(`/admin/students/${student.id}?status=student-delete-error`);
  }

  // Delete Auth/profile data first. If a restrictive FK or a concurrent scope
  // change blocks the identity deletion, weekly-plan objects must remain intact
  // for the still-live metadata rows.
  if (weeklyPlanPaths.length) {
    const { data: removedObjects, error: storageError } = await adminSupabase.storage
      .from(WEEKLY_PLAN_BUCKET)
      .remove(weeklyPlanPaths);

    if (storageError || removedObjects.length !== weeklyPlanPaths.length) {
      console.warn("Student identity deleted, but weekly-plan Storage cleanup was incomplete.", {
        studentId: student.id,
        weeklyPlanPaths,
        removedObjectCount: removedObjects?.length ?? 0,
        storageError: storageError?.message ?? null
      });
      revalidatePath("/admin");
      redirect("/admin?status=student-deleted-storage-cleanup-warning");
    }
  }

  revalidatePath("/admin");
  redirect("/admin?status=student-deleted");
}
