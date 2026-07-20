"use client";

import { useRouter } from "next/navigation";
import { formatWeekRange } from "@/lib/dates";

export default function TeacherWeekSelector({
  selectedWeekStart,
  weekStarts,
  path = "/teacher"
}: {
  selectedWeekStart: string;
  weekStarts: string[];
  path?: string;
}) {
  const router = useRouter();

  return (
    <label className="block w-full sm:w-64">
      <span className="text-sm font-medium text-ink">Tracker week</span>
      <select
        className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm text-ink"
        onChange={(event) => router.push(`${path}?week=${event.target.value}`)}
        value={selectedWeekStart}
      >
        {weekStarts.map((weekStart) => (
          <option key={weekStart} value={weekStart}>
            {formatWeekRange(weekStart)}
          </option>
        ))}
      </select>
    </label>
  );
}
