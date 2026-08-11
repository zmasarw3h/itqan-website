import Link from "next/link";
import { ArrowRight, CalendarBlank, CheckCircle, Clock } from "@phosphor-icons/react/dist/ssr";
import Below70StreakReset from "./below70-streak-reset";
import type { AdminStudentOverviewData, AdminStudentWorkspaceShell } from "@/lib/admin-student-workspace";
import { addDays, checkInEffectiveDateString, formatWeekRange, friendlyDate } from "@/lib/dates";
import { PASSING_PERCENTAGE } from "@/lib/leaderboard";

type DayStatus = "saved" | "missing" | "open" | "upcoming";

function weekIsComplete(weekStart: string, today: string) {
  return addDays(weekStart, 6) < today;
}

function scoreStatus(input: { percentage: number; complete: boolean; scorable: boolean }) {
  if (!input.scorable) return { label: "Orientation", heading: "Official score excluded", className: "bg-blue-50 text-blue-800" };
  if (!input.complete) return { label: "In progress", heading: "Week score so far", className: "bg-[#eef1eb] text-ink" };
  if (input.percentage >= PASSING_PERCENTAGE) return { label: "Passing", heading: "Final weekly score", className: "bg-green-50 text-green-800" };
  return { label: "Below 70%", heading: "Final weekly score", className: "bg-red-50 text-red-800" };
}

function statusForDate(date: string, today: string, saved: boolean): DayStatus {
  if (saved) return "saved";
  if (date === today) return "open";
  return date < today ? "missing" : "upcoming";
}

function statusCopy(status: DayStatus, score: number | null) {
  if (status === "saved") return `Saved · ${Math.round(Number(score ?? 0))}%`;
  if (status === "missing") return "Missing";
  if (status === "open") return "Open today";
  return "Upcoming · Not due";
}

export default function OverviewSection({
  shell,
  overview
}: {
  shell: AdminStudentWorkspaceShell;
  overview: AdminStudentOverviewData;
}) {
  const today = checkInEffectiveDateString();
  const selectedWeekScorable = Boolean(
    shell.student.score_starts_on && shell.selectedWeekStart >= shell.student.score_starts_on
  );
  const status = scoreStatus({
    percentage: overview.weeklyScore.percentage,
    complete: weekIsComplete(shell.selectedWeekStart, today),
    scorable: selectedWeekScorable
  });
  const checkinByDate = new Map(overview.checkins.map((checkin) => [checkin.date, checkin]));
  const dueDates = Array.from({ length: 7 }, (_, index) => addDays(shell.selectedWeekStart, index))
    .filter((date) => date <= today);
  const missingDates = dueDates.filter((date) => date < today && !checkinByDate.has(date));
  const visibleDays = Array.from({ length: 3 }, (_, index) => addDays(shell.selectedWeekStart, index));

  return (
    <div className="py-6 md:py-8">
      <section className="border-b border-stone-200 pb-6 md:min-h-[225px] md:rounded-lg md:border md:bg-white md:p-6" data-qa="score-summary">
        <div className="grid gap-7 md:grid-cols-[1.05fr_2fr] md:items-center">
          <div>
            <p className="text-base font-medium text-ink">{status.heading}</p>
            <div className="mt-2 flex items-center gap-4">
              <p className="text-5xl font-semibold tracking-tight text-ink">{overview.weeklyScore.percentage}%</p>
              <span className={`rounded-full px-4 py-2 text-sm font-medium ${status.className}`}>{status.label}</span>
            </div>
            <p className="mt-2 text-base text-stone-600">Week of {formatWeekRange(shell.selectedWeekStart)}</p>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-stone-200 text-center md:text-left" data-qa="score-breakdown">
            {[
              ["Daily", overview.weeklyScore.daily_points, 700],
              ["Partner", overview.weeklyScore.partner_points, 150],
              ["Halaqa", overview.weeklyScore.halaqa_points, 150]
            ].map(([label, points, possible]) => (
              <div className="min-w-0 px-3 first:pl-0 last:pr-0 md:px-8" key={String(label)}>
                <dt className="text-sm text-stone-600">{label}</dt>
                <dd className="mt-2 whitespace-nowrap text-lg font-semibold text-ink md:text-2xl">{points} / {possible}</dd>
              </div>
            ))}
          </dl>
        </div>

        {!selectedWeekScorable ? (
          <p className="mt-5 rounded-md bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
            This orientation week remains available, but it is excluded from official scoring, streaks, rewards, and accountability.
          </p>
        ) : null}

        <div className="mt-5 grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-stretch divide-x divide-stone-200 rounded-md border border-stone-200 text-center text-sm text-ink md:flex md:justify-start md:text-left" data-qa="due-day-summary">
          <p className="flex min-w-0 items-center justify-center gap-3 px-3 py-3 sm:px-4 md:justify-start">
            <CheckCircle aria-hidden="true" className="shrink-0 text-green-800" size={20} weight="fill" />
            <span><strong>{overview.dailyProgress.submitted_days} / {overview.dailyProgress.due_days}</strong> due days saved</span>
          </p>
          <p className="flex min-w-0 items-center justify-center break-words px-3 py-3 text-stone-700 sm:px-4 md:px-8">
            {missingDates.length ? `${missingDates.length} missing due ${missingDates.length === 1 ? "day" : "days"}` : "No missing due days"}
          </p>
        </div>
      </section>

      <div className="grid md:grid-cols-[0.9fr_1.1fr] md:gap-4">
        <Below70StreakReset
          initialLoadError={!overview.below70Streak}
          initialStreak={overview.below70Streak}
          studentId={shell.student.id}
          workspace
        />

        <section className="border-b border-stone-200 py-6 md:mt-4 md:min-h-[360px] md:rounded-lg md:border md:bg-white md:p-6" data-qa="recent-week-activity">
          <h2 className="text-xl font-semibold text-ink">Recent week activity</h2>
          <div className="mt-4 overflow-hidden rounded-md border border-stone-200">
            {visibleDays.map((date) => {
              const checkin = checkinByDate.get(date);
              const dayStatus = statusForDate(date, today, Boolean(checkin));
              const Icon = dayStatus === "saved" ? CheckCircle : dayStatus === "upcoming" ? CalendarBlank : Clock;
              return (
                <div className="grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-stone-200 px-4 py-3 last:border-b-0" key={date}>
                  <span className={`grid size-9 place-items-center rounded-full ${dayStatus === "saved" ? "bg-green-50 text-green-800" : "bg-stone-100 text-stone-700"}`}>
                    <Icon aria-hidden="true" size={20} weight={dayStatus === "saved" ? "fill" : "regular"} />
                  </span>
                  <span className="text-sm font-medium text-ink md:text-base">{friendlyDate(date)}</span>
                  <span className={`text-right text-sm ${dayStatus === "saved" ? "text-green-800" : dayStatus === "missing" ? "text-red-800" : "text-stone-600"}`}>
                    {statusCopy(dayStatus, checkin?.daily_score ?? null)}
                  </span>
                </div>
              );
            })}
            <Link
              className="flex min-h-14 items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-moss hover:bg-stone-50"
              href={`/admin/students/${encodeURIComponent(shell.student.id)}?week=${encodeURIComponent(shell.selectedWeekStart)}&view=activity`}
              prefetch={false}
            >
              View weekly activity <ArrowRight aria-hidden="true" size={20} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
