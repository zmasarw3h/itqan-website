"use client";

import { useRouter } from "next/navigation";
import { formatWeekRange } from "@/lib/dates";

export default function StudentWeekSelector({
  studentId,
  availableWeekStarts,
  selectedWeekStart,
  view
}: {
  studentId: string;
  availableWeekStarts: string[];
  selectedWeekStart: string;
  view: string;
}) {
  const router = useRouter();

  return (
    <label className="block min-w-0 sm:w-64">
      <span className="text-sm font-medium text-ink">Week</span>
      <select
        className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
        onChange={(event) => {
          const params = new URLSearchParams({ week: event.target.value, view });
          router.replace(`/admin/students/${encodeURIComponent(studentId)}?${params.toString()}`);
        }}
        value={selectedWeekStart}
      >
        {availableWeekStarts.map((weekStart) => (
          <option key={weekStart} value={weekStart}>
            {formatWeekRange(weekStart)}
          </option>
        ))}
      </select>
    </label>
  );
}
