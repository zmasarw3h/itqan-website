"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canAdminManageStudentForWeek, requireScopedAdmin } from "@/lib/admin-scope";
import { isCanonicalScoringSunday, parseOfficialScoringChangePreview } from "@/lib/official-scoring";
import { todayDateString, weekStartForDate } from "@/lib/dates";
import type { Profile } from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function workflowPath(studentId: string, input?: { proposed?: string; status?: string; returnTo?: string }) {
  const params = new URLSearchParams();

  if (input?.proposed) params.set("proposed", input.proposed);
  if (input?.status) params.set("status", input.status);
  if (input?.returnTo === "super_admin") params.set("return_to", "super_admin");

  const query = params.toString();
  return `/admin/students/${studentId}/official-scoring${query ? `?${query}` : ""}`;
}

async function requireCurrentStudentScope(
  studentId: string,
  returnTo: string,
  proposed?: string
) {
  const auth = await requireScopedAdmin();
  const currentWeekStart = weekStartForDate(todayDateString());
  const canManage = await canAdminManageStudentForWeek(auth.supabase, studentId, currentWeekStart);

  if (!canManage) {
    redirect(workflowPath(studentId, { proposed, status: "scope-denied", returnTo }));
  }

  return auth;
}

export async function reviewOfficialScoringStart(formData: FormData) {
  const studentId = formString(formData, "student_id");
  const proposed = formString(formData, "score_starts_on");
  const returnTo = formString(formData, "return_to");

  if (!UUID_PATTERN.test(studentId) || !isCanonicalScoringSunday(proposed)) {
    redirect(workflowPath(studentId, { status: "invalid-date", returnTo }));
  }

  const { adminSupabase, profile } = await requireCurrentStudentScope(studentId, returnTo, proposed);
  const { data, error } = await adminSupabase.rpc("preview_official_scoring_start_change", {
    input_actor_id: profile.id,
    input_student_id: studentId,
    input_score_starts_on: proposed
  });

  if (error || !parseOfficialScoringChangePreview(data)) {
    redirect(workflowPath(studentId, {
      status: error?.code === "42501" ? "scope-denied" : "invalid-date",
      returnTo
    }));
  }

  redirect(workflowPath(studentId, { proposed, returnTo }));
}

export async function applyOfficialScoringStart(formData: FormData) {
  const studentId = formString(formData, "student_id");
  const requestId = formString(formData, "request_id");
  const proposed = formString(formData, "score_starts_on");
  const expectedValue = formString(formData, "expected_score_starts_on");
  const expected = expectedValue || null;
  const reason = formString(formData, "reason");
  const confirmationName = formString(formData, "confirmation_name");
  const returnTo = formString(formData, "return_to");

  if (
    !UUID_PATTERN.test(studentId)
    || !UUID_PATTERN.test(requestId)
    || !isCanonicalScoringSunday(proposed)
    || (expected !== null && !isCanonicalScoringSunday(expected))
    || reason.length < 5
    || reason.length > 500
  ) {
    redirect(workflowPath(studentId, { proposed, status: "invalid", returnTo }));
  }

  const { adminSupabase, profile } = await requireCurrentStudentScope(studentId, returnTo, proposed);
  const { data: student } = await adminSupabase
    .from("profiles")
    .select("id,name,role,score_starts_on")
    .eq("id", studentId)
    .single<Pick<Profile, "id" | "name" | "role" | "score_starts_on">>();

  if (!student || student.role !== "student") {
    redirect(workflowPath(studentId, { proposed, status: "invalid", returnTo }));
  }

  if (confirmationName !== student.name) {
    redirect(workflowPath(studentId, { proposed, status: "confirmation-mismatch", returnTo }));
  }

  const { error } = await adminSupabase.rpc("apply_official_scoring_start_change", {
    input_request_id: requestId,
    input_actor_id: profile.id,
    input_student_id: studentId,
    input_score_starts_on: proposed,
    input_expected_score_starts_on: expected,
    input_reason: reason
  });

  if (error) {
    const status = error.code === "P0001"
      ? "stale"
      : error.code === "42501"
        ? "scope-denied"
        : "save-error";
    redirect(workflowPath(studentId, { proposed, status, returnTo }));
  }

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath(`/super-admin/people/${studentId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/leaderboard");
  revalidatePath("/admin/rewards");

  const destination = returnTo === "super_admin"
    ? `/super-admin/people/${studentId}?status=score-start-changed`
    : `/admin/students/${studentId}?status=score-start-changed`;
  redirect(destination);
}
