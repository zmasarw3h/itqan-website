import AppNav from "@/app/nav";
import { formatWeekRange, friendlyDate, isValidDateString, todayDateString, weekDatesFromStart, weekStartForDate } from "@/lib/dates";
import { buildHistoryDayRows, studentHistoryScope } from "@/lib/history";
import { formatScore } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem } from "@/lib/types";

export const dynamic = "force-dynamic";

type HistorySearchParams = {
  week?: string;
};

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

export default async function StudentHistoryPage({
  searchParams
}: {
  searchParams: Promise<HistorySearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const currentWeekStart = weekStartForDate(todayDateString());
  const selectedWeekStart = validWeekStart(resolvedSearchParams.week, currentWeekStart);
  const selectedWeekDates = weekDatesFromStart(selectedWeekStart);
  const scope = studentHistoryScope(profile.id, selectedWeekStart, selectedWeekDates);

  const { data: checkinDates } = await supabase
    .from("checkins")
    .select("date")
    .eq("student_id", scope.studentId)
    .order("date", { ascending: false })
    .returns<Array<{ date: string }>>();
  const availableWeekStarts = [
    ...new Set([
      currentWeekStart,
      scope.weekStart,
      ...(checkinDates ?? []).map((checkin) => weekStartForDate(checkin.date))
    ])
  ].sort((a, b) => b.localeCompare(a));

  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", scope.studentId)
    .in("date", scope.weekDates)
    .order("date", { ascending: true })
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
  const historyDays = buildHistoryDayRows({
    weekDates: scope.weekDates,
    checkins: checkins ?? [],
    items: items ?? []
  });

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink">My History</h1>
              <p className="mt-1 text-stone-600">Week of {formatWeekRange(scope.weekStart)}</p>
            </div>
            <form>
              <label className="block min-w-56">
                <span className="text-sm font-medium text-ink">Week</span>
                <select
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  defaultValue={scope.weekStart}
                  name="week"
                >
                  {availableWeekStarts.map((weekStart) => (
                    <option key={weekStart} value={weekStart}>
                      {formatWeekRange(weekStart)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="mt-2 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">
                View week
              </button>
            </form>
          </div>
        </section>

        <div className="mt-6 space-y-4">
          {historyDays.map((day) => (
            <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm" key={day.date}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{friendlyDate(day.date)}</h2>
                  {day.checkin ? (
                    <p className="mt-1 text-sm text-stone-600">
                      Submitted {new Date(day.checkin.submitted_at).toLocaleString()}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-stone-600">{day.missingMessage}</p>
                  )}
                </div>
                {day.checkin ? (
                  <div className="rounded-md bg-stone-50 px-4 py-3 text-right">
                    <p className="text-xl font-semibold text-ink">{formatScore(day.checkin.daily_score)}</p>
                    <p className="text-sm text-stone-600">
                      {day.checkin.earned_weight ?? 0}/{day.checkin.total_weight ?? 0}
                    </p>
                  </div>
                ) : (
                  <span className="rounded-md bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
                    Missing
                  </span>
                )}
              </div>

              {day.checkin?.note ? <p className="mt-4 text-sm text-stone-700">Note: {day.checkin.note}</p> : null}

              {day.checkin ? (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Completed checklist items</h3>
                    {day.completedItems.length ? (
                      <ul className="mt-2 space-y-2">
                        {day.completedItems.map((item) => (
                          <li className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900" key={item.id}>
                            {item.task_label}
                            <span className="block text-xs text-green-700">{item.weight} points</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">None.</p>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Missed checklist items</h3>
                    {day.missedItems.length ? (
                      <ul className="mt-2 space-y-2">
                        {day.missedItems.map((item) => (
                          <li className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-700" key={item.id}>
                            {item.task_label}
                            <span className="block text-xs text-stone-500">{item.weight} points</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">None.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
