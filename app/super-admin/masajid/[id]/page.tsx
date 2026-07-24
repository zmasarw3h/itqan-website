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
import {
  masjidUpdateState,
  preservedMasjidUpdateRequestId
} from "@/lib/transactional-workflows";
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

function MasjidEditor({ data, requestId }: { data: MasjidSetupDetailData; requestId?: string | null }) {
  return (
    <details className="group rounded-xl border border-stone-200 bg-white shadow-sm" id="settings">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">Details and status</h2>
          <p className="mt-1 text-sm text-stone-600">Rename, change the slug, or activate/deactivate this masjid.</p>
        </div>
        <span className="text-sm font-semibold text-moss group-open:hidden">Edit</span>
        <span className="hidden text-sm font-semibold text-moss group-open:inline">Close</span>
      </summary>
      <form action={updateMasjidSetup} className="grid gap-4 border-t border-stone-200 p-5">
        <input name="masjid_id" type="hidden" value={data.masjid.id} />
        <input name="request_id" type="hidden" value={requestId ?? randomUUID()} />
        <input name="expected_state" type="hidden" value={JSON.stringify(masjidUpdateState(data.masjid))} />
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
          <button className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">Save details and status</button>
        </div>
      </form>
    </details>
  );
}

function ReadinessPanel({ data }: { data: MasjidSetupDetailData }) {
  const activeCohorts = data.cohorts.filter((cohort) => cohort.active).length;
  const activeCohortIds = new Set(data.cohorts.filter((cohort) => cohort.active).map((cohort) => cohort.id));
  const activeGroups = [...data.groupsByCohortId.values()].flat().filter((group) => group.active && activeCohortIds.has(group.cohort_id)).length;
  const activeAdmins = data.staff.filter((membership) => membership.staff_role === "admin" && membership.profile_role === "admin").length;
  const checks = [
    { label: "Active cohort", ready: activeCohorts > 0, href: "#hierarchy" },
    { label: "Active group", ready: activeGroups > 0, href: "#hierarchy" },
    { label: "Current admin coverage", ready: activeAdmins > 0, href: "#staff" }
  ];
  const ready = checks.every((check) => check.ready);
  return (
    <section className={`rounded-xl border p-5 shadow-sm ${ready ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-600">Operational readiness</p>
          <h2 className="mt-2 text-lg font-semibold text-ink">
            {ready ? (data.masjid.active ? "Operationally ready" : "Ready for activation") : "Setup needs attention"}
          </h2>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ready ? "bg-white text-green-900" : "bg-white text-amber-900"}`}>
          {checks.filter((check) => check.ready).length}/{checks.length} ready
        </span>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {checks.map((check) => (
          <li className="rounded-lg bg-white/80 p-3" key={check.label}>
            <p className={`text-sm font-semibold ${check.ready ? "text-green-900" : "text-amber-900"}`}>
              {check.ready ? "✓" : "!"} {check.label}
            </p>
            {!check.ready ? <a className="mt-2 inline-block text-xs font-semibold text-moss hover:text-ink" href={check.href}>Complete setup →</a> : null}
          </li>
        ))}
      </ul>
      {!data.masjid.active && ready ? <p className="mt-4 text-sm text-green-900">The masjid is still an inactive draft. Open Details and status when you are ready to activate it.</p> : null}
    </section>
  );
}

function StaffAccess({ data }: { data: MasjidSetupDetailData }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm" id="staff">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Staff access</h2>
          <p className="mt-1 text-sm text-stone-600">Current admin and teacher capabilities at this masjid.</p>
        </div>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">{data.staff.length} access row{data.staff.length === 1 ? "" : "s"}</span>
      </div>
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

      <details className="group mt-5 rounded-lg border border-stone-200 bg-stone-50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <span className="font-semibold text-ink">Grant staff access</span>
          <span className="text-sm font-semibold text-moss group-open:hidden">Open</span>
          <span className="hidden text-sm font-semibold text-moss group-open:inline">Close</span>
        </summary>
      <form action={grantMasjidStaffAccess} className="grid gap-4 border-t border-stone-200 p-4">
        <input name="masjid_id" type="hidden" value={data.masjid.id} />
        <input name="request_id" type="hidden" value={randomUUID()} />
        <h3 className="font-semibold text-ink">Grant admin, teacher, or combined access</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Existing person email or phone</span>
            <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="person_query" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Access</span>
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue="admin_teacher" name="staff_access">
              <option value="admin">Admin only</option>
              <option value="teacher">Teacher only</option>
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
      </details>
    </section>
  );
}

function CreateCohort({ masjidId }: { masjidId: string }) {
  return (
    <details className="group rounded-xl border border-stone-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
        <div><h2 className="text-lg font-semibold text-ink">Add cohort</h2><p className="mt-1 text-sm text-stone-600">Create another brothers or sisters cohort.</p></div>
        <span className="text-sm font-semibold text-moss group-open:hidden">Open</span><span className="hidden text-sm font-semibold text-moss group-open:inline">Close</span>
      </summary>
      <form action={createCohortSetup} className="grid gap-4 border-t border-stone-200 p-5 md:grid-cols-2">
        <input name="masjid_id" type="hidden" value={masjidId} />
        <input name="request_id" type="hidden" value={randomUUID()} />
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
    </details>
  );
}

