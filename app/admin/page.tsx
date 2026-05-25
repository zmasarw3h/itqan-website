import Link from "next/link";
import AppNav from "@/app/nav";
import LeaderboardTable from "@/app/admin/leaderboard-table";
import LeaderboardFilters from "@/app/admin/leaderboard/leaderboard-filters";
import { requireProfile } from "@/lib/supabase-server";
import { loadLeaderboardData, type LeaderboardSearchParams } from "./leaderboard/data";

export const dynamic = "force-dynamic";

function leaderboardExportHref(weekStart: string, below70Only: boolean) {
  const params = new URLSearchParams({ week: weekStart });

  if (below70Only) {
    params.set("below70", "1");
  }

  return `/admin/export?${params.toString()}`;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<LeaderboardSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const data = await loadLeaderboardData(supabase, resolvedSearchParams);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Admin Dashboard</h1>
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

        <LeaderboardTable rows={data.rows} />
      </main>
    </>
  );
}
