import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import { SUPER_ADMIN_PEOPLE_STATUS_MESSAGES, loadPersonDetailData } from "@/app/super-admin/data";
import { GuidedAccessChange } from "@/app/super-admin/people/[id]/access/guided-access-change";
import { todayDateString } from "@/lib/dates";
import { reconcilePersonDetailWithAccessState } from "@/lib/person-access-state";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";
import type { GuidedAccessSnapshot } from "@/lib/super-admin-guided-change";
import type { PersonAccessState } from "@/lib/transactional-workflows";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

function roleLabel(role: Role) {
  if (role === "super_admin") return "Super admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default async function SuperAdminPersonAccessPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const data = await loadPersonDetailData(adminSupabase, id);

  if (!data) notFound();

  const { data: expectedState, error: expectedStateError } = await adminSupabase.rpc("get_person_access_state", {
    input_actor_id: actor.id,
    input_target_profile_id: data.profile.id
  });

  if (expectedStateError || !expectedState) {
    throw new Error("Unable to load the current access state.");
  }

  const canonicalState = expectedState as PersonAccessState;
  const canonicalData = reconcilePersonDetailWithAccessState(data, canonicalState);
  const snapshot: GuidedAccessSnapshot = {
    profile: canonicalData.profile,
    studentMemberships: canonicalData.studentMemberships,
    staffMemberships: canonicalData.staffMemberships,
    teacherAssignments: canonicalData.teacherAssignments,
    masjids: canonicalData.options.masjids,
    groups: canonicalData.options.groups
  };
  const status = resolvedSearchParams.status
    ? SUPER_ADMIN_PEOPLE_STATUS_MESSAGES[resolvedSearchParams.status]
    : null;

  return (
    <>
      <AppNav name={actor.name} role={actor.role} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link className="text-sm font-semibold text-moss hover:text-ink" href={`/super-admin/people/${id}`}>
            ← Back to person
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">Guided access change</p>
        </div>

        {status ? (
          <div
            className={`mb-5 rounded-xl px-4 py-3 text-sm font-medium ${status.className}`}
            role={resolvedSearchParams.status === "access-updated" ? "status" : "alert"}
          >
            {status.text}
          </div>
        ) : null}

        <section className="mb-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gold">Person access</p>
              <h1 className="mt-1 text-2xl font-semibold text-ink">{canonicalData.profile.name}</h1>
              <p className="mt-1 text-sm text-stone-600">
                {canonicalData.profile.phone || canonicalData.profile.email}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                canonicalData.profile.active ? "bg-green-50 text-green-800" : "bg-stone-100 text-stone-600"
              }`}
            >
              {canonicalData.profile.active ? "Active" : "Inactive"}
            </span>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-stone-500">Global role</dt>
              <dd className="mt-1 font-semibold text-ink">{roleLabel(canonicalData.profile.role)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Masjid staff rows</dt>
              <dd className="mt-1 font-semibold text-ink">{canonicalData.staffMemberships.length}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Student placements</dt>
              <dd className="mt-1 font-semibold text-ink">{canonicalData.studentMemberships.length}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Upcoming assignments</dt>
              <dd className="mt-1 font-semibold text-ink">{canonicalData.teacherAssignments.length}</dd>
            </div>
          </dl>
        </section>

        <GuidedAccessChange
          snapshot={snapshot}
          today={todayDateString()}
        />
      </main>
    </>
  );
}
