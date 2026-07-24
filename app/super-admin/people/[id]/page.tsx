import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { correctStudentScoreStart, endStaffMembership, resetPersonPassword } from "@/app/super-admin/actions";
import {
  SUPER_ADMIN_PEOPLE_STATUS_MESSAGES,
  loadPersonDetailData,
  type StaffMembershipDetail,
  type StudentMembershipDetail,
  type TeacherAssignmentDetail
} from "@/app/super-admin/data";
import AppNav from "@/app/nav";
import { formatDateTimeInAppTimeZone, formatWeekRange, todayDateString } from "@/lib/dates";
import { reconcilePersonDetailWithAccessState } from "@/lib/person-access-state";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";
import type { PersonAccessState } from "@/lib/transactional-workflows";
import type { Profile, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

type PersonPageSearchParams = {
  status?: string;
};

function statusFor(value: string | undefined) {
  return value ? SUPER_ADMIN_PEOPLE_STATUS_MESSAGES[value] : null;
}

function roleLabel(role: Role) {
  if (role === "super_admin") return "Super admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function stateClass(active: boolean) {
  return active ? "bg-green-50 text-green-800" : "bg-stone-100 text-stone-600";
}

function membershipState(input: { starts_on: string; ends_on: string | null; active?: boolean }, today = todayDateString()) {
  const activeByDate = input.starts_on <= today && (!input.ends_on || input.ends_on >= today);

  if (input.active === false) return { label: "Inactive", className: "bg-stone-100 text-stone-600" };
  if (activeByDate) return { label: "Current", className: "bg-green-50 text-green-800" };
  if (input.starts_on > today) return { label: "Upcoming", className: "bg-amber-50 text-amber-800" };
  return { label: "Historical", className: "bg-stone-100 text-stone-600" };
}

function dateRange(startsOn: string, endsOn: string | null) {
  return `${startsOn} to ${endsOn ?? "open"}`;
}

function IdentityPanel({ profile, authEmail }: { profile: Profile; authEmail: string | null }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm font-medium text-moss hover:text-ink" href="/super-admin/people">
            Back to people
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-ink">{profile.name}</h1>
          <p className="mt-1 text-stone-600">{profile.phone || profile.email}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${stateClass(profile.active)}`}>
          {profile.active ? "Active" : "Inactive"}
        </span>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-stone-500">Profile role</dt>
          <dd className="mt-1 font-medium text-ink">{roleLabel(profile.role)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Phone</dt>
          <dd className="mt-1 font-medium text-ink">{profile.phone || "None"}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Profile email</dt>
          <dd className="mt-1 break-all font-medium text-ink">{profile.email}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Auth email</dt>
          <dd className="mt-1 break-all font-medium text-ink">{authEmail ?? "Missing"}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Created</dt>
          <dd className="mt-1 font-medium text-ink">{formatDateTimeInAppTimeZone(profile.created_at)}</dd>
        </div>
      </dl>
    </section>
  );
}

function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <h2 className="font-semibold">Setup warnings</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

function StudentMemberships({ memberships }: { memberships: StudentMembershipDetail[] }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Student Group Memberships</h2>
      {memberships.length === 0 ? (
        <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No student memberships.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="py-2 pr-4 font-medium">Masjid</th>
                <th className="py-2 pr-4 font-medium">Cohort</th>
                <th className="py-2 pr-4 font-medium">Group</th>
                <th className="py-2 pr-4 font-medium">Dates</th>
                <th className="py-2 pr-0 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {memberships.map((membership) => {
                const state = membershipState(membership);

                return (
                  <tr key={membership.id}>
                    <td className="py-3 pr-4 font-medium text-ink">{membership.masjid_name}</td>
                    <td className="py-3 pr-4 text-stone-700">{membership.cohort_name}</td>
                    <td className="py-3 pr-4 text-stone-700">{membership.group_name}</td>
                    <td className="py-3 pr-4 text-stone-700">{dateRange(membership.starts_on, membership.ends_on)}</td>
                    <td className="py-3 pr-0">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${state.className}`}>{state.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StaffMembershipCard({
  membership,
  profile,
  expectedState
}: {
  membership: StaffMembershipDetail;
  profile: Profile;
  expectedState: PersonAccessState;
}) {
  const state = membershipState(membership);
  const canEnd = membership.active && membership.ends_on === null;

  return (
    <div className="rounded-md border border-stone-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">
            {membership.masjid_name} / {membership.staff_role === "admin" ? "Admin" : "Teacher"}
          </p>
          <p className="mt-1 text-sm text-stone-600">{dateRange(membership.starts_on, membership.ends_on)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${state.className}`}>{state.label}</span>
      </div>

      {canEnd ? (
        <details className="mt-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-moss hover:text-ink">End membership</summary>
          <form action={endStaffMembership} className="mt-3 grid gap-3 rounded-md bg-stone-50 p-3">
            <input name="person_id" type="hidden" value={profile.id} />
            <input name="membership_id" type="hidden" value={membership.id} />
            <input name="request_id" type="hidden" value={randomUUID()} />
            <input name="expected_state" type="hidden" value={JSON.stringify(expectedState)} />
            <label className="block">
              <span className="text-sm font-medium text-ink">Ends on</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                defaultValue={todayDateString()}
                min={membership.starts_on}
                name="ends_on"
                required
                type="date"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Confirm person name</span>
              <input
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                name="confirmation_name"
                placeholder={profile.name}
                required
              />
            </label>
            {membership.staff_role === "admin" ? (
              <label className="block">
                <span className="text-sm font-medium text-ink">Confirm masjid name</span>
                <input
                  autoComplete="off"
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  name="confirmation_masjid"
                  placeholder={membership.masjid_name}
                  required
                />
              </label>
            ) : null}
            <div>
              <button className="rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">
                End membership
              </button>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function StaffMemberships({
  memberships,
  profile,
  expectedState
}: {
  memberships: StaffMembershipDetail[];
  profile: Profile;
  expectedState: PersonAccessState;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Staff Memberships</h2>
      {memberships.length === 0 ? (
        <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No staff memberships.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {memberships.map((membership) => (
            <StaffMembershipCard
              key={membership.id}
              expectedState={expectedState}
              membership={membership}
              profile={profile}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TeacherAssignments({ assignments }: { assignments: TeacherAssignmentDetail[] }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Current And Upcoming Teacher Assignments</h2>
      {assignments.length === 0 ? (
        <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No current or upcoming assignments.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="py-2 pr-4 font-medium">Week</th>
                <th className="py-2 pr-4 font-medium">Masjid</th>
                <th className="py-2 pr-4 font-medium">Cohort</th>
                <th className="py-2 pr-0 font-medium">Group</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="py-3 pr-4 font-medium text-ink">{formatWeekRange(assignment.week_start)}</td>
                  <td className="py-3 pr-4 text-stone-700">{assignment.masjid_name}</td>
                  <td className="py-3 pr-4 text-stone-700">{assignment.cohort_name}</td>
                  <td className="py-3 pr-0 text-stone-700">{assignment.group_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PasswordResetPanel({ profile }: { profile: Profile }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Password Reset</h2>
      <p className="mt-1 text-sm text-stone-600">
        This does not change their masjid access. Ask them to change it after sign-in.
      </p>
      <form action={resetPersonPassword} className="mt-4 grid gap-4">
        <input name="person_id" type="hidden" value={profile.id} />
        <label className="block">
          <span className="text-sm font-medium text-ink">Temporary password</span>
          <input
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            minLength={8}
            name="temporary_password"
            required
            type="password"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Confirm temporary password</span>
          <input
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            minLength={8}
            name="confirm_temporary_password"
            required
            type="password"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Confirm person name</span>
          <input
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
            name="confirmation_name"
            placeholder={profile.name}
            required
          />
        </label>
        <div>
          <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
            Set temporary password
          </button>
        </div>
      </form>
    </section>
  );
}

function GuidedChangeEntry({ profile }: { profile: Profile }) {
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-green-700">Guided Change</p>
      <h2 className="mt-2 text-lg font-semibold text-ink">Change access safely</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Choose one operation, its exact scope and date, then review every access row that will change or remain unchanged.
      </p>
      <Link
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
        href={`/super-admin/people/${profile.id}/access`}
      >
        Start Guided Change
      </Link>
    </section>
  );
}

function ScoreStartCorrectionPanel({ profile }: { profile: Profile }) {
  if (profile.role !== "student") return null;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">First scored week</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Access and orientation activity remain intact. This Sunday controls which weeks count toward scores,
        streaks, rewards, and Sadaqa obligations.
      </p>
      <p className="mt-3 text-sm text-stone-700">
        Current value: <span className="font-semibold text-ink">{profile.score_starts_on ?? "Not scorable yet"}</span>
      </p>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-moss hover:text-ink">Correct first scored week</summary>
        <form action={correctStudentScoreStart} className="mt-3 grid gap-3 rounded-md bg-amber-50 p-4">
          <input name="person_id" type="hidden" value={profile.id} />
          <input name="expected_score_starts_on" type="hidden" value={profile.score_starts_on ?? ""} />
          <p className="text-sm leading-6 text-amber-950">
            Review the stakeholder-confirmed official start. Moving this boundary can change historical reporting
            and requires a separate reviewed obligation repair.
          </p>
          <label className="block">
            <span className="text-sm font-medium text-ink">Confirmed Sunday</span>
            <input
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              defaultValue={profile.score_starts_on ?? ""}
              name="score_starts_on"
              required
              type="date"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Confirm person name</span>
            <input
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              name="confirmation_name"
              placeholder={profile.name}
              required
            />
          </label>
          <div>
            <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">
              Save audited correction
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}

export default async function SuperAdminPersonPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PersonPageSearchParams>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const data = await loadPersonDetailData(adminSupabase, resolvedParams.id);

  if (!data) {
    notFound();
  }

  const { data: expectedState, error: expectedStateError } = await adminSupabase.rpc("get_person_access_state", {
    input_actor_id: profile.id,
    input_target_profile_id: data.profile.id
  });

  if (expectedStateError || !expectedState) {
    throw new Error("Unable to load the current access state.");
  }

  const canonicalState = expectedState as PersonAccessState;
  const canonicalData = reconcilePersonDetailWithAccessState(data, canonicalState);
  const status = statusFor(resolvedSearchParams.status);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {status ? <p className={`mb-4 rounded-md px-3 py-2 text-sm ${status.className}`}>{status.text}</p> : null}
        <IdentityPanel authEmail={canonicalData.authEmail} profile={canonicalData.profile} />
        <WarningsPanel warnings={canonicalData.warnings} />

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
          <div className="space-y-6">
            <StudentMemberships memberships={canonicalData.studentMemberships} />
            <StaffMemberships
              expectedState={canonicalState}
              memberships={canonicalData.staffMemberships}
              profile={canonicalData.profile}
            />
            <TeacherAssignments assignments={canonicalData.teacherAssignments} />
          </div>
          <aside className="space-y-6">
            <GuidedChangeEntry profile={canonicalData.profile} />
            <ScoreStartCorrectionPanel profile={canonicalData.profile} />
            <PasswordResetPanel profile={canonicalData.profile} />
          </aside>
        </section>
      </main>
    </>
  );
}
