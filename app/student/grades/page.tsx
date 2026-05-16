import Link from "next/link";
import AppNav from "@/app/nav";
import { currentWeekDates, friendlyDate, todayDateString } from "@/lib/dates";
import { calculateWeeklyAverage, formatScore } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StudentGradesPage() {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const weekDates = currentWeekDates(today);
  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", profile.id)
    .in("date", weekDates)
    .returns<CheckIn[]>();
  const checkinByDate = new Map((checkins ?? []).map((checkin) => [checkin.date, checkin]));
  const datesSoFar = weekDates.filter((date) => date <= today);
  const weeklyAverage = calculateWeeklyAverage(
    datesSoFar.map((date) => checkinByDate.get(date)?.daily_score ?? 0)
  );

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Grades</h1>
            <p className="mt-1 text-stone-600">Current week summary</p>
          </div>
          <Link className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium" href="/student/history">
            Detailed history
          </Link>
        </div>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium uppercase text-stone-500">Average so far</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatScore(weeklyAverage) || "None"}</p>
        </section>

        <section className="mt-6 grid gap-3">
          {weekDates.map((date) => {
            const checkin = checkinByDate.get(date);
            const isFuture = date > today;

            return (
              <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" key={date}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-ink">{friendlyDate(date)}</h2>
                    <p className="mt-1 text-sm text-stone-600">
                      {checkin
                        ? `${checkin.earned_weight ?? 0}/${checkin.total_weight ?? 0}`
                        : isFuture
                          ? "Not due"
                          : "No check-in submitted"}
                    </p>
                  </div>
                  <p
                    className={
                      checkin
                        ? "shrink-0 font-semibold text-green-700"
                        : isFuture
                          ? "shrink-0 font-semibold text-stone-500"
                          : "shrink-0 font-semibold text-amber-700"
                    }
                  >
                    {checkin ? formatScore(checkin.daily_score) : isFuture ? "Upcoming" : "Missing"}
                  </p>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
