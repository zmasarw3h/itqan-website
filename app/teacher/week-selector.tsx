"use client";

import { useRouter } from "next/navigation";
import { CalendarBlank, CaretDown } from "@phosphor-icons/react";
import { formatWeekRange, friendlyDate, addDays } from "@/lib/dates";

export default function TeacherWeekSelector({
  selectedWeekStart,
  weekStarts,
  path = "/teacher",
  presentation = "compact"
}: {
  selectedWeekStart: string;
  weekStarts: string[];
  path?: string;
  presentation?: "compact" | "card";
}) {
  const router = useRouter();

  if (presentation === "card") {
    return (
      <label className="relative flex min-h-[112px] w-full cursor-pointer items-center gap-5 rounded-xl border border-stone-300 bg-white px-5 py-4 transition hover:border-moss sm:px-8">
        <CalendarBlank aria-hidden="true" className="size-8 shrink-0 text-ink" weight="regular" />
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Tracker week</span>
          <span className="mt-1 block text-lg font-semibold text-ink">{formatWeekRange(selectedWeekStart)}</span>
          <span className="mt-0.5 block text-sm text-stone-600">
            {friendlyDate(selectedWeekStart).replace(",", "")} – {friendlyDate(addDays(selectedWeekStart, 6)).replace(",", "")}
          </span>
        </span>
        <CaretDown aria-hidden="true" className="ml-auto size-5 shrink-0 text-stone-600" />
        <select
          aria-label="Tracker week"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(event) => router.push(`${path}?week=${event.target.value}`)}
          value={selectedWeekStart}
        >
          {weekStarts.map((weekStart) => (
            <option key={weekStart} value={weekStart}>{formatWeekRange(weekStart)}</option>
          ))}
        </select>
      </label>
    );
  }

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
