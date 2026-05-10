import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import { correctCheckIn } from "@/app/admin/actions";
import { currentWeekDates, friendlyDate, todayDateString } from "@/lib/dates";
import { allScoringTasks, calculateWeeklyAverage, formatScore } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminStudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const { data: student } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("id", resolvedParams.id)
    .eq("role", "student")
    .single<Profile>();

  if (!student) {
    notFound();
  }

  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", student.id)
    .order("date", { ascending: false })
    .returns<CheckIn[]>();
  const checkinIds = (checkins ?? []).map((checkin) => checkin.id);
  const { data: items } = checkinIds.length
    ? await supabase
        .from("checkin_items")
        .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
        .in("checkin_id", checkinIds)
        .order("created_at", { ascending: true })
        .returns<CheckInItem[]>()
    : { data: [] };
  const itemsByCheckInId = new Map<string, CheckInItem[]>();

  for (const item of items ?? []) {
    itemsByCheckInId.set(item.checkin_id, [...(itemsByCheckInId.get(item.checkin_id) ?? []), item]);
  }

  const scoreByDate = new Map((checkins ?? []).map((checkin) => [checkin.date, Number(checkin.daily_score ?? 0)]));
  const weeklyAverage = calculateWeeklyAverage(
    currentWeekDates(todayDateString()).map((date) => scoreByDate.get(date) ?? 0)
  );
  const correctionTasks = allScoringTasks();

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">{student.name}</h1>
          <p className="text-stone-600">{student.phone || student.email}</p>
          <p className="mt-1 text-stone-600">Current week average: {formatScore(weeklyAverage)}</p>
        </div>

        {resolvedSearchParams.status === "corrected" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Correction saved.
          </p>
        ) : null}
        {resolvedSearchParams.status === "correction-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save correction.
          </p>
        ) : null}

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Manual Correction</h2>
          <form action={correctCheckIn} className="mt-4 grid gap-4 md:grid-cols-4">
            <input name="student_id" type="hidden" value={student.id} />
            <label className="block">
              <span className="text-sm font-medium text-ink">Date</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                defaultValue={todayDateString()}
                name="date"
                required
                type="date"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Status</span>
              <select className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="status">
                <option value="submitted">Submitted</option>
                <option value="missing">Missing</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-ink">Note</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                name="note"
                placeholder="Optional correction note"
              />
            </label>
            <fieldset className="space-y-3 md:col-span-4">
              <legend className="text-sm font-medium text-ink">Completed tasks</legend>
              <div className="grid gap-3 md:grid-cols-2">
                {correctionTasks.map((task) => (
                  <label
                    className="flex items-start justify-between gap-4 rounded-md border border-stone-200 p-3"
                    key={task.key}
                  >
                    <span className="flex items-start gap-3">
                      <input className="mt-1 h-4 w-4" name="task_keys" type="checkbox" value={task.key} />
                      <span className="text-sm text-ink">{task.label}</span>
                    </span>
                    <span className="shrink-0 text-sm text-stone-600">{task.weight}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-4">
              <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
                Save correction
              </button>
            </div>
          </form>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">History</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-stone-50 text-ink">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Checklist</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {(checkins ?? []).map((checkin) => (
                  <tr key={checkin.id}>
                    <td className="px-4 py-3">{friendlyDate(checkin.date)}</td>
                    <td className="px-4 py-3 text-stone-700">
                      {formatScore(checkin.daily_score)}
                      <span className="block text-xs text-stone-500">
                        {checkin.earned_weight ?? 0}/{checkin.total_weight ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1">
                        {(itemsByCheckInId.get(checkin.id) ?? []).map((item) => (
                          <li className={item.completed ? "text-ink" : "text-stone-500"} key={item.id}>
                            {item.completed ? "Done" : "Missed"}: {item.task_label} ({item.weight})
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {new Date(checkin.submitted_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {checkin.updated_at ? new Date(checkin.updated_at).toLocaleString() : ""}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{checkin.note ?? ""}</td>
                  </tr>
                ))}
                {checkins?.length ? null : (
                  <tr>
                    <td className="px-4 py-6 text-stone-600" colSpan={6}>
                      No check-ins yet.
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
