import AppNav from "@/app/nav";
import { currentWeekDates, friendlyDate, todayDateString } from "@/lib/dates";
import { calculateWeeklyAverage, formatScore } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StudentHistoryPage() {
  const { supabase, profile } = await requireProfile(["student"]);
  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", profile.id)
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

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-ink">My History</h1>
        <p className="mt-2 text-stone-600">Current week average: {formatScore(weeklyAverage)}</p>
        <div className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-stone-50 text-ink">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Checklist</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
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
                  <td className="px-4 py-3 text-stone-600">{checkin.note ?? ""}</td>
                </tr>
              ))}
              {checkins?.length ? null : (
                <tr>
                  <td className="px-4 py-6 text-stone-600" colSpan={5}>
                    No check-ins yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
