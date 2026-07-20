import { randomUUID } from "node:crypto";
import Link from "next/link";
import AppNav from "@/app/nav";
import { createUser } from "@/app/admin/actions";
import {
  loadAdminCreateUserScopeOptions,
  requireScopedAdmin,
  type AdminCreateUserScopeOptions
} from "@/lib/admin-scope";
import { preservedScopedUserSetupRequestId } from "@/lib/admin-users";
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

function masjidNameById(options: AdminCreateUserScopeOptions) {
  return new Map(options.masjids.map((masjid) => [masjid.id, masjid.name]));
}

function cohortById(options: AdminCreateUserScopeOptions) {
  return new Map(options.cohorts.map((cohort) => [cohort.id, cohort]));
}

function studentDefaults(options: AdminCreateUserScopeOptions) {
  if (options.groups.length === 1) {
    const group = options.groups[0];
    const cohort = options.cohorts.find((candidate) => candidate.id === group.cohort_id);

    return {
      masjidId: cohort?.masjid_id ?? "",
      cohortId: cohort?.id ?? "",
      groupId: group.id
    };
  }

  const masjidId = options.masjids.length === 1 ? options.masjids[0].id : "";
  const cohortsForMasjid = masjidId ? options.cohorts.filter((cohort) => cohort.masjid_id === masjidId) : [];
  const cohortId = cohortsForMasjid.length === 1 ? cohortsForMasjid[0].id : "";
  const groupsForCohort = cohortId ? options.groups.filter((group) => group.cohort_id === cohortId) : [];

  return {
    masjidId,
    cohortId,
    groupId: groupsForCohort.length === 1 ? groupsForCohort[0].id : ""
  };
}

function teacherDefaultMasjidId(options: AdminCreateUserScopeOptions) {
  return options.masjids.length === 1 ? options.masjids[0].id : "";
}

export default async function NewStudentPage({
  searchParams
}: {
  searchParams: Promise<NewStudentSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { adminSupabase, profile } = await requireScopedAdmin();
  const scopeOptions = await loadAdminCreateUserScopeOptions({ adminSupabase, admin: profile });
  const fallbackStudentDefault = studentDefaults(scopeOptions);
  const fallbackTeacherMasjidId = teacherDefaultMasjidId(scopeOptions);
  const masjidNames = masjidNameById(scopeOptions);
  const cohortsById = cohortById(scopeOptions);
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
    : fallbackStudentDefault;
  const teacherMasjidId = preservedRequestId && scopeOptions.masjids.some(
    (masjid) => masjid.id === resolvedSearchParams.teacher_masjid_id
  )
    ? resolvedSearchParams.teacher_masjid_id!
    : fallbackTeacherMasjidId;
  const message = statusMessage(resolvedSearchParams.status, createdRole);

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

        <form action={createUser} className="mt-6 grid gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <input name="request_id" type="hidden" value={preservedRequestId ?? randomUUID()} />
          <label className="block">
            <span className="text-sm font-medium text-ink">Name</span>
            <input
              autoComplete="name"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              name="name"
              required
              type="text"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Phone number</span>
            <input
              autoComplete="tel"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              name="phone"
              required
              type="tel"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Role</span>
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue={createdRole ?? "student"} name="role" required>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>
          </label>
          <fieldset className="grid gap-3 rounded-md border border-stone-200 p-4">
            <legend className="px-1 text-sm font-medium text-ink">Student scope</legend>
            <label className="block">
              <span className="text-sm font-medium text-ink">Masjid</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                defaultValue={studentDefault.masjidId}
                name="student_masjid_id"
              >
                <option value="">Select masjid</option>
                {scopeOptions.masjids.map((masjid) => (
                  <option key={masjid.id} value={masjid.id}>
                    {masjid.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Cohort</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                defaultValue={studentDefault.cohortId}
                name="student_cohort_id"
              >
                <option value="">Select cohort</option>
                {scopeOptions.cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {masjidNames.get(cohort.masjid_id) ?? "Masjid"} / {cohort.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Group</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                defaultValue={studentDefault.groupId}
                name="student_group_id"
              >
                <option value="">Select group</option>
                {scopeOptions.groups.map((group) => {
                  const cohort = cohortsById.get(group.cohort_id);
                  const masjidName = cohort ? masjidNames.get(cohort.masjid_id) : null;

                  return (
                    <option key={group.id} value={group.id}>
                      {masjidName ?? "Masjid"} / {cohort?.name ?? "Cohort"} / {group.name}
                    </option>
                  );
                })}
              </select>
            </label>
          </fieldset>
          <fieldset className="grid gap-3 rounded-md border border-stone-200 p-4">
            <legend className="px-1 text-sm font-medium text-ink">Teacher scope</legend>
            <label className="block">
              <span className="text-sm font-medium text-ink">Masjid</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                defaultValue={teacherMasjidId}
                name="teacher_masjid_id"
              >
                <option value="">Select masjid</option>
                {scopeOptions.masjids.map((masjid) => (
                  <option key={masjid.id} value={masjid.id}>
                    {masjid.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <div>
            <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
              Create user
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
