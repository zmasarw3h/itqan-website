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

export default async function SuperAdminMasajidPage({
  searchParams
}: {
  searchParams: Promise<MasjidSetupSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const rows = await loadMasjidSetupListData(adminSupabase);
  const status = statusFor(resolvedSearchParams.status);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Masjid Setup</h1>
            <p className="mt-1 text-sm text-stone-600">Manage masajid, cohorts, groups, and first-admin access.</p>
          </div>
          <Link className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink" href="/super-admin/masajid/new">
            New masjid
          </Link>
        </div>

        {status ? <p className={`mt-6 rounded-md px-3 py-2 text-sm ${status.className}`}>{status.text}</p> : null}

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Masajid</h2>
            <p className="text-sm text-stone-600">{rows.length} total</p>
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No masajid have been created.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
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
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-ink">{row.name}</p>
                        <p className="text-xs text-stone-500">{row.slug}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stateClass(row.active)}`}>
                          {row.active ? "Active" : "Inactive"}
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
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
