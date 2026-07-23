import { randomUUID } from "node:crypto";
import Link from "next/link";
import AppNav from "@/app/nav";
import { createMasjidSetup } from "@/app/super-admin/masajid/actions";
import { requireSuperAdmin } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

export default async function NewMasjidPage() {
  const { profile } = await requireSuperAdmin();

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link className="text-sm font-semibold text-moss hover:text-ink" href="/super-admin/masajid">
          ← Back to masajid
        </Link>
        <p className="mt-5 text-sm font-semibold text-gold">Guided setup</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Add a masjid</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
          Create an inactive draft with an optional starter hierarchy. You will review staff coverage and activate it from its workspace.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["1", "Identity", "Name and stable URL slug"],
            ["2", "Starter hierarchy", "Optional cohort and group"],
            ["3", "Continue setup", "Staff coverage and activation"]
          ].map(([number, title, detail]) => (
            <div className="rounded-xl border border-stone-200 bg-white p-4" key={number}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-moss text-sm font-semibold text-white">{number}</span>
              <p className="mt-3 font-semibold text-ink">{title}</p>
              <p className="mt-1 text-sm text-stone-600">{detail}</p>
            </div>
          ))}
        </div>

        <form action={createMasjidSetup} className="mt-6 grid gap-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
          <input name="request_id" type="hidden" value={randomUUID()} />
          <section aria-labelledby="new-masjid-identity">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-sm font-semibold text-green-900">1</span>
              <h2 className="text-lg font-semibold text-ink" id="new-masjid-identity">Masjid identity</h2>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Name</span>
                <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="name" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Slug</span>
                <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="slug" placeholder="thunder-bay" />
              </label>
            </div>
            <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
              New masajid always begin inactive so unfinished setup cannot appear operational.
            </p>
          </section>

          <section aria-labelledby="new-masjid-cohort" className="border-t border-stone-200 pt-6">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-sm font-semibold text-green-900">2</span>
              <div>
                <h2 className="text-lg font-semibold text-ink" id="new-masjid-cohort">Starter cohort</h2>
                <p className="mt-1 text-sm text-stone-600">Leave the name blank to create only the masjid draft.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Cohort name</span>
                <input
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  name="cohort_name"
                  placeholder="Brothers"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Kind</span>
                <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue="brothers" name="cohort_kind">
                  <option value="brothers">Brothers</option>
                  <option value="sisters">Sisters</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Sort order</span>
                <input
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  defaultValue="1"
                  min="1"
                  name="cohort_sort_order"
                  type="number"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input className="h-4 w-4 rounded border-stone-300" defaultChecked name="cohort_active" type="checkbox" />
                Active cohort
              </label>
            </div>
          </section>

          <section aria-labelledby="new-masjid-group" className="border-t border-stone-200 pt-6">
            <h2 className="text-lg font-semibold text-ink" id="new-masjid-group">Starter group</h2>
            <p className="mt-1 text-sm text-stone-600">Created inside the starter cohort when a group name is provided.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Group name</span>
                <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="group_name" placeholder="Group 1" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Sort order</span>
                <input
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  defaultValue="1"
                  min="1"
                  name="group_sort_order"
                  type="number"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input className="h-4 w-4 rounded border-stone-300" defaultChecked name="group_active" type="checkbox" />
                Active group
              </label>
            </div>
          </section>

          <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-stone-200 pt-6 sm:flex-row sm:items-center">
            <p className="text-sm text-stone-600">Next: review readiness, add staff coverage, then activate.</p>
            <button className="min-h-11 rounded-lg bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink">Create draft and continue</button>
          </div>
        </form>
      </main>
    </>
  );
}
