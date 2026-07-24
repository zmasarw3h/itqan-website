import Link from "next/link";
import AppNav from "@/app/nav";
import { loadRepairIssues, type RepairIssueKind } from "@/app/super-admin/repairs/data";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

type RepairSearchParams = { kind?: string };

const KIND_LABELS: Record<RepairIssueKind, string> = {
  student_without_group: "Students without placement",
  teacher_without_staff: "Teachers without capability",
  inactive_with_open_access: "Inactive accounts with open access",
  active_without_access: "Active accounts without scope",
  masjid_without_admin: "Masajid without admin coverage",
  assignment_without_teacher_access: "Assignments without teacher access",
  profile_without_auth: "Profiles without login identity",
  auth_without_profile: "Login identities without profile"
};

function isIssueKind(value: string | undefined): value is RepairIssueKind {
  return Boolean(value && value in KIND_LABELS);
}

export default async function SuperAdminRepairsPage({
  searchParams
}: {
  searchParams: Promise<RepairSearchParams>;
}) {
  const filters = await searchParams;
  const { profile, adminSupabase } = await requireSuperAdminAdminClient();
  const issues = await loadRepairIssues(adminSupabase);
  const kind = isIssueKind(filters.kind) ? filters.kind : null;
  const visibleIssues = kind ? issues.filter((issue) => issue.kind === kind) : issues;
  const highCount = issues.filter((issue) => issue.severity === "high").length;
  const countByKind = new Map<RepairIssueKind, number>();
  for (const issue of issues) countByKind.set(issue.kind, (countByKind.get(issue.kind) ?? 0) + 1);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gold">Platform health</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">Repairs and inconsistencies</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              Find access and setup states that cannot be inferred from a normal list. Each repair opens the existing guarded person or masjid workflow so history and authorization rules remain intact.
            </p>
          </div>
          <Link className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50" href="/super-admin/audit">
            Review audit log
          </Link>
        </div>

        <section aria-label="Repair summary" className="mt-7 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-stone-500">Open findings</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{issues.length}</p>
          </div>
          <div className={`rounded-xl border p-5 shadow-sm ${highCount ? "border-red-200 bg-red-50" : "border-stone-200 bg-white"}`}>
            <p className="text-sm text-stone-600">High priority</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{highCount}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-stone-500">Checks run</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{Object.keys(KIND_LABELS).length}</p>
          </div>
        </section>

        <nav aria-label="Repair categories" className="mt-6 flex gap-2 overflow-x-auto pb-2">
          <Link className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${!kind ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-ink"}`} href="/super-admin/repairs">
            All · {issues.length}
          </Link>
          {(Object.entries(KIND_LABELS) as Array<[RepairIssueKind, string]>).map(([value, label]) => (
            <Link className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${kind === value ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-ink"}`} href={`/super-admin/repairs?kind=${value}`} key={value}>
              {label} · {countByKind.get(value) ?? 0}
            </Link>
          ))}
        </nav>

        {visibleIssues.length === 0 ? (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-6">
            <h2 className="font-semibold text-green-900">No matching inconsistencies</h2>
            <p className="mt-1 text-sm text-green-800">The current database and Auth state passed this set of checks.</p>
          </div>
        ) : (
          <ol className="mt-4 space-y-3">
            {visibleIssues.map((issue) => (
              <li className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm" key={issue.id}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${issue.severity === "high" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                        {issue.severity === "high" ? "High priority" : "Review"}
                      </span>
                      <span className="text-xs font-semibold text-stone-500">{KIND_LABELS[issue.kind]}</span>
                    </div>
                    <h2 className="mt-3 font-semibold text-ink">{issue.title}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-600">{issue.description}</p>
                    <p className="mt-2 text-xs text-stone-500">{issue.scope}</p>
                  </div>
                  {issue.href && issue.actionLabel ? (
                    <Link className="shrink-0 rounded-lg bg-moss px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-ink" href={issue.href}>
                      {issue.actionLabel}
                    </Link>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-600">Manual reconciliation required</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
