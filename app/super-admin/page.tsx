import AppNav from "@/app/nav";
import { requireSuperAdmin } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const { profile } = await requireSuperAdmin();

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase text-moss">Super Admin</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Operations Console</h1>
          <p className="mt-2 text-stone-600">
            The security foundation is active. People search, access editing, and password reset tools are scheduled for Phase 1A.
          </p>
        </section>
      </main>
    </>
  );
}
