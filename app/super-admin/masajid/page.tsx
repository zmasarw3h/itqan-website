import Link from "next/link";
import AppNav from "@/app/nav";
import {
  SUPER_ADMIN_MASJID_STATUS_MESSAGES,
  loadMasjidSetupListData,
  type MasjidSetupSearchParams
} from "@/app/super-admin/masajid/data";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

function statusFor(value: string | undefined) {
  return value ? SUPER_ADMIN_MASJID_STATUS_MESSAGES[value] : null;
}

function stateClass(active: boolean) {
  return active ? "bg-green-50 text-green-800" : "bg-stone-100 text-stone-600";
}

function attentionLabel(row: Awaited<ReturnType<typeof loadMasjidSetupListData>>[number]) {
  if (!row.active) return "Draft";
  if (row.warnings.length > 0) return "Needs attention";
  return "Ready";
}

export default async function SuperAdminMasajidPage({
  searchParams
}: {
  searchParams: Promise<MasjidSetupSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const rows = await loadMasjidSetupListData(adminSupabase);
  const status = statusFor(resolvedSearchParams.status);
  const query = resolvedSearchParams.q?.trim().toLowerCase() ?? "";
  const state = resolvedSearchParams.state ?? "all";
  const attention = resolvedSearchParams.attention ?? "all";
  const filteredRows = rows.filter((row) => {
    if (query && !`${row.name} ${row.slug}`.toLowerCase().includes(query)) return false;
    if (state === "active" && !row.active) return false;
    if (state === "inactive" && row.active) return false;
    if (attention === "needs-attention" && row.warnings.length === 0) return false;
    if (attention === "ready" && (!row.active || row.warnings.length > 0)) return false;
    return true;
  });
  const needsAttention = rows.filter((row) => row.warnings.length > 0).length;
  const drafts = rows.filter((row) => !row.active).length;
  const ready = rows.filter((row) => row.active && row.warnings.length === 0).length;

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gold">Foundation management</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">Masajid</h1>
            <p className="mt-2 text-sm text-stone-600">See readiness, continue drafts, and manage hierarchy and staff access.</p>
          </div>
          <Link className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink" href="/super-admin/masajid/new">
            Add masjid
          </Link>
        </div>

        {status ? <p className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${status.className}`} role={resolvedSearchParams.status === "created" ? "status" : "alert"}>{status.text}</p> : null}

        <section aria-label="Masjid readiness summary" className="mt-6 grid gap-4 sm:grid-cols-3">
          <Link className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm" href="/super-admin/masajid?attention=needs-attention">
            <p className="text-sm text-amber-900">Needs attention</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{needsAttention}</p>
          </Link>
          <Link className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm" href="/super-admin/masajid?state=inactive">
            <p className="text-sm text-stone-600">Inactive drafts</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{drafts}</p>
          </Link>
          <Link className="rounded-xl border border-green-200 bg-green-50 p-4 shadow-sm" href="/super-admin/masajid?attention=ready">
            <p className="text-sm text-green-900">Ready and active</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{ready}</p>
          </Link>
        </section>

        <form className="mt-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] md:items-end">
          <label className="block">
            <span className="text-sm font-semibold text-ink">Search masajid</span>
            <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" defaultValue={resolvedSearchParams.q} name="q" placeholder="Name or slug" type="search" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">State</span>
            <select className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5" defaultValue={state} name="state">
              <option value="all">All states</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Readiness</span>
            <select className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5" defaultValue={attention} name="attention">
              <option value="all">All readiness</option>
              <option value="needs-attention">Needs attention</option>
              <option value="ready">Ready</option>
            </select>
          </label>
          <button className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50">Apply filters</button>
        </form>

        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Portfolio</h2>
              <p className="mt-1 text-sm text-stone-600">{filteredRows.length} shown · {rows.length} total</p>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <p className="mt-4 rounded-lg bg-stone-50 px-4 py-4 text-sm text-stone-600">No masajid match these filters.</p>
          ) : (
            <>
            <ul className="mt-4 grid gap-3 md:hidden">
              {filteredRows.map((row) => (
                <li className="rounded-xl border border-stone-200 p-4" key={row.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{row.name}</p>
                      <p className="mt-1 text-xs text-stone-500">{row.slug}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.warnings.length ? "bg-amber-50 text-amber-900" : stateClass(row.active)}`}>
                      {attentionLabel(row)}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-stone-500">Cohorts</dt><dd className="mt-1 font-semibold text-ink">{row.active_cohort_count}/{row.cohort_count}</dd></div>
                    <div><dt className="text-stone-500">Groups</dt><dd className="mt-1 font-semibold text-ink">{row.active_group_count}/{row.group_count}</dd></div>
                    <div><dt className="text-stone-500">Admins</dt><dd className="mt-1 font-semibold text-ink">{row.active_admin_count}</dd></div>
                  </dl>
                  {row.warnings.length ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{row.warnings.join(" ")}</p> : null}
                  <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-moss hover:text-ink" href={`/super-admin/masajid/${row.id}`}>
                    {row.active ? "Open workspace" : "Continue setup"} →
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="py-2 pr-4 font-medium">Masjid</th>
                    <th className="py-2 pr-4 font-medium">State</th>
                    <th className="py-2 pr-4 font-medium">Cohorts</th>
                    <th className="py-2 pr-4 font-medium">Groups</th>
                    <th className="py-2 pr-4 font-medium">Admins</th>
                    <th className="py-2 pr-4 font-medium">Warnings</th>
                    <th className="py-2 pr-0 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-ink">{row.name}</p>
                        <p className="text-xs text-stone-500">{row.slug}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.warnings.length ? "bg-amber-50 text-amber-900" : stateClass(row.active)}`}>
                          {attentionLabel(row)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-stone-700">
                        {row.active_cohort_count} active / {row.cohort_count} total
                      </td>
                      <td className="py-3 pr-4 text-stone-700">
                        {row.active_group_count} active / {row.group_count} total
                      </td>
                      <td className="py-3 pr-4 text-stone-700">{row.active_admin_count}</td>
                      <td className="py-3 pr-4 text-stone-700">
                        {row.warnings.length ? (
                          <div className="space-y-1">
                            {row.warnings.map((warning) => (
                              <p key={warning}>{warning}</p>
                            ))}
                          </div>
                        ) : (
                          "None"
                        )}
                      </td>
                      <td className="py-3 pr-0">
                        <Link
                          className="inline-flex rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50"
                          href={`/super-admin/masajid/${row.id}`}
                        >
                          {row.active ? "Open workspace" : "Continue setup"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
