import { randomUUID } from "node:crypto";
import Link from "next/link";
import AppNav from "@/app/nav";
import { createUser } from "@/app/admin/actions";
import AddUserForm from "@/app/admin/students/new/add-user-form";
import { loadAdminCreateUserScopeOptions, requireScopedAdmin } from "@/lib/admin-scope";
import { resolveStudentScope, resolveTeacherMasjidId } from "@/lib/admin-user-scope";
import { preservedScopedUserSetupRequestId } from "@/lib/admin-users";
import { addDays, todayDateString, weekStartForDate } from "@/lib/dates";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

type NewStudentSearchParams = {
  status?: string;
  student?: string;
  role?: string;
  request_id?: string;
  student_masjid_id?: string;
  student_cohort_id?: string;
  student_group_id?: string;
  teacher_masjid_id?: string;
  score_starts_on?: string;
};

function statusMessage(status: string | undefined, role: Role | undefined) {
  switch (status) {
    case "created": {
      const userLabel = role === "teacher" ? "Teacher" : "Student";
      return {
        tone: "success",
        text: `${userLabel} created. They can now log in with their phone number and password itqan2026.`
      };
    }
    case "exists":
      return { tone: "error", text: "A user with that phone number already exists." };
    case "invalid":
      return { tone: "error", text: "Enter a valid user name, phone number, and role." };
    case "invalid-score-start":
      return { tone: "error", text: "Choose a Sunday first-scored week that is not before the student's access begins." };
    case "missing-scope":
      return { tone: "error", text: "Choose an active masjid, cohort, and group for students or an active masjid for teachers." };
    case "invalid-scope":
      return { tone: "error", text: "That scope is inactive, mismatched, or outside your admin access." };
    case "profile-error":
      return { tone: "error", text: "The auth user was created, but the profile could not be saved. Check Supabase and try again." };
    case "assignment-error":
      return {
        tone: "error",
        text: "The user was created, but scoped access could not be assigned. Check the masjid, cohort, and group setup before they log in."
      };
    case "setup-error":
      return {
        tone: "error",
        text: "Account setup was rejected. Check the selected scope and try again."
      };
    case "setup-cleanup-error":
      return {
        tone: "error",
        text: "Account setup failed and login cleanup could not be confirmed. Contact a super admin before retrying."
      };
    case "setup-uncertain":
      return {
        tone: "error",
        text: "Account setup may have completed, but confirmation was lost. Re-enter the same name and phone number without changing the role or scope, then submit once to recover the original request."
      };
    case "auth-error":
      return {
        tone: "error",
        text: "The login service rejected account creation. Check the account details or contact a super admin."
      };
    case "auth-uncertain":
      return {
        tone: "error",
        text: "The login service did not confirm whether the account was created. Re-enter the same name and phone number without changing the role or scope, then submit once to recover the original request."
      };
    default:
      return null;
  }
}

export default async function NewStudentPage({
  searchParams
}: {
  searchParams: Promise<NewStudentSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { adminSupabase, profile } = await requireScopedAdmin();
  const scopeOptions = await loadAdminCreateUserScopeOptions({ adminSupabase, admin: profile });
  const fallbackStudentDefault = resolveStudentScope(scopeOptions);
  const fallbackTeacherMasjidId = resolveTeacherMasjidId(scopeOptions);
  const createdRole: Role | undefined =
    resolvedSearchParams.role === "teacher" || resolvedSearchParams.role === "student" ? resolvedSearchParams.role : undefined;
  const preservedRequestId = preservedScopedUserSetupRequestId(
    resolvedSearchParams.status,
    resolvedSearchParams.request_id
  );
  const retryGroup = preservedRequestId
    ? scopeOptions.groups.find((group) => group.id === resolvedSearchParams.student_group_id)
    : undefined;
  const retryCohort = retryGroup
    ? scopeOptions.cohorts.find(
        (cohort) =>
          cohort.id === resolvedSearchParams.student_cohort_id &&
          cohort.id === retryGroup.cohort_id &&
          cohort.masjid_id === resolvedSearchParams.student_masjid_id
      )
    : undefined;
  const studentDefault = retryGroup && retryCohort
    ? { masjidId: retryCohort.masjid_id, cohortId: retryCohort.id, groupId: retryGroup.id }
    : {
        masjidId: fallbackStudentDefault.masjidId,
        cohortId: fallbackStudentDefault.cohortId,
        groupId: fallbackStudentDefault.groupId
      };
  const teacherMasjidId = preservedRequestId && scopeOptions.masjids.some(
    (masjid) => masjid.id === resolvedSearchParams.teacher_masjid_id
  )
    ? resolvedSearchParams.teacher_masjid_id!
    : fallbackTeacherMasjidId;
  const message = statusMessage(resolvedSearchParams.status, createdRole);
  const currentScoreWeekStart = weekStartForDate(todayDateString());
  const defaultScoreStartsOn = preservedRequestId && resolvedSearchParams.score_starts_on
    ? resolvedSearchParams.score_starts_on
    : addDays(currentScoreWeekStart, 7);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Add User</h1>
          <p className="mt-1 text-stone-600">Create a student or teacher login from a name and phone number.</p>
        </div>

        {message ? (
          <p
            className={
              message.tone === "success"
                ? "mt-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
                : "mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            }
          >
            {message.text}
          </p>
        ) : null}

        {resolvedSearchParams.status === "created" && createdRole === "student" && resolvedSearchParams.student ? (
          <p className="mt-3 text-sm">
            <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${resolvedSearchParams.student}`}>
              Open the new student profile
            </Link>
          </p>
        ) : null}

        {scopeOptions.masjids.length === 0 ? (
          <p className="mt-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No active masjid admin access is available for this account.
          </p>
        ) : null}

        <AddUserForm
          action={createUser}
          initialRole={createdRole ?? "student"}
          initialStudentScope={studentDefault}
          initialTeacherMasjidId={teacherMasjidId}
          initialScoreStartsOn={defaultScoreStartsOn}
          currentScoreWeekStart={currentScoreWeekStart}
          requestId={preservedRequestId ?? randomUUID()}
          scopeOptions={scopeOptions}
        />
      </main>
    </>
  );
}
