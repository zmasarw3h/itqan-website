import AppNav from "@/app/nav";
import { StudentSetupIncomplete } from "@/app/student/student-week-context";
import { formatWeekRange } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import { studentRankChangeLabel, studentRankChangeSymbol, type StudentLeaderboardRow } from "@/lib/student-leaderboard";
import { loadStudentLeaderboardData, type StudentLeaderboardSearchParams } from "./data";

export const dynamic = "force-dynamic";

function RankChange({ row }: { row: StudentLeaderboardRow }) {
  const value = studentRankChangeSymbol(row.rankChange);
  const tone =
    row.rankChange === null
      ? "bg-stone-100 text-stone-700"
      : row.rankChange > 0
        ? "bg-green-50 text-green-800"
        : row.rankChange < 0
          ? "bg-rose-50 text-rose-800"
          : "bg-stone-100 text-stone-700";

  return <span className={`inline-flex min-w-14 justify-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{value}</span>;
}

export default async function StudentLeaderboardPage({
  searchParams
}: {
  searchParams: Promise<StudentLeaderboardSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const data = await loadStudentLeaderboardData(supabase, profile.id, resolvedSearchParams);

  if (!data.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={data.selectedWeekStart} />;
  }

  const currentRow = data.currentStudentRow;
  const nextRow = currentRow ? data.rows.find((row) => row.rank === currentRow.rank - 1) ?? null : null;
  const pointsBehindNext =
    currentRow && nextRow ? Math.max(0, Math.round((nextRow.totalPoints - currentRow.totalPoints) * 100) / 100) : null;
  const topScore = data.rows[0]?.scorePercentage ?? null;

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="overflow-hidden rounded-lg border border-stone-200 bg-ink text-white shadow-sm">
          <div className="grid gap-5 p-6 md:grid-cols-[1.2fr_0.8fr] md:items-end">
            <div>
              <p className="mb-2 text-sm font-semibold uppercase text-gold">Quran 83:26</p>
              <p className="text-right text-4xl font-semibold leading-relaxed text-stone-50 md:text-5xl" dir="rtl" lang="ar">
                وَفِي ذَٰلِكَ فَلْيَتَنَافَسِ ٱلْمُتَنَـٰفِسُونَ
              </p>
              <p className="mt-3 text-lg text-stone-200">
                So let whoever aspires to this strive diligently.
              </p>
            </div>
            <form className="rounded-md border border-white/15 bg-white/10 p-4">
              <label className="block">
                <span className="text-sm font-medium text-stone-100">Week</span>
                <select
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-ink"
                  defaultValue={data.selectedWeekStart}
                  name="week"
                >
                  {data.availableWeekStarts.map((weekStart) => (
                    <option key={weekStart} value={weekStart}>
                      {formatWeekRange(weekStart)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="mt-3 w-full rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-ink hover:bg-white">
                View week
              </button>
            </form>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Student Leaderboard</h1>
            <p className="mt-1 text-sm text-stone-600">
              Ranked weekly scores for {data.selectedWeekLabel}. Rank change compares against {data.previousWeekLabel}.
            </p>
          </div>
          <p className="rounded-full bg-white px-3 py-1 text-sm font-medium text-stone-700 ring-1 ring-stone-200">
            {data.selectedWeekComplete ? "Final" : "In progress"}
          </p>
        </div>

        <section className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-stone-600">Your rank</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{currentRow ? `#${currentRow.rank}` : "-"}</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-stone-600">Your score</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{currentRow ? `${currentRow.scorePercentage}%` : "-"}</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-stone-600">Rank change</p>
            <p className="mt-2 text-3xl font-semibold text-ink">
              {currentRow ? studentRankChangeLabel(currentRow.rankChange) : "-"}
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-stone-600">
              {pointsBehindNext === null ? "Top score" : "Behind next rank"}
            </p>
            <p className="mt-2 text-3xl font-semibold text-ink">
              {pointsBehindNext === null ? (topScore === null ? "-" : `${topScore}%`) : `${pointsBehindNext} pts`}
            </p>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Rank</th>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Weekly score</th>
                  <th className="px-4 py-3 font-medium">Total points</th>
                  <th className="px-4 py-3 font-medium">Change</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.rows.map((row) => (
                  <tr key={`${row.rank}-${row.studentName}`} className={row.isCurrentStudent ? "bg-gold/10" : "bg-white"}>
                    <td className="px-4 py-3 text-lg font-semibold text-ink">#{row.rank}</td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {row.studentName}
                      {row.isCurrentStudent ? <span className="ml-2 text-xs font-semibold text-gold">You</span> : null}
                    </td>
                    <td className="px-4 py-3 text-stone-700">{row.scorePercentage}%</td>
                    <td className="px-4 py-3 text-stone-700">{row.totalPoints} / 1000</td>
                    <td className="px-4 py-3">
                      <RankChange row={row} />
                    </td>
                    <td className="px-4 py-3 text-stone-700">{row.statusLabel}</td>
                  </tr>
                ))}
                {data.rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-stone-600" colSpan={6}>
                      No leaderboard data is available for this week.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
