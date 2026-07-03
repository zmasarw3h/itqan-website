import AppNav from "@/app/nav";
import { StudentSetupIncomplete } from "@/app/student/student-week-context";
import { formatWeekRange, todayDateString, weekStartForDate } from "@/lib/dates";
import {
  buildStudentRewardSummary,
  formatMonthLabel,
  monthStartForDate
} from "@/lib/rewards";
import { loadStudentScopeForWeek } from "@/lib/student-scope";
import { requireProfile } from "@/lib/supabase-server";
import { loadComputedBadgeAwards } from "@/lib/weekly-incentives";

export const dynamic = "force-dynamic";

export default async function StudentRewardsPage() {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const studentScope = await loadStudentScopeForWeek(supabase, profile.id, currentWeekStart);

  if (!studentScope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={currentWeekStart} />;
  }

  const currentMonthStart = monthStartForDate(today);
  const studentAwards = await loadComputedBadgeAwards({
    supabase,
    studentId: profile.id
  });
  const summary = buildStudentRewardSummary({
    awards: studentAwards,
    monthStart: currentMonthStart
  });
  const recentAwards = studentAwards.slice(0, 8);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-sm font-medium uppercase text-moss">Rewards</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">Badge Awards</h1>
            <p className="mt-1 text-sm text-stone-600">
              Earn one badge for each percentage point above 90% in a completed week.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-md bg-stone-50 p-5">
              <p className="text-sm font-medium uppercase text-stone-500">Total badges</p>
              <p className="mt-2 text-4xl font-semibold text-ink">{summary.totalBadges}</p>
            </div>
            <div className="rounded-md bg-stone-50 p-5">
              <p className="text-sm font-medium uppercase text-stone-500">
                {formatMonthLabel(currentMonthStart)}
              </p>
              <p className="mt-2 text-4xl font-semibold text-ink">{summary.monthBadges}</p>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Recent Badge Awards</h2>
          {recentAwards.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="px-3 py-2 font-medium">Week</th>
                    <th className="px-3 py-2 font-medium">Weekly score</th>
                    <th className="px-3 py-2 font-medium">Badges</th>
                    <th className="px-3 py-2 font-medium">Week completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {recentAwards.map((award) => (
                    <tr key={award.id}>
                      <td className="px-3 py-3 text-ink">{formatWeekRange(award.week_start)}</td>
                      <td className="px-3 py-3 text-stone-700">{Number(award.weekly_percentage)}%</td>
                      <td className="px-3 py-3 font-semibold text-ink">{award.badges_awarded}</td>
                      <td className="px-3 py-3 text-stone-700">{formatWeekRange(award.week_start)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 rounded-md bg-stone-50 p-4 text-sm text-stone-600">
              No badge awards yet.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