function GroupEditor({ group, masjidId, cohortId }: { group: Pick<HalaqaGroup, "id" | "name" | "active" | "sort_order" | "updated_at">; masjidId: string; cohortId: string }) {
  return (
    <form action={updateGroupSetup} className="grid gap-3 rounded-md border border-stone-200 p-3 md:grid-cols-[minmax(0,1fr)_6rem_auto_auto] md:items-end">
      <input name="masjid_id" type="hidden" value={masjidId} />
      <input name="cohort_id" type="hidden" value={cohortId} />
      <input name="group_id" type="hidden" value={group.id} />
      <input name="request_id" type="hidden" value={randomUUID()} />
      <input name="expected_state" type="hidden" value={JSON.stringify({
        id: group.id,
        cohort_id: cohortId,
        name: group.name,
        active: group.active,
        sort_order: group.sort_order,
        updated_at: group.updated_at
      })} />
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
  cohort: Pick<Cohort, "id" | "kind" | "name" | "active" | "sort_order" | "updated_at">;
  groups: Array<Pick<HalaqaGroup, "id" | "name" | "active" | "sort_order" | "updated_at">>;
  masjidId: string;
}) {
  return (
    <details className="group rounded-xl border border-stone-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-ink">{cohort.name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stateClass(cohort.active)}`}>{cohort.active ? "Active" : "Inactive"}</span></div>
          <p className="mt-1 text-sm text-stone-600">{cohort.kind === "brothers" ? "Brothers" : "Sisters"} · {groups.length} group{groups.length === 1 ? "" : "s"}</p>
        </div>
        <span className="text-sm font-semibold text-moss group-open:hidden">Manage</span><span className="hidden text-sm font-semibold text-moss group-open:inline">Close</span>
      </summary>
      <div className="border-t border-stone-200 p-5">
      <form action={updateCohortSetup} className="grid gap-4">
        <input name="masjid_id" type="hidden" value={masjidId} />
        <input name="cohort_id" type="hidden" value={cohort.id} />
        <input name="request_id" type="hidden" value={randomUUID()} />
        <input name="expected_state" type="hidden" value={JSON.stringify({
          id: cohort.id,
          masjid_id: masjidId,
          kind: cohort.kind,
          name: cohort.name,
          active: cohort.active,
          sort_order: cohort.sort_order,
          updated_at: cohort.updated_at
        })} />
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
          <input name="request_id" type="hidden" value={randomUUID()} />
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
      </div>
    </details>
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
  const updateRequestId = preservedMasjidUpdateRequestId(
    resolvedSearchParams.status,
    resolvedSearchParams.request_id
  );

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Link className="text-sm font-semibold text-moss hover:text-ink" href="/super-admin/masajid">
          ← Back to masajid
        </Link>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gold">Masjid workspace</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">{data.masjid.name}</h1>
            <p className="mt-1 text-sm text-stone-600">{data.masjid.slug}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${stateClass(data.masjid.active)}`}>
            {data.masjid.active ? "Active" : "Inactive"}
          </span>
        </div>

        {status ? <p className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${status.className}`} role={resolvedSearchParams.status?.includes("created") || resolvedSearchParams.status?.includes("updated") || resolvedSearchParams.status === "staff-granted" ? "status" : "alert"}>{status.text}</p> : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <ReadinessPanel data={data} />
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Workspace summary</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-stone-500">Cohorts</dt><dd className="mt-1 text-2xl font-semibold text-ink">{data.cohorts.length}</dd></div>
              <div><dt className="text-stone-500">Groups</dt><dd className="mt-1 text-2xl font-semibold text-ink">{[...data.groupsByCohortId.values()].flat().length}</dd></div>
              <div><dt className="text-stone-500">Admins</dt><dd className="mt-1 text-2xl font-semibold text-ink">{data.staff.filter((membership) => membership.staff_role === "admin" && membership.profile_role === "admin").length}</dd></div>
              <div><dt className="text-stone-500">Teachers</dt><dd className="mt-1 text-2xl font-semibold text-ink">{data.staff.filter((membership) => membership.staff_role === "teacher").length}</dd></div>
            </dl>
          </section>
        </div>

        <nav aria-label="Masjid workspace sections" className="mt-6 grid gap-3 sm:grid-cols-3">
          <a className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-green-300" href="#hierarchy"><p className="font-semibold text-ink">Hierarchy</p><p className="mt-1 text-sm text-stone-600">Cohorts and groups</p></a>
          <a className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-green-300" href="#staff"><p className="font-semibold text-ink">Staff access</p><p className="mt-1 text-sm text-stone-600">Admins and teachers</p></a>
          <a className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-green-300" href="#settings"><p className="font-semibold text-ink">Details and status</p><p className="mt-1 text-sm text-stone-600">Identity and activation</p></a>
        </nav>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
          <div className="space-y-6" id="hierarchy">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-xl font-semibold text-ink">Hierarchy</h2><p className="mt-1 text-sm text-stone-600">Open a cohort only when you need to manage it.</p></div>
            </div>
            {data.cohorts.length === 0 ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No cohorts have been created.</p> : null}
            {data.cohorts.map((cohort) => (
              <CohortCard cohort={cohort} groups={data.groupsByCohortId.get(cohort.id) ?? []} key={cohort.id} masjidId={data.masjid.id} />
            ))}
            <CreateCohort masjidId={data.masjid.id} />
          </div>
          <aside className="space-y-6">
            <StaffAccess data={data} />
            <MasjidEditor data={data} requestId={updateRequestId} />
          </aside>
        </section>
      </main>
    </>
  );
}
