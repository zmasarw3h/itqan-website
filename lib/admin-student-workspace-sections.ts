import { addDays, weekDatesFromStart } from "@/lib/dates";
import { tasksForDate } from "@/lib/scoring";
import type { CheckIn, CheckInItem } from "@/lib/types";

export type WeeklyActivityDayState = "saved" | "missing" | "open" | "upcoming";

export type WeeklyActivityDay = {
  date: string;
  state: WeeklyActivityDayState;
  checkin: CheckIn | null;
  items: CheckInItem[];
};

export function buildWeeklyActivityDays(input: {
  weekStart: string;
  effectiveDate: string;
  checkins: CheckIn[];
  items: CheckInItem[];
}): WeeklyActivityDay[] {
  const checkinByDate = new Map(input.checkins.map((checkin) => [checkin.date, checkin]));
  const itemsByCheckin = new Map<string, CheckInItem[]>();

  for (const item of input.items) {
    itemsByCheckin.set(item.checkin_id, [...(itemsByCheckin.get(item.checkin_id) ?? []), item]);
  }

  return weekDatesFromStart(input.weekStart).map((date) => {
    const checkin = checkinByDate.get(date) ?? null;
    const state: WeeklyActivityDayState = checkin?.completed
      ? "saved"
      : date < input.effectiveDate
        ? "missing"
        : date === input.effectiveDate
          ? "open"
          : "upcoming";

    return {
      date,
      state,
      checkin,
      // Historical labels and weights intentionally come from the stored item
      // snapshot. Current checklist definitions are never consulted here.
      items: checkin?.completed ? itemsByCheckin.get(checkin.id) ?? [] : []
    };
  });
}

export function initialWeeklyActivityDate(days: WeeklyActivityDay[], effectiveDate: string) {
  return [...days].reverse().find((day) => day.state === "saved")?.date
    ?? days.find((day) => day.date === effectiveDate)?.date
    ?? days[0]?.date
    ?? "";
}

export function correctionDatesForWeek(weekStart: string, effectiveDate: string) {
  return weekDatesFromStart(weekStart).filter((date) => date <= effectiveDate);
}

export function validCompletedTaskKeysForCorrectionDate(date: string, completedTaskKeys: string[]) {
  const effectiveTaskKeys = new Set(tasksForDate(date).map((task) => task.key));
  return completedTaskKeys.filter((taskKey) => effectiveTaskKeys.has(taskKey));
}

export function initialCorrectionDate(input: {
  weekStart: string;
  effectiveDate: string;
  savedDates: string[];
}) {
  const availableDates = correctionDatesForWeek(input.weekStart, input.effectiveDate);
  if (!availableDates.length) return "";
  if (availableDates.includes(input.effectiveDate)) return input.effectiveDate;

  const saved = new Set(input.savedDates);
  return [...availableDates].reverse().find((date) => saved.has(date))
    ?? availableDates.at(-1)
    ?? addDays(input.weekStart, 0);
}
