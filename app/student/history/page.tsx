import AppNav from "@/app/nav";
import {
  formatWeekRange,
  friendlyDate,
  isValidDateString,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import { calculateWeeklyAverage, formatScore } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

export default async function StudentHistoryPage({
  searchParams
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(resolvedSearchParams.week, currentWeekStart);
  const weekDates = weekDatesFromStart(selectedWeekStart);
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
  const checkinByDate = new Map((checkins ?? []).map((checkin) => [checkin.date, checkin]));
  const availableWeekStarts = [
    ...new Set([currentWeekStart, selectedWeekStart, ...(checkins ?? []).map((checkin) => weekStartForDate(checkin.date))])
  ].sort((a, b) => b.localeCompare(a));
  const weeklyAverage = calculateWeeklyAverage(
    weekDates.filter((date) => date <= today).map((date) => scoreByDate.get(date) ?? 0)
  );

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">My History</h1>
            <p className="mt-2 text-stone-600">Detailed daily log for {formatWeekRange(selectedWeekStart)}</p>
          </div>
          <div className="rounded-md bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200">
            <p className="text-xs font-medium uppercase text-stone-500">Week average</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatScore(weeklyAverage) || "None"}</p>
          </div>
        </div>

        <form className="mt-6 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <label className="block">
            <span className="text-sm font-medium text-ink">Week</span>
            <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
              <select
                className="w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
                defaultValue={selectedWeekStart}
                name="week"
              >
                {availableWeekStarts.map((weekStart) => (
                  <option key={weekStart} value={weekStart}>
                    {formatWeekRange(weekStart)}
                  </option>
                ))}
              </select>
              <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">View</button>
            </div>
          </label>
        </form>

        <section className="mt-6 grid gap-4">
          {weekDates.map((date) => {
            const checkin = checkinByDate.get(date);
            const isFuture = date > today;

            return (
              <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" key={date}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-ink">{friendlyDate(date)}</h2>
                    {checkin ? (
                      <p className="mt-1 text-sm text-stone-600">
                        Submitted {new Date(checkin.submitted_at).toLocaleString()}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-stone-600">{isFuture ? "Not due yet" : "No check-in submitted"}</p>
                    )}
                  </div>
                  <div className="text-left sm:text-right">
                    <p
                      className={
                        checkin
                          ? "text-lg font-semibold text-green-700"
                          : isFuture
                            ? "text-lg font-semibold text-stone-500"
                            : "text-lg font-semibold text-amber-700"
                      }
                    >
                      {checkin ? formatScore(checkin.daily_score) : isFuture ? "Upcoming" : "Missing"}
                    </p>
                    {checkin ? (
                      <p className="text-sm text-stone-600">
                        {checkin.earned_weight ?? 0}/{checkin.total_weight ?? 0}
                      </p>
                    ) : null}
                  </div>
                </div>

                {checkin ? (
                  <>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {(itemsByCheckInId.get(checkin.id) ?? []).map((item) => (
                        <div
                          className="flex items-start justify-between gap-3 rounded-md bg-stone-50 px-3 py-2 text-sm"
                          key={item.id}
                        >
                          <span className={item.completed ? "min-w-0 break-words text-ink" : "min-w-0 break-words text-stone-500"}>
                            {item.completed ? "Done" : "Missed"}: {item.task_label}
                          </span>
                          <span className="shrink-0 text-stone-600">{item.weight}</span>
                        </div>
                      ))}
                    </div>
                    {checkin.note ? <p className="mt-3 break-words text-sm text-stone-700">Note: {checkin.note}</p> : null}
                  </>
                ) : null}
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
