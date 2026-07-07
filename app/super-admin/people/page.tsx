import Link from "next/link";
import AppNav from "@/app/nav";
import {
  SUPER_ADMIN_PEOPLE_STATUS_MESSAGES,
  loadPeopleSearchData,
  type PeopleSearchParams
} from "@/app/super-admin/data";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

function statusFor(value: string | undefined) {
  return value ? SUPER_ADMIN_PEOPLE_STATUS_MESSAGES[value] : null;
}

function roleLabel(role: Role) {
  if (role === "super_admin") return "Super admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function activeLabel(active: boolean) {
  return active ? "Active" : "Inactive";
}

function activeClass(active: boolean) {
  return active ? "bg-green-50 text-green-800" : "bg-stone-100 text-stone-600";
}

export default async function SuperAdminPeoplePage({
  searchParams
}: {
  searchParams: Promise<PeopleSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const data = await loadPeopleSearchData(adminSupabase, resolvedSearchParams);
  const status = statusFor(resolvedSearchParams.status);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Super Admin</h1>
            <p className="mt-1 text-sm text-stone-600">Manage people, masjid access, and account recovery.</p>
          </div>
        </div>

        {status ? <p className={`mt-6 rounded-md px-3 py-2 text-sm ${status.className}`}>{status.text}</p> : null}

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">People Search</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] md:items-end">
            <label className="block">
              <span className="text-sm font-medium text-ink">Name, phone, or auth email</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                defaultValue={data.query}
                name="q"
                placeholder="Ammar, +1..., or ...@itqan.local"
                type="search"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">State</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                defaultValue={data.activeFilter}
                name="active"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Profile role</span>
              <select
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2"
                defaultValue={data.roleFilter}
                name="role"
              >
                <option value="all">All</option>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super admin</option>
              </select>
            </label>
            <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
              Search
            </button>
          </form>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Results</h2>
            {data.searched ? <p className="text-sm text-stone-600">{data.results.length} shown</p> : null}
          </div>

          {!data.searched ? (
            <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">
              Search for a person by name, phone, or email.
            </p>
          ) : data.results.length === 0 ? (
            <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No people match this search.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="py-2 pr-4 font-medium">Person</th>
                    <th className="py-2 pr-4 font-medium">Phone / email</th>
                    <th className="py-2 pr-4 font-medium">Profile role</th>
                    <th className="py-2 pr-4 font-medium">State</th>
                    <th className="py-2 pr-4 font-medium">Current access</th>
                    <th className="py-2 pr-0 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.results.map((result) => (
                    <tr key={result.profile.id}>
                      <td className="py-3 pr-4 font-medium text-ink">{result.profile.name}</td>
                      <td className="py-3 pr-4 text-stone-700">
                        <span className="block">{result.profile.phone || "No phone"}</span>
                        <span className="block text-xs text-stone-500">{result.profile.email}</span>
                      </td>
                      <td className="py-3 pr-4 text-stone-700">{roleLabel(result.profile.role)}</td>
                      <td className="py-3 pr-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${activeClass(result.profile.active)}`}>
                          {activeLabel(result.profile.active)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-stone-700">
                        <div className="space-y-1">
                          {result.accessSummaries.map((summary) => (
                            <p key={summary}>{summary}</p>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-0">
                        <Link
                          className="inline-flex rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50"
                          href={`/super-admin/people/${result.profile.id}`}
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
