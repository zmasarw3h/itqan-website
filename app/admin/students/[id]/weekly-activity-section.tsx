"use client";

import { useMemo, useState } from "react";
import { CaretDown, CaretUp, CheckCircle, XCircle } from "@phosphor-icons/react";
import { formatDateTimeInAppTimeZone, formatWeekRange, friendlyDate } from "@/lib/dates";
import {
  buildWeeklyActivityDays,
  initialWeeklyActivityDate,
  weeklyActivityDueSummary,
  type WeeklyActivityDay
} from "@/lib/admin-student-workspace-sections";
import type { CheckIn, CheckInItem } from "@/lib/types";

const stateStyles = {
  saved: "bg-emerald-50 text-emerald-800",
  missing: "bg-rose-50 text-rose-800",
  open: "bg-amber-50 text-amber-900",
  upcoming: "bg-stone-100 text-stone-600"
};

const stateLabels = {
  saved: "Saved",
  missing: "Missing",
  open: "Open today",
  upcoming: "Upcoming"
};

function DayState({ day }: { day: WeeklyActivityDay }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stateStyles[day.state]}`}>{stateLabels[day.state]}</span>;
}

function DayDetail({ day }: { day: WeeklyActivityDay }) {
  if (day.state !== "saved" || !day.checkin) {
    const copy = day.state === "missing"
      ? "No daily check-in was saved for this date."
      : day.state === "open"
        ? "This day is still open. No check-in has been saved yet."
        : "This day is not open yet.";
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center">
        <p className="font-medium text-ink">{stateLabels[day.state]}</p>
        <p className="mt-1 text-sm text-stone-600">{copy}</p>
      </div>
    );
  }

  const completed = day.items.filter((item) => item.completed);
  const missed = day.items.filter((item) => !item.completed);
  const savedAt = day.checkin.updated_at ?? day.checkin.submitted_at;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 border-b border-stone-200 pb-5 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Daily score</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{Math.round(Number(day.checkin.daily_score ?? 0))}%</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Checklist</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{day.checkin.earned_weight ?? 0}<span className="text-base font-normal text-stone-500"> / {day.checkin.total_weight ?? 0}</span></p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Saved</p>
          <p className="mt-1 text-sm font-medium text-ink">{formatDateTimeInAppTimeZone(savedAt)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="font-semibold text-ink">Completed items <span className="font-normal text-stone-500">({completed.length})</span></h4>
          {completed.length ? (
            <ul className="mt-3 space-y-2">
              {completed.map((item) => (
                <li className="flex min-w-0 items-start justify-between gap-3 text-sm" key={item.id}>
                  <span className="flex min-w-0 items-start gap-2 break-words text-stone-700"><CheckCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700" weight="fill" /><span>{item.task_label}</span></span>
                  <span className="shrink-0 font-medium text-ink">{item.weight} / {item.weight}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-stone-500">No completed items.</p>}
        </div>
        <div>
          <h4 className="font-semibold text-ink">Missed items <span className="font-normal text-stone-500">({missed.length})</span></h4>
          {missed.length ? (
            <ul className="mt-3 space-y-2">
              {missed.map((item) => (
                <li className="flex min-w-0 items-start justify-between gap-3 text-sm" key={item.id}>
                  <span className="flex min-w-0 items-start gap-2 break-words text-stone-700"><XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rose-700" weight="fill" /><span>{item.task_label}</span></span>
                  <span className="shrink-0 font-medium text-stone-600">0 / {item.weight}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-stone-500">No missed items.</p>}
        </div>
      </div>

      <div className="mt-5 border-t border-stone-200 pt-5">
        <h4 className="text-sm font-semibold text-ink">Student note</h4>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-600">{day.checkin.note || "No note provided."}</p>
      </div>
    </div>
  );
}

export default function WeeklyActivitySection({
  weekStart,
  effectiveDate,
  checkins,
  items
}: {
  weekStart: string;
  effectiveDate: string;
  checkins: CheckIn[];
  items: CheckInItem[];
}) {
  const days = useMemo(
    () => buildWeeklyActivityDays({ weekStart, effectiveDate, checkins, items }),
    [weekStart, effectiveDate, checkins, items]
  );
  const [selectedDate, setSelectedDate] = useState(() => initialWeeklyActivityDate(days, effectiveDate));
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];
  const dueSummary = weeklyActivityDueSummary(days, effectiveDate);

  return (
    <section className="py-8" aria-labelledby="weekly-activity-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-ink" id="weekly-activity-title">Weekly activity</h2>
          <p className="mt-1 text-sm text-stone-600">Read-only daily check-in history for {formatWeekRange(weekStart)}.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-stone-100 px-4 py-3 text-sm sm:flex sm:gap-6">
          <p><strong className="text-ink">{dueSummary.savedDays}/{dueSummary.dueDays}</strong> <span className="text-stone-600">due days saved</span></p>
          <p><strong className="text-ink">{dueSummary.earnedPoints}/{dueSummary.possiblePoints}</strong> <span className="text-stone-600">due points</span></p>
        </div>
      </div>

      <div className="mt-6 hidden gap-6 md:grid md:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.6fr)]">
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white" aria-label="Days in selected week">
          {days.map((day) => {
            const selected = day.date === selectedDay?.date;
            return (
              <button
                aria-pressed={selected}
                className={`flex min-h-16 w-full items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 text-left last:border-b-0 focus-visible:relative focus-visible:z-10 ${selected ? "bg-emerald-50 ring-inset ring-moss" : "hover:bg-stone-50"}`}
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{friendlyDate(day.date)}</span>
                  {day.checkin?.completed ? <span className="mt-0.5 block text-sm text-stone-600">{Math.round(Number(day.checkin.daily_score ?? 0))}% daily score</span> : null}
                </span>
                <DayState day={day} />
              </button>
            );
          })}
        </div>
        {selectedDay ? (
          <article className="min-w-0 rounded-xl border border-stone-200 bg-white p-6" aria-live="polite">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-ink">{friendlyDate(selectedDay.date)}</h3>
              <DayState day={selectedDay} />
            </div>
            <DayDetail day={selectedDay} />
          </article>
        ) : null}
      </div>

      <div className="mt-5 space-y-3 md:hidden">
        {days.map((day) => {
          const expanded = day.date === selectedDay?.date;
          return (
            <article className="overflow-hidden rounded-xl border border-stone-200 bg-white" key={day.date}>
              <button
                aria-expanded={expanded}
                className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setSelectedDate(expanded ? "" : day.date)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{friendlyDate(day.date)}</span>
                  <span className="mt-0.5 block text-sm text-stone-600">{day.checkin?.completed ? `${Math.round(Number(day.checkin.daily_score ?? 0))}% daily score` : stateLabels[day.state]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2"><DayState day={day} />{expanded ? <CaretUp aria-hidden="true" className="size-4 text-stone-500" /> : <CaretDown aria-hidden="true" className="size-4 text-stone-500" />}</span>
              </button>
              {expanded ? <div className="border-t border-stone-200 px-4 py-5"><DayDetail day={day} /></div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
