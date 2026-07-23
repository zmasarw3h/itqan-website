import Link from "next/link";
import AppNav from "@/app/nav";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

type AuditSearchParams = {
  action?: string;
  masjid?: string;
  page?: string;
};

type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  target_masjid_id: string | null;
  before_data: unknown;
  after_data: unknown;
  metadata: unknown;
};

function titleCase(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function pageHref(input: AuditSearchParams, page: number) {
  const params = new URLSearchParams();
  if (input.action) params.set("action", input.action);
  if (input.masjid) params.set("masjid", input.masjid);
  if (page > 1) params.set("page", String(page));
  return `/super-admin/audit${params.size ? `?${params.toString()}` : ""}`;
}

function JsonChange({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-stone-950 p-3 text-xs leading-5 text-stone-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default async function SuperAdminAuditPage({
  searchParams
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const filters = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const page = parsePage(filters.page);
  const pageSize = 40;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = adminSupabase
    .from("super_admin_audit_events")
    .select("id,occurred_at,actor_id,action,target_table,target_id,target_masjid_id,before_data,after_data,metadata", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range(from, to);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.masjid) query = query.eq("target_masjid_id", filters.masjid);

  const [{ data: events, error, count }, { data: actionRows, error: actionError }, { data: masjids, error: masjidError }] = await Promise.all([
    query.returns<AuditEvent[]>(),
    adminSupabase.from("super_admin_audit_events").select("action").limit(1000).returns<Array<{ action: string }>>(),
    adminSupabase.from("masajid").select("id,name").order("name").returns<Array<{ id: string; name: string }>>()
  ]);

  if (error || actionError || masjidError) throw new Error("Unable to load the audit log.");

  const actorIds = [...new Set((events ?? []).map((event) => event.actor_id))];
  const { data: actors, error: actorsError } = actorIds.length
    ? await adminSupabase.from("profiles").select("id,name").in("id", actorIds).returns<Array<{ id: string; name: string }>>()
    : { data: [], error: null };
  if (actorsError) throw new Error("Unable to load audit actors.");

  const actorById = new Map((actors ?? []).map((actor) => [actor.id, actor.name]));
  const masjidById = new Map((masjids ?? []).map((masjid) => [masjid.id, masjid.name]));
  const actions = [...new Set((actionRows ?? []).map((row) => row.action))].sort();
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div>
          <p className="text-sm font-semibold text-gold">Accountability</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">Audit log</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
            Review sensitive super-admin changes, their exact target and scope, and the recorded before-and-after state.
          </p>
        </div>

        <form className="mt-6 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_1fr_auto]" method="get">
          <label>
            <span className="text-sm font-medium text-ink">Operation</span>
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue={filters.action ?? ""} name="action">
              <option value="">All operations</option>
              {actions.map((action) => <option key={action} value={action}>{titleCase(action)}</option>)}
            </select>
          </label>
          <label>
            <span className="text-sm font-medium text-ink">Masjid scope</span>
            <select className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" defaultValue={filters.masjid ?? ""} name="masjid">
              <option value="">All masajid</option>
              {(masjids ?? []).map((masjid) => <option key={masjid.id} value={masjid.id}>{masjid.name}</option>)}
            </select>
          </label>
          <button className="self-end rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">Apply filters</button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-stone-600">
            {total === 0 ? "No events" : `${from + 1}–${Math.min(from + pageSize, total)} of ${total} events`}
          </p>
          {(filters.action || filters.masjid) ? <Link className="text-sm font-semibold text-moss hover:text-ink" href="/super-admin/audit">Clear filters</Link> : null}
        </div>

        {events?.length ? (
          <ol className="mt-3 space-y-3">
            {events.map((event) => (
              <li className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm" key={event.id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{titleCase(event.action)}</p>
                    <p className="mt-1 text-sm text-stone-600">
                      {actorById.get(event.actor_id) ?? "Unknown operator"} · {formatDateTimeInAppTimeZone(event.occurred_at)}
                    </p>
                  </div>
                  <div className="text-sm text-stone-600 md:text-right">
                    <p>{event.target_table ?? "Unknown target"}{event.target_id ? ` · ${event.target_id}` : ""}</p>
                    {event.target_masjid_id ? <p className="mt-1">{masjidById.get(event.target_masjid_id) ?? event.target_masjid_id}</p> : null}
                  </div>
                </div>
                {(event.before_data !== null || event.after_data !== null || event.metadata !== null) ? (
                  <details className="group mt-4 rounded-lg border border-stone-200 bg-stone-50">
                    <summary className="cursor-pointer list-none p-3 text-sm font-semibold text-moss">Inspect recorded change</summary>
                    <div className="grid gap-4 border-t border-stone-200 p-4 lg:grid-cols-3">
                      <JsonChange label="Before" value={event.before_data} />
                      <JsonChange label="After" value={event.after_data} />
                      <JsonChange label="Metadata" value={event.metadata} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-600">No audit events match these filters.</p>
        )}

        {pageCount > 1 ? (
          <nav aria-label="Audit pagination" className="mt-6 flex items-center justify-between gap-3">
            {page > 1 ? <Link className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-ink" href={pageHref(filters, page - 1)}>← Previous</Link> : <span />}
            <p className="text-sm text-stone-600">Page {page} of {pageCount}</p>
            {page < pageCount ? <Link className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-ink" href={pageHref(filters, page + 1)}>Next →</Link> : <span />}
          </nav>
        ) : null}
      </main>
    </>
  );
}
