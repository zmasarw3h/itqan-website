import Link from "next/link";
import AppNav from "@/app/nav";
import { leaderboardStatusLabel } from "@/lib/leaderboard";
import { requireProfile } from "@/lib/supabase-server";
import LeaderboardFilters from "./leaderboard-filters";
import { loadLeaderboardData, type LeaderboardSearchParams } from "./data";

export const dynamic = "force-dynamic";

function leaderboardExportHref(weekStart: string, below70Only: boolean) {
  const params = new URLSearchParams({ week: weekStart });

  if (below70Only) {
    params.set("below70", "1");
  }

  return `/admin/leaderboard/export?${params.toString()}`;
}

function statusClass(status: string) {
  if (status === "passing") return "text-green-700";
  if (status === "below_70" || status === "below_70_so_far") return "text-red-700";
  return "text-stone-600";
}

export default async function AdminLeaderboardPage({
  searchParams
}: {
  searchParams: Promise<LeaderboardSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const data = await loadLeaderboardData(supabase, resolvedSearchParams);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Leaderboard</h1>
            <p className="mt-1 text-sm text-stone-600">
              Weekly percentages are ranked for {data.selectedWeekLabel}.
            </p>
          </div>
          <Link
            className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink"
            href={leaderboardExportHref(data.selectedWeekStart, data.below70Only)}
          >
            Export CSV
          </Link>
        </div>

        <LeaderboardFilters
          availableWeekStarts={data.availableWeekStarts}
          below70Only={data.below70Only}
          selectedWeekStart={data.selectedWeekStart}
        />

        {data.selectedWeekComplete ? null : (
          <p className="mt-4 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
            This week is still in progress, so the below-70 streak only uses completed weeks.
          </p>
        )}

        <section className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-stone-50 text-ink">
              <tr>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Week %</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Below-70 Streak</th>
                <th className="px-4 py-3 font-medium">Daily</th>
                <th className="px-4 py-3 font-medium">Partner</th>
                <th className="px-4 py-3 font-medium">Halaqa</th>
                <th className="px-4 py-3 font-medium">Student Page</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {data.rows.map((row) => (
                <tr key={row.studentId}>
                  <td className="px-4 py-3 font-medium text-ink">#{row.rank}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{row.studentName}</p>
                    <p className="text-xs text-stone-500">{row.studentPhone || row.studentEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-xl font-semibold text-ink">{row.score.percentage}%</td>
                  <td className={`px-4 py-3 font-medium ${statusClass(row.status)}`}>
                    {leaderboardStatusLabel(row.status)}
                  </td>
                  <td className="px-4 py-3 text-stone-700">{row.below70Streak}</td>
                  <td className="px-4 py-3 text-stone-700">{row.score.daily_points} / 700</td>
                  <td className="px-4 py-3 text-stone-700">{row.score.partner_points} / 150</td>
                  <td className="px-4 py-3 text-stone-700">{row.score.halaqa_points} / 150</td>
                  <td className="px-4 py-3">
                    <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${row.studentId}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {data.rows.length ? null : (
                <tr>
                  <td className="px-4 py-6 text-stone-600" colSpan={9}>
                    No students match this leaderboard view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
