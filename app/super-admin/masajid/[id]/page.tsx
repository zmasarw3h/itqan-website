import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import {
  createCohortSetup,
  createGroupSetup,
  grantMasjidStaffAccess,
  updateCohortSetup,
  updateGroupSetup,
  updateMasjidSetup
} from "@/app/super-admin/masajid/actions";
import {
  SUPER_ADMIN_MASJID_STATUS_MESSAGES,
  loadMasjidSetupDetailData,
  type MasjidSetupDetailData,
  type MasjidSetupSearchParams
} from "@/app/super-admin/masajid/data";
import { todayDateString } from "@/lib/dates";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";
import type { Cohort, HalaqaGroup, StaffRole } from "@/lib/types";

export const dynamic = "force-dynamic";

function statusFor(value: string | undefined) {
  return value ? SUPER_ADMIN_MASJID_STATUS_MESSAGES[value] : null;
}

function stateClass(active: boolean) {
  return active ? "bg-green-50 text-green-800" : "bg-stone-100 text-stone-600";
}

function roleLabel(role: StaffRole) {
  return role === "admin" ? "Admin" : "Teacher";
}

function MasjidEditor({ data }: { data: MasjidSetupDetailData }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Masjid</h2>
      <form action={updateMasjidSetup} className="mt-4 grid gap-4">
        <input name="masjid_id" type="hidden" value={data.masjid.id} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Name</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={data.masjid.name} name="name" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Slug</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={data.masjid.slug} name="slug" required />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input className="h-4 w-4 rounded border-stone-300" defaultChecked={data.masjid.active} name="active" type="checkbox" />
            Active
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Confirm masjid name when deactivating</span>
            <input
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              name="confirmation_name"
              placeholder={data.masjid.name}
            />
          </label>
        </div>
        <div>
          <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">Save masjid</button>
        </div>
      </form>
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

function StaffAccess({ data }: { data: MasjidSetupDetailData }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Admin Access</h2>
      {data.staff.length === 0 ? (
        <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No current staff access.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="py-2 pr-4 font-medium">Person</th>
                <th className="py-2 pr-4 font-medium">Access</th>
                <th className="py-2 pr-0 font-medium">Starts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.staff.map((membership) => (
                <tr key={membership.id}>
                  <td className="py-3 pr-4">
                    <p className="font-medium text-ink">{membership.profile_name}</p>
                    <p className="text-xs text-stone-500">{membership.profile_email}</p>
                  </td>
                  <td className="py-3 pr-4 text-stone-700">{roleLabel(membership.staff_role)}</td>
                  <td className="py-3 pr-0 text-stone-700">{membership.starts_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={grantMasjidStaffAccess} className="mt-5 grid gap-4 rounded-md bg-stone-50 p-4">
        <input name="masjid_id" type="hidden" value={data.masjid.id} />
        <input name="request_id" type="hidden" value={randomUUID()} />
        <h3 className="font-semibold text-ink">Grant First Admin Or Admin-Teacher</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Existing person email or phone</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="person_query" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Access</span>
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue="admin_teacher" name="staff_access">
              <option value="admin">Admin only</option>
              <option value="admin_teacher">Admin + Teacher</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Starts on</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={todayDateString()} name="starts_on" type="date" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Confirm masjid name</span>
            <input
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              name="confirmation_masjid"
              placeholder={data.masjid.name}
              required
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-ink">Confirm person name</span>
            <input autoComplete="off" className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="confirmation_name" required />
          </label>
        </div>
        <div>
          <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">Grant staff access</button>
        </div>
      </form>
    </section>
  );
}

function CreateCohort({ masjidId }: { masjidId: string }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Create Cohort</h2>
      <form action={createCohortSetup} className="mt-4 grid gap-4 md:grid-cols-2">
        <input name="masjid_id" type="hidden" value={masjidId} />
        <label className="block">
          <span className="text-sm font-medium text-ink">Name</span>
          <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="name" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Kind</span>
          <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue="brothers" name="kind">
            <option value="brothers">Brothers</option>
            <option value="sisters">Sisters</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Sort order</span>
          <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue="1" min="1" name="sort_order" type="number" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input className="h-4 w-4 rounded border-stone-300" defaultChecked name="active" type="checkbox" />
          Active
        </label>
        <div className="md:col-span-2">
          <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">Create cohort</button>
        </div>
      </form>
    </section>
  );
}

function GroupEditor({ group, masjidId, cohortId }: { group: Pick<HalaqaGroup, "id" | "name" | "active" | "sort_order">; masjidId: string; cohortId: string }) {
  return (
    <form action={updateGroupSetup} className="grid gap-3 rounded-md border border-stone-200 p-3 md:grid-cols-[minmax(0,1fr)_6rem_auto_auto] md:items-end">
      <input name="masjid_id" type="hidden" value={masjidId} />
      <input name="cohort_id" type="hidden" value={cohortId} />
      <input name="group_id" type="hidden" value={group.id} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Group</span>
        <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={group.name} name="name" required />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Order</span>
        <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={group.sort_order} min="1" name="sort_order" type="number" />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input className="h-4 w-4 rounded border-stone-300" defaultChecked={group.active} name="active" type="checkbox" />
        Active
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Confirm if deactivating</span>
        <input autoComplete="off" className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="confirmation_name" placeholder={group.name} />
      </label>
      <div className="md:col-span-4">
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50">Save group</button>
      </div>
    </form>
  );
}

function CohortCard({
  cohort,
  groups,
  masjidId
}: {
  cohort: Pick<Cohort, "id" | "kind" | "name" | "active" | "sort_order">;
  groups: Array<Pick<HalaqaGroup, "id" | "name" | "active" | "sort_order">>;
  masjidId: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <form action={updateCohortSetup} className="grid gap-4">
        <input name="masjid_id" type="hidden" value={masjidId} />
        <input name="cohort_id" type="hidden" value={cohort.id} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{cohort.name}</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stateClass(cohort.active)}`}>
            {cohort.active ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Name</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={cohort.name} name="name" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Kind</span>
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue={cohort.kind} name="kind">
              <option value="brothers">Brothers</option>
              <option value="sisters">Sisters</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Sort order</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue={cohort.sort_order} min="1" name="sort_order" type="number" />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input className="h-4 w-4 rounded border-stone-300" defaultChecked={cohort.active} name="active" type="checkbox" />
            Active
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-ink">Confirm cohort name when deactivating</span>
            <input autoComplete="off" className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="confirmation_name" placeholder={cohort.name} />
          </label>
        </div>
        <div>
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50">Save cohort</button>
        </div>
      </form>

      <div className="mt-5 border-t border-stone-200 pt-5">
        <h3 className="font-semibold text-ink">Groups</h3>
        <div className="mt-3 space-y-3">
          {groups.length === 0 ? <p className="rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No groups.</p> : null}
          {groups.map((group) => (
            <GroupEditor cohortId={cohort.id} group={group} key={group.id} masjidId={masjidId} />
          ))}
        </div>

        <form action={createGroupSetup} className="mt-4 grid gap-3 rounded-md bg-stone-50 p-3 md:grid-cols-[minmax(0,1fr)_6rem_auto] md:items-end">
          <input name="masjid_id" type="hidden" value={masjidId} />
          <input name="cohort_id" type="hidden" value={cohort.id} />
          <label className="block">
            <span className="text-sm font-medium text-ink">New group</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="name" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Order</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue="1" min="1" name="sort_order" type="number" />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input className="h-4 w-4 rounded border-stone-300" defaultChecked name="active" type="checkbox" />
            Active
          </label>
          <div className="md:col-span-3">
            <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">Create group</button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default async function SuperAdminMasjidDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<MasjidSetupSearchParams>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const data = await loadMasjidSetupDetailData(adminSupabase, resolvedParams.id);

  if (!data) {
    notFound();
  }

  const status = statusFor(resolvedSearchParams.status);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link className="text-sm font-medium text-moss hover:text-ink" href="/super-admin/masajid">
          Back to masajid
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">{data.masjid.name}</h1>
            <p className="mt-1 text-sm text-stone-600">{data.masjid.slug}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${stateClass(data.masjid.active)}`}>
            {data.masjid.active ? "Active" : "Inactive"}
          </span>
        </div>

        {status ? <p className={`mt-6 rounded-md px-3 py-2 text-sm ${status.className}`}>{status.text}</p> : null}
        <WarningsPanel warnings={data.warnings} />

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
          <div className="space-y-6">
            <MasjidEditor data={data} />
            <CreateCohort masjidId={data.masjid.id} />
            {data.cohorts.map((cohort) => (
              <CohortCard
                cohort={cohort}
                groups={data.groupsByCohortId.get(cohort.id) ?? []}
                key={cohort.id}
                masjidId={data.masjid.id}
              />
            ))}
          </div>
          <aside>
            <StaffAccess data={data} />
          </aside>
        </section>
      </main>
    </>
  );
}
