import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createUser } from "@/app/admin/actions";
import AddUserForm from "@/app/admin/students/new/add-user-form";
import AppNav from "@/app/nav";
import { loadAdminCreateUserScopeOptions } from "@/lib/admin-scope";
import { resolveStudentScope, resolveTeacherMasjidId } from "@/lib/admin-user-scope";
import { preservedScopedUserSetupRequestId } from "@/lib/admin-users";
import { addDays, todayDateString, weekStartForDate } from "@/lib/dates";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

type NewPersonSearchParams = {
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
  if (status === "created") return { tone: "success", text: `${role === "teacher" ? "Teacher" : "Student"} account created with its initial scoped access.` };
  if (status === "exists") return { tone: "error", text: "A person with that phone number already exists. Find the existing person and change their access instead." };
  if (status === "invalid") return { tone: "error", text: "Enter a valid name, phone number, and account type." };
  if (status === "invalid-score-start") return { tone: "error", text: "Choose a Sunday first-scored week that is not before the student's access begins." };
  if (status === "missing-scope") return { tone: "error", text: "Choose a complete active scope for this account." };
  if (status === "invalid-scope") return { tone: "error", text: "That masjid, cohort, or group is no longer a valid active scope." };
  if (status === "setup-uncertain" || status === "auth-uncertain") return { tone: "error", text: "Completion could not be confirmed. Keep the same values and submit once to safely verify the original request." };
  if (status) return { tone: "error", text: "Account creation did not complete. Review the selected scope and try again." };
  return null;
}

export default async function NewSuperAdminPersonPage({
  searchParams
}: {
  searchParams: Promise<NewPersonSearchParams>;
}) {
  const params = await searchParams;
  const { adminSupabase, profile } = await requireSuperAdminAdminClient();
  const scopeOptions = await loadAdminCreateUserScopeOptions({ adminSupabase, admin: profile });
  const fallbackStudent = resolveStudentScope(scopeOptions);
  const fallbackTeacherMasjidId = resolveTeacherMasjidId(scopeOptions);
  const createdRole: Role | undefined = params.role === "teacher" || params.role === "student" ? params.role : undefined;
  const preservedRequestId = preservedScopedUserSetupRequestId(params.status, params.request_id);
  const retryGroup = preservedRequestId ? scopeOptions.groups.find((group) => group.id === params.student_group_id) : undefined;
  const retryCohort = retryGroup ? scopeOptions.cohorts.find((cohort) =>
    cohort.id === params.student_cohort_id &&
    cohort.id === retryGroup.cohort_id &&
    cohort.masjid_id === params.student_masjid_id
  ) : undefined;
  const studentScope = retryGroup && retryCohort
    ? { masjidId: retryCohort.masjid_id, cohortId: retryCohort.id, groupId: retryGroup.id }
    : { masjidId: fallbackStudent.masjidId, cohortId: fallbackStudent.cohortId, groupId: fallbackStudent.groupId };
  const teacherMasjidId = preservedRequestId && scopeOptions.masjids.some((masjid) => masjid.id === params.teacher_masjid_id)
    ? params.teacher_masjid_id!
    : fallbackTeacherMasjidId;
  const message = statusMessage(params.status, createdRole);
  const defaultScoreStartsOn = preservedRequestId && params.score_starts_on
    ? params.score_starts_on
    : addDays(weekStartForDate(todayDateString()), 7);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link className="text-sm font-semibold text-moss hover:text-ink" href="/super-admin/people">← Back to people</Link>
        <p className="mt-5 text-sm font-semibold text-gold">People and access</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Create a student or teacher</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
          Create the login, profile, and first scoped membership as one recoverable workflow. Admin capability is added to an existing person through Guided Change so the exact masjid and impact can be reviewed.
        </p>

        {message ? <p className={`mt-6 rounded-lg px-4 py-3 text-sm ${message.tone === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role={message.tone === "success" ? "status" : "alert"}>{message.text}</p> : null}
        {params.status === "created" && params.student ? (
          <Link className="mt-3 inline-block text-sm font-semibold text-moss hover:text-ink" href={`/super-admin/people/${params.student}`}>Open the new person →</Link>
        ) : null}

        {scopeOptions.masjids.length === 0 ? (
          <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Create and activate a masjid before creating scoped accounts.</p>
        ) : null}

        <AddUserForm
          action={createUser}
          initialRole={createdRole ?? "student"}
          initialStudentScope={studentScope}
          initialTeacherMasjidId={teacherMasjidId}
          initialScoreStartsOn={defaultScoreStartsOn}
          requestId={preservedRequestId ?? randomUUID()}
          returnTo="super_admin"
          scopeOptions={scopeOptions}
        />
      </main>
    </>
  );
}
