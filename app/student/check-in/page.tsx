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

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-ink">Today&apos;s Check-In</h1>
            <p className="mt-1 text-stone-600">
              {profile.name} · {friendlyDate(today)}
            </p>
          </div>

          {resolvedSearchParams.status === "submitted" ? (
            <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Check-in submitted.
            </p>
          ) : null}
          {resolvedSearchParams.status === "duplicate" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You already have a check-in for today.
            </p>
          ) : null}
          {resolvedSearchParams.status === "error" ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to submit. Please try again.
            </p>
          ) : null}

          {alreadySubmitted ? (
            <div className="rounded-md bg-stone-50 p-4">
              <p className="font-medium text-ink">Submitted - {formatScore(checkin?.daily_score)}</p>
              <p className="mt-1 text-sm text-stone-600">
                Score {checkin?.earned_weight ?? 0}/{checkin?.total_weight ?? 0} -{" "}
                Recorded at {checkin ? new Date(checkin.submitted_at).toLocaleString() : ""}
              </p>
              <ul className="mt-4 space-y-2">
                {(items ?? []).map((item) => (
                  <li className="flex items-start justify-between gap-4 text-sm" key={item.id}>
                    <span className={item.completed ? "text-ink" : "text-stone-500"}>
                      {item.completed ? "Done" : "Missed"}: {item.task_label}
                    </span>
                    <span className="shrink-0 text-stone-600">{item.weight}</span>
                  </li>
                ))}
              </ul>
              {checkin?.note ? <p className="mt-3 text-sm text-stone-700">Note: {checkin.note}</p> : null}
            </div>
          ) : (
            <form action={submitTodayCheckIn} className="space-y-4">
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-ink">Today&apos;s checklist</legend>
                {todayTasks.map((task) => (
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
          )}
        </section>
      </main>
    </>
  );
}
