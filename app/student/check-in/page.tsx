import AppNav from "@/app/nav";
import { submitTodayCheckIn } from "@/app/student/actions";
import { friendlyDate, todayDateString } from "@/lib/dates";
import { formatScore, tasksForDate } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StudentCheckInPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const { data: checkin } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", profile.id)
    .eq("date", today)
    .maybeSingle<CheckIn>();

  const { data: items } = checkin
    ? await supabase
        .from("checkin_items")
        .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
        .eq("checkin_id", checkin.id)
        .order("created_at", { ascending: true })
        .returns<CheckInItem[]>()
    : { data: [] };

  const alreadySubmitted = Boolean(checkin);
  const todayTasks = tasksForDate(today);
  const completedItems = (items ?? []).filter((item) => item.completed);
  const missedItems = (items ?? []).filter((item) => !item.completed);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Today&apos;s Check-In</h1>
              <p className="mt-1 text-stone-600">{profile.name}</p>
              <p className="mt-1 text-sm text-stone-500">{friendlyDate(today)}</p>
            </div>
            {!alreadySubmitted ? (
              <div className="rounded-md bg-amber-50 px-4 py-3 text-right">
                <p className="text-xs font-medium uppercase text-amber-700">Not submitted</p>
                <p className="mt-1 text-2xl font-semibold text-ink">Today</p>
              </div>
            ) : null}
          </div>

          {resolvedSearchParams.status === "submitted" ? (
            <p className="mt-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Check-in submitted.
            </p>
          ) : null}
          {resolvedSearchParams.status === "duplicate" ? (
            <p className="mt-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You already have a check-in for today.
            </p>
          ) : null}
          {resolvedSearchParams.status === "error" ? (
            <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to submit. Please try again.
            </p>
          ) : null}
        </section>

        {alreadySubmitted ? (
          <section className="mt-6 rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">Submitted Summary</h2>
                <p className="mt-1 text-sm text-stone-600">
                  Submitted {checkin ? new Date(checkin.submitted_at).toLocaleString() : ""}
                </p>
              </div>
              <div className="rounded-md bg-stone-50 px-4 py-3 text-right">
                <p className="text-3xl font-semibold text-ink">{formatScore(checkin?.daily_score)}</p>
                <p className="text-sm text-stone-600">
                  {checkin?.earned_weight ?? 0}/{checkin?.total_weight ?? 0}
                </p>
              </div>
            </div>

            {checkin?.note ? <p className="mt-4 text-sm text-stone-700">Note: {checkin.note}</p> : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Completed checklist items</h3>
                {completedItems.length ? (
                  <ul className="mt-2 space-y-2">
                    {completedItems.map((item) => (
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
                {missedItems.length ? (
                  <ul className="mt-2 space-y-2">
                    {missedItems.map((item) => (
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
          </section>
        ) : (
          <section className="mt-6 rounded-lg border-2 border-moss bg-white p-6 shadow-sm">
            <div>
              <p className="text-sm font-medium uppercase text-moss">Active check-in</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">Today&apos;s checklist</h2>
              <p className="mt-1 text-sm text-stone-600">
                Select the items you completed, then submit once for today.
              </p>
            </div>

            <form action={submitTodayCheckIn} className="mt-5 space-y-5">
              <fieldset>
                <legend className="sr-only">Today&apos;s checklist</legend>
                <div className="grid gap-3">
                  {todayTasks.map((task) => (
                    <label
                      className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-stone-200 bg-white p-4 transition has-[:checked]:border-moss has-[:checked]:bg-moss/5"
                      key={task.key}
                    >
                      <span className="flex items-start gap-3">
                        <input className="mt-1 h-4 w-4 accent-moss" name="task_keys" type="checkbox" value={task.key} />
                        <span className="text-sm font-medium text-ink">{task.label}</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-stone-50 px-2 py-1 text-sm font-medium text-stone-700">
                        {task.weight}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="text-sm font-medium text-ink">Optional note</span>
                <textarea
                  className="mt-1 min-h-28 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
                  name="note"
                  placeholder="Anything admin should know?"
                />
              </label>
              <button className="rounded-md bg-moss px-4 py-2.5 font-medium text-white hover:bg-ink">
                Submit check-in
              </button>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
