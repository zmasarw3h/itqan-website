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
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link className="text-sm font-medium text-moss hover:text-ink" href="/super-admin/masajid">
          Back to masajid
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink">New Masjid</h1>
        <p className="mt-1 text-sm text-stone-600">
          Create the masjid plus an optional starter cohort and group. First admin access can be granted from the masjid detail page.
        </p>

        <form action={createMasjidSetup} className="mt-6 grid gap-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <section>
            <h2 className="text-lg font-semibold text-ink">Masjid</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Name</span>
                <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="name" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Slug</span>
                <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="slug" placeholder="thunder-bay" />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input className="h-4 w-4 rounded border-stone-300" defaultChecked name="active" type="checkbox" />
                Active
              </label>
            </div>
          </section>

          <section className="border-t border-stone-200 pt-5">
            <h2 className="text-lg font-semibold text-ink">Starter Cohort</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Cohort name</span>
                <input
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  defaultValue="Brothers"
                  name="cohort_name"
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

          <section className="border-t border-stone-200 pt-5">
            <h2 className="text-lg font-semibold text-ink">Starter Group</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Group name</span>
                <input className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" defaultValue="Group 1" name="group_name" />
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

          <div>
            <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">Create masjid</button>
          </div>
        </form>
      </main>
    </>
  );
}
