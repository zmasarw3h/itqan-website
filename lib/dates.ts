import { APP_TIME_ZONE, CHECK_IN_RESET_HOUR } from "@/lib/config";

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;

  if (!year || !month || !day || !hour) {
    throw new Error("Unable to format date.");
  }

  return { dateString: `${year}-${month}-${day}`, hour: Number(hour) };
}

export function todayDateString(
  now = new Date(),
  timeZone = APP_TIME_ZONE,
  resetHour = CHECK_IN_RESET_HOUR
) {
  const parts = getDatePartsInTimeZone(now, timeZone);

  if (parts.hour < resetHour) {
    return addDays(parts.dateString, -1);
  }

  return parts.dateString;
}

export function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isValidDateString(dateString: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }

  const date = new Date(`${dateString}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
}

export function weekStartForDate(dateString: string) {
  if (!isValidDateString(dateString)) {
    throw new Error("Invalid date.");
  }

  const date = new Date(`${dateString}T00:00:00.000Z`);
  const day = date.getUTCDay();

  return addDays(dateString, -day);
}

export function weekDatesFromStart(weekStart: string) {
  if (!isValidDateString(weekStart)) {
    throw new Error("Invalid week start date.");
  }

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function currentWeekDates(today = todayDateString()) {
  return weekDatesFromStart(weekStartForDate(today));
}

export function formatWeekRange(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const endDateString = addDays(weekStart, 6);
  const end = new Date(`${endDateString}T00:00:00.000Z`);
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" });
  const startMonth = monthFormatter.format(start);
  const endMonth = monthFormatter.format(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startYear = yearFormatter.format(start);
  const endYear = yearFormatter.format(end);

  if (startYear === endYear && startMonth === endMonth) {
    return `${startMonth} ${startDay}–${endDay}, ${startYear}`;
  }

  if (startYear === endYear) {
    return `${startMonth} ${startDay}–${endMonth} ${endDay}, ${startYear}`;
  }

  return `${startMonth} ${startDay}, ${startYear}–${endMonth} ${endDay}, ${endYear}`;
}

export function friendlyDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${dateString}T00:00:00.000Z`));
}

export function planWeekStartForDate(dateString = todayDateString()) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const saturdayOffset = day === 6 ? 0 : day + 1;

  return addDays(dateString, -saturdayOffset);
}

export function planWeekDatesFromStart(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function formatPlanWeekRange(weekStart: string) {
  const weekDates = planWeekDatesFromStart(weekStart);
  const start = new Date(`${weekDates[0]}T00:00:00.000Z`);
  const end = new Date(`${addDays(weekStart, 7)}T00:00:00.000Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  if (sameMonth && sameYear) {
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(start);
    return `${month} ${start.getUTCDate()}–${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }

  const startText = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
    year: sameYear ? undefined : "numeric"
  }).format(start);
  const endText = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(end);

  return `${startText}–${endText}`;
}
