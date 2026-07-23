import Link from "next/link";
import AppNav from "@/app/nav";
import { loadMasjidSetupListData } from "@/app/super-admin/masajid/data";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
};

function actionLabel(action: string) {
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function SuperAdminPage() {
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const [masjids, profileCountResult, inactiveProfileCountResult, auditResult] = await Promise.all([
    loadMasjidSetupListData(adminSupabase),
    adminSupabase.from("profiles").select("id", { count: "exact", head: true }),
    adminSupabase.from("profiles").select("id", { count: "exact", head: true }).eq("active", false),
    adminSupabase
      .from("super_admin_audit_events")
      .select("id,occurred_at,actor_id,action,target_table,target_id")
      .order("occurred_at", { ascending: false })
      .limit(8)
      .returns<AuditEvent[]>()
  ]);

  if (profileCountResult.error || inactiveProfileCountResult.error || auditResult.error) {
    throw new Error("Unable to load the super-admin overview.");
  }

  const events = auditResult.data ?? [];
  const actorIds = [...new Set(events.map((event) => event.actor_id))];
  const { data: actors, error: actorsError } = actorIds.length
    ? await adminSupabase.from("profiles").select("id,name").in("id", actorIds).returns<Array<{ id: string; name: string }>>()
    : { data: [], error: null };

  if (actorsError) {
    throw new Error("Unable to load recent super-admin activity.");
  }

  const actorNames = new Map((actors ?? []).map((actor) => [actor.id, actor.name]));
  const needsAttention = masjids.filter((masjid) => masjid.warnings.length > 0);
  const inactiveDrafts = masjids.filter((masjid) => !masjid.active);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gold">Super admin workspace</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">Operations overview</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
              Start common tasks, find setup that needs attention, and review recent sensitive changes across ITQAN.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50" href="/super-admin/repairs">
              Review repairs
            </Link>
            <Link className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50" href="/super-admin/people">
              Find a person
            </Link>
            <Link className="rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink" href="/super-admin/masajid/new">
              Add masjid
            </Link>
          </div>
        </div>

        <section aria-label="Portfolio summary" className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Link className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm hover:border-green-300" href="/super-admin/people">
            <p className="text-sm text-stone-500">People</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{profileCountResult.count ?? 0}</p>
            <p className="mt-2 text-sm text-stone-600">{inactiveProfileCountResult.count ?? 0} inactive accounts</p>
          </Link>
          <Link className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm hover:border-green-300" href="/super-admin/masajid">
            <p className="text-sm text-stone-500">Masajid</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{masjids.length}</p>
            <p className="mt-2 text-sm text-stone-600">{masjids.filter((masjid) => masjid.active).length} currently active</p>
          </Link>
          <Link className={`rounded-xl border p-5 shadow-sm ${needsAttention.length ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-white"}`} href="/super-admin/masajid?attention=needs-attention">
            <p className="text-sm text-stone-600">Needs attention</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{needsAttention.length}</p>
            <p className="mt-2 text-sm text-stone-600">Active setup with readiness warnings</p>
          </Link>
          <Link className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm hover:border-green-300" href="/super-admin/masajid?state=inactive">
            <p className="text-sm text-stone-500">Inactive drafts</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{inactiveDrafts.length}</p>
            <p className="mt-2 text-sm text-stone-600">Available for setup before activation</p>
          </Link>
          <Link className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm hover:border-green-300" href="/super-admin/repairs">
            <p className="text-sm text-stone-500">Repairs</p>
            <p className="mt-2 text-2xl font-semibold text-ink">Review</p>
            <p className="mt-2 text-sm text-stone-600">Run 8 consistency checks</p>
          </Link>
        </section>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
          <section className="self-start rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">Setup requiring attention</h2>
                <p className="mt-1 text-sm text-stone-600">Work from the issue, not from a raw record list.</p>
              </div>
              <Link className="text-sm font-semibold text-moss hover:text-ink" href="/super-admin/masajid">View all masajid</Link>
            </div>
            {needsAttention.length === 0 && inactiveDrafts.length === 0 ? (
              <p className="mt-5 rounded-lg bg-green-50 p-4 text-sm text-green-900">No masjid setup currently requires attention.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {[...needsAttention, ...inactiveDrafts].slice(0, 6).map((masjid) => (
                  <li className="flex flex-col gap-3 rounded-lg border border-stone-200 p-4 sm:flex-row sm:items-center sm:justify-between" key={masjid.id}>
                    <div>
                      <p className="font-semibold text-ink">{masjid.name}</p>
                      <p className="mt-1 text-sm text-stone-600">
                        {masjid.active ? masjid.warnings.join(" ") : "Inactive draft — review hierarchy and staff readiness."}
                      </p>
                    </div>
                    <Link className="shrink-0 text-sm font-semibold text-moss hover:text-ink" href={`/super-admin/masajid/${masjid.id}`}>
                      {masjid.active ? "Review setup" : "Continue setup"} →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="self-start rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">Recent sensitive activity</h2>
                <p className="mt-1 text-sm text-stone-600">Latest audited super-admin operations.</p>
              </div>
              <Link className="text-sm font-semibold text-moss hover:text-ink" href="/super-admin/audit">View audit</Link>
            </div>
            {events.length === 0 ? (
              <p className="mt-5 rounded-lg bg-stone-50 p-4 text-sm text-stone-600">No audited activity yet.</p>
            ) : (
              <ol className="mt-4 divide-y divide-stone-100">
                {events.map((event) => (
                  <li className="py-3 first:pt-0" key={event.id}>
                    <p className="text-sm font-semibold text-ink">{actionLabel(event.action)}</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      {actorNames.get(event.actor_id) ?? "Unknown operator"} · {formatDateTimeInAppTimeZone(event.occurred_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
