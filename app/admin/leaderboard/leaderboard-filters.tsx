"use client";

import { useRouter } from "next/navigation";
import { formatWeekRange } from "@/lib/dates";

export default function LeaderboardFilters({
  availableWeekStarts,
  selectedWeekStart,
  below70Only
}: {
  availableWeekStarts: string[];
  selectedWeekStart: string;
  below70Only: boolean;
}) {
  const router = useRouter();

  function updateFilters(next: { weekStart?: string; below70Only?: boolean }) {
    const weekStart = next.weekStart ?? selectedWeekStart;
    const shouldShowBelow70Only = next.below70Only ?? below70Only;
    const params = new URLSearchParams({ week: weekStart });

    if (shouldShowBelow70Only) {
      params.set("below70", "1");
    }

    router.replace(`/admin/leaderboard?${params.toString()}`);
  }

  return (
    <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <label className="block min-w-0">
        <span className="text-sm font-medium text-ink">Week</span>
        <select
          className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
          onChange={(event) => updateFilters({ weekStart: event.target.value })}
          value={selectedWeekStart}
        >
          {availableWeekStarts.map((weekStart) => (
            <option key={weekStart} value={weekStart}>
              {formatWeekRange(weekStart)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm text-ink">
        <input
          checked={below70Only}
          onChange={(event) => updateFilters({ below70Only: event.target.checked })}
          type="checkbox"
        />
        Show below-70 students only
      </label>
    </div>
  );
}
