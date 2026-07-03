import Link from "next/link";
import AppNav from "@/app/nav";
import { adminScopedStudentToProfile, loadAdminStudentsForWeek } from "@/lib/admin-scope";
import { formatWeekRange, todayDateString, weekStartForDate } from "@/lib/dates";
import {
  buildMonthlyBadgeLeaderboard,
  formatMonthLabel,
  isValidMonthString,
  monthStartForDate,
  monthStartForMonthString
} from "@/lib/rewards";
import { requireProfile } from "@/lib/supabase-server";
import { loadComputedBadgeAwards } from "@/lib/weekly-incentives";

export const dynamic = "force-dynamic";

type AdminRewardsSearchParams = {
  month?: string;
};

function selectedMonthStart(value: string | undefined) {
  if (!value || !isValidMonthString(value)) {
    return monthStartForDate(todayDateString());
  }

  return monthStartForMonthString(value);
}

function monthValue(monthStart: string) {
  return monthStart.slice(0, 7);
}

export default async function AdminRewardsPage({
  searchParams
}: {
  searchParams: Promise<AdminRewardsSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const monthStart = selectedMonthStart(resolvedSearchParams.month);
  const currentWeekStart = weekStartForDate(todayDateString());
  const students = (await loadAdminStudentsForWeek(supabase, currentWeekStart)).map(adminScopedStudentToProfile);
  const awards = await loadComputedBadgeAwards({ supabase, students });
  const availableMonthStarts = [
    ...new Set([monthStart, monthStartForDate(todayDateString()), ...awards.map((award) => `${award.week_start.slice(0, 7)}-01`)])
  ].sort((a, b) => b.localeCompare(a));
  const rows = buildMonthlyBadgeLeaderboard({
    students,
    awards,
    monthStart
  });

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Badge Rewards</h1>
            <p className="mt-1 text-sm text-stone-600">
              Monthly badge leaderboard from completed weekly scores above 90%.
            </p>
          </div>
          <form className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">Month</span>
              <select
                className="mt-1 min-w-52 rounded-md border border-stone-300 px-3 py-2"
                defaultValue={monthValue(monthStart)}
                name="month"
              >
                {availableMonthStarts.map((availableMonthStart) => (
                  <option key={availableMonthStart} value={monthValue(availableMonthStart)}>
                    {formatMonthLabel(availableMonthStart)}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">View month</button>
          </form>
        </div>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">{formatMonthLabel(monthStart)} Leaderboard</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead>
                <tr className="text-left text-stone-600">
                  <th className="px-3 py-2 font-medium">Rank</th>
                  <th className="px-3 py-2 font-medium">Student</th>
                  <th className="px-3 py-2 font-medium">Month badges</th>
                  <th className="px-3 py-2 font-medium">Lifetime badges</th>
                  <th className="px-3 py-2 font-medium">Recent weekly awards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((row) => (
                  <tr key={row.studentId}>
                    <td className="px-3 py-3 font-semibold text-ink">{row.rank}</td>
                    <td className="px-3 py-3">
                      <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${row.studentId}`}>
                        {row.studentName}
                      </Link>
                      <p className="mt-1 text-xs text-stone-500">{row.studentPhone || row.studentEmail}</p>
                    </td>
                    <td className="px-3 py-3 font-semibold text-ink">{row.monthBadges}</td>
                    <td className="px-3 py-3 text-stone-700">{row.lifetimeBadges}</td>
                    <td className="px-3 py-3 text-stone-700">
                      {row.recentAwards.length ? (
                        <div className="space-y-2">
                          {row.recentAwards.map((award) => (
                            <div key={award.id}>
                              <span className="font-medium text-ink">{formatWeekRange(award.week_start)}</span>
                              <span className="text-stone-500">
                                {" "}
                                · {award.badges_awarded} {award.badges_awarded === 1 ? "badge" : "badges"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-stone-500">No awards yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
