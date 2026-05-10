import Link from "next/link";
import AppNav from "@/app/nav";
import { buildCompletionRows } from "@/lib/checkins";
import { currentWeekDates, friendlyDate, todayDateString } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CompletionStatus, DashboardFilters, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

type AdminSearchParams = {
  student?: string;
  date?: string;
  status?: CompletionStatus;
};

function cleanFilters(searchParams: AdminSearchParams): DashboardFilters {
  return {
    studentId: searchParams.student || undefined,
    date: searchParams.date || undefined,
    status:
      searchParams.status === "completed" || searchParams.status === "missing"
        ? searchParams.status
        : undefined
  };
}

function csvHref(filters: DashboardFilters) {
  const params = new URLSearchParams();
  if (filters.studentId) params.set("student", filters.studentId);
  if (filters.date) params.set("date", filters.date);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return query ? `/admin/export?${query}` : "/admin/export";
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const filters = cleanFilters(resolvedSearchParams);
  const dates = filters.date ? [filters.date] : currentWeekDates(todayDateString());

  const { data: students } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Profile[]>();

  let checkinQuery = supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,submitted_at,updated_at,updated_by_admin")
    .in("date", dates);

  if (filters.studentId) {
    checkinQuery = checkinQuery.eq("student_id", filters.studentId);
  }

  const { data: checkins } = await checkinQuery.returns<CheckIn[]>();
  const rows = buildCompletionRows(students ?? [], checkins ?? [], dates, filters);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Admin Dashboard</h1>
          </div>
          <Link
            className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink"
            href={csvHref(filters)}
          >
            Export CSV
          </Link>
        </div>

        <form className="mt-6 grid gap-4 rounded-lg border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-4">
          <label className="block">
            <span className="text-sm font-medium text-ink">Student</span>
            <select
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              defaultValue={filters.studentId ?? ""}
              name="student"
            >
              <option value="">All students</option>
              {(students ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Date</span>
            <input
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              defaultValue={filters.date ?? ""}
              name="date"
              type="date"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Status</span>
            <select
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
              defaultValue={filters.status ?? ""}
              name="status"
            >
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="missing">Missing</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">
              Apply
            </button>
            <Link className="rounded-md border border-stone-300 px-4 py-2.5 text-sm font-medium" href="/admin">
              Clear
            </Link>
          </div>
        </form>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Students</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {(students ?? []).map((student) => (
              <Link
                className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-moss"
                href={`/admin/students/${student.id}`}
                key={student.id}
              >
                <p className="font-medium text-ink">{student.name}</p>
                <p className="text-sm text-stone-600">{student.phone || student.email}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">
            {filters.date ? friendlyDate(filters.date) : "Current Week"} Completion
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-stone-50 text-ink">
                <tr>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map((row) => (
                  <tr key={`${row.studentId}-${row.date}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{row.studentName}</p>
                      <p className="text-xs text-stone-500">{row.studentPhone || row.studentEmail}</p>
                    </td>
                    <td className="px-4 py-3">{friendlyDate(row.date)}</td>
                    <td className="px-4 py-3">
                      <span className={row.completed ? "text-green-700" : "text-amber-700"}>
                        {row.completed ? "Completed" : "Missing"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {row.checkin ? new Date(row.checkin.submitted_at).toLocaleString() : ""}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{row.checkin?.note ?? ""}</td>
                    <td className="px-4 py-3">
                      <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${row.studentId}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {rows.length ? null : (
                  <tr>
                    <td className="px-4 py-6 text-stone-600" colSpan={6}>
                      No rows match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
