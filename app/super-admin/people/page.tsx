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

function peoplePageHref(input: { query: string; active: string; role: string; page: number }) {
  const params = new URLSearchParams({ active: input.active, role: input.role, page: String(input.page) });
  if (input.query) params.set("q", input.query);
  return `/super-admin/people?${params.toString()}`;
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
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gold">People and access</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">People</h1>
            <p className="mt-2 text-sm text-stone-600">Find an account, inspect current and historical access, or start a guarded change.</p>
          </div>
          <Link className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50" href="/super-admin/people/new">
            Add student or teacher
          </Link>
        </div>

        {status ? <p className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${status.className}`} role={resolvedSearchParams.status === "access-updated" || resolvedSearchParams.status === "membership-ended" || resolvedSearchParams.status === "password-reset" ? "status" : "alert"}>{status.text}</p> : null}

        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Search and filter</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] md:items-end">
            <label className="block">
              <span className="text-sm font-medium text-ink">Name, phone, or auth email</span>
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                defaultValue={data.query}
                name="q"
                placeholder="Ammar, +1..., or ...@itqan.local"
                type="search"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">State</span>
              <select
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5"
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
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5"
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
            <button className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">
              Search
            </button>
          </form>
        </section>

        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Results</h2>
            {data.searched ? <p className="text-sm text-stone-600">{data.total === 0 ? "0 results" : `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}`}</p> : null}
          </div>

          {!data.searched ? (
            <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">
              Search for a person by name, phone, or email.
            </p>
          ) : data.results.length === 0 ? (
            <p className="mt-4 rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No people match this search.</p>
          ) : (
            <>
            <ul className="mt-4 grid gap-3 md:hidden">
              {data.results.map((result) => (
                <li className="rounded-xl border border-stone-200 p-4" key={result.profile.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-semibold text-ink">{result.profile.name}</p><p className="mt-1 text-xs text-stone-500">{result.profile.phone || result.profile.email}</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeClass(result.profile.active)}`}>{activeLabel(result.profile.active)}</span>
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">{roleLabel(result.profile.role)}</p>
                  <ul className="mt-2 space-y-1 text-sm text-stone-700">{result.accessSummaries.map((summary) => <li key={summary}>{summary}</li>)}</ul>
                  <Link aria-label={`Open ${result.profile.name}`} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-moss hover:text-ink" href={`/super-admin/people/${result.profile.id}`}>Open person →</Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 hidden overflow-x-auto md:block">
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
                          <span className="sr-only">{result.profile.name} </span>Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}

          {data.total > data.pageSize ? (
            <nav aria-label="People result pages" className="mt-5 flex items-center justify-between border-t border-stone-200 pt-4">
              {data.page > 1 ? <Link className="text-sm font-semibold text-moss hover:text-ink" href={peoplePageHref({ query: data.query, active: data.activeFilter, role: data.roleFilter, page: data.page - 1 })}>← Previous</Link> : <span />}
              <span className="text-sm text-stone-600">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
              {data.page * data.pageSize < data.total ? <Link className="text-sm font-semibold text-moss hover:text-ink" href={peoplePageHref({ query: data.query, active: data.activeFilter, role: data.roleFilter, page: data.page + 1 })}>Next →</Link> : <span />}
            </nav>
          ) : null}
        </section>
      </main>
    </>
  );
}
