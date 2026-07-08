"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assertAdminCanManageGroup,
  assertAdminCanManageMasjid,
  canAdminManageStudentForWeek,
  requireScopedAdmin
} from "@/lib/admin-scope";
import {
  adminScopeStatusForError,
  assertSelectedStudentScopeMatchesResolved
} from "@/lib/admin-scope-rules";
import { buildAdminUserCreateInput } from "@/lib/admin-users";
import { adminCorrectionPayload, checkInItemPayloads, normalizeNote } from "@/lib/checkins";
import { isValidDateString, todayDateString, weekStartForDate } from "@/lib/dates";
import { PARTNER_RECITATION_ROUNDS, parsePartnerRecitationRounds, partnerRecitationPayloads } from "@/lib/partner-recitations";
import { calculateDailySubmission, HALAQA_ATTENDANCE_POINTS } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, PartnerRecitation } from "@/lib/types";
import { WEEKLY_PLAN_BUCKET } from "@/lib/weekly-plans";

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

  let input: ReturnType<typeof buildAdminUserCreateInput>;

  try {
    input = buildAdminUserCreateInput({
      name: formData.get("name"),
      phone: formData.get("phone"),
      role: formData.get("role")
    });
  } catch {
    redirect("/admin/students/new?status=invalid");
  }

  const today = todayDateString();
  const startsOn = weekStartForDate(today);
  let teacherMasjidId: string | null = null;
  let studentGroupId: string | null = null;

  try {
    if (input.role === "teacher") {
      const masjid = await assertAdminCanManageMasjid({
        adminSupabase,
        admin: profile,
        masjidId: formString(formData.get("teacher_masjid_id")),
        effectiveDate: today
      });
      teacherMasjidId = masjid.id;
    }

    if (input.role === "student") {
      const selectedMasjidId = formString(formData.get("student_masjid_id"));
      const selectedCohortId = formString(formData.get("student_cohort_id"));
      const selectedGroupId = formString(formData.get("student_group_id"));
      const group = await assertAdminCanManageGroup({
        adminSupabase,
        admin: profile,
        groupId: selectedGroupId,
        effectiveDate: today
      });

      assertSelectedStudentScopeMatchesResolved(
        {
          masjidId: selectedMasjidId,
          cohortId: selectedCohortId,
          groupId: selectedGroupId
        },
        {
          masjidId: group.masjid.id,
          cohortId: group.cohort.id,
          groupId: group.id
        }
      );

      studentGroupId = group.id;
    }
  } catch (error) {
    const params = new URLSearchParams({ status: adminScopeStatusForError(error), role: input.role });
    redirect(`/admin/students/new?${params.toString()}`);
  }

  const { data: existingProfiles } = await adminSupabase
    .from("profiles")
    .select("id")
    .or(`email.eq.${input.email},phone.eq.${input.phone}`)
    .limit(1)
    .returns<Array<{ id: string }>>();

  if (existingProfiles?.length) {
    redirect("/admin/students/new?status=exists");
  }

  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true
  });

  if (authError || !authData.user) {
    redirect("/admin/students/new?status=exists");
  }

  const { error: profileError } = await adminSupabase.from("profiles").upsert(
    {
      id: authData.user.id,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      active: input.active
    },
    { onConflict: "id" }
  );

  if (profileError) {
    redirect("/admin/students/new?status=profile-error");
  }

  if (input.role === "teacher") {
    if (!teacherMasjidId) {
      redirect("/admin/students/new?status=missing-scope&role=teacher");
    }

    const { error: membershipError } = await adminSupabase.from("masjid_staff_memberships").insert({
      profile_id: authData.user.id,
      masjid_id: teacherMasjidId,
      staff_role: "teacher",
      active: true,
      starts_on: startsOn,
      created_by: profile.id
    });

    if (membershipError) {
      redirect("/admin/students/new?status=assignment-error");
    }
  }

  if (input.role === "student") {
    if (!studentGroupId) {
      redirect("/admin/students/new?status=missing-scope&role=student");
    }

    const { error: membershipError } = await adminSupabase.from("student_group_memberships").insert({
      student_id: authData.user.id,
      group_id: studentGroupId,
      starts_on: startsOn,
      assigned_by: profile.id
    });

    if (membershipError) {
      redirect("/admin/students/new?status=assignment-error");
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  const params = new URLSearchParams({ status: "created", role: input.role });

  if (input.role === "student") {
    params.set("student", authData.user.id);
  }

  redirect(`/admin/students/new?${params.toString()}`);
}

export async function correctCheckIn(formData: FormData) {
  const { supabase, profile } = await requireProfile(["admin"]);
  const studentId = String(formData.get("student_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const status = String(formData.get("status") ?? "submitted");
  const redirectWeek = String(formData.get("redirect_week") ?? "");
  const note = normalizeNote(formData.get("note"));
  const completedTaskKeys = formData.getAll("task_keys").filter((value): value is string => typeof value === "string");

  if (!studentId || !date) {
    redirect("/admin?status=invalid-correction");
  }

  const correctionWeekStart = weekStartForDate(date);
  const canManageStudent = await canAdminManageStudentForWeek(supabase, studentId, correctionWeekStart);

  if (!canManageStudent) {
    redirect("/admin?status=student-scope-denied");
  }

  if (status === "missing") {
    const { error } = await supabase.from("checkins").delete().eq("student_id", studentId).eq("date", date);

    if (error) {
      redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/students/${studentId}`);
    redirect(adminStudentStatusPath(studentId, "corrected", redirectWeek));
  }

  const submission = calculateDailySubmission(date, completedTaskKeys);
  const payload = adminCorrectionPayload({
    adminId: profile.id,
    studentId,
    date,
    completed: true,
    note,
    earnedWeight: submission.earnedWeight,
    totalWeight: submission.totalWeight,
    dailyScore: submission.dailyScore
  });

  const { data: checkin, error } = await supabase
    .from("checkins")
    .upsert(payload, {
      onConflict: "student_id,date"
    })
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .single<CheckIn>();

  if (error || !checkin) {
    redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
  }

  const { error: deleteItemsError } = await supabase.from("checkin_items").delete().eq("checkin_id", checkin.id);

  if (deleteItemsError) {
    redirect(adminStudentStatusPath(studentId, "correction-error", redirectWeek));
  }

  const { error: insertItemsError } = await supabase
    .from("checkin_items")
    .insert(
      checkInItemPayloads({
        checkinId: checkin.id,
        studentId,
        date,
        completedTaskKeys
      })
    );

  if (insertItemsError) {
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

  const adminSupabase = createSupabaseAdminClient();
  const { data: weeklyPlans } = await adminSupabase
    .from("weekly_plans")
    .select("file_path")
    .eq("student_id", student.id)
    .returns<Array<{ file_path: string }>>();
  const weeklyPlanPaths = [...new Set((weeklyPlans ?? []).map((plan) => plan.file_path).filter(Boolean))];

  if (weeklyPlanPaths.length) {
    const { error: storageError } = await adminSupabase.storage.from(WEEKLY_PLAN_BUCKET).remove(weeklyPlanPaths);

    if (storageError) {
      redirect(`/admin/students/${student.id}?status=student-delete-error`);
    }
  }

  const { error } = await adminSupabase.auth.admin.deleteUser(student.id);

  if (error) {
    redirect(`/admin/students/${student.id}?status=student-delete-error`);
  }

  revalidatePath("/admin");
  redirect("/admin?status=student-deleted");
}
