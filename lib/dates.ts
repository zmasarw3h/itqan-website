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

export function currentWeekDates(today = todayDateString()) {
  const date = new Date(`${today}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(today, mondayOffset);

  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
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
