import type { CheckIn, CheckInItem } from "@/lib/types";
import { todayDateString } from "@/lib/dates";

export type HistoryDayRow = {
  date: string;
  checkin: CheckIn | null;
  completedItems: CheckInItem[];
  missedItems: CheckInItem[];
  isFuture: boolean;
  missingMessage: string | null;
};

export function studentHistoryScope(studentId: string, weekStart: string, weekDates: string[]) {
  if (!studentId) {
    throw new Error("Student id is required.");
  }

  return {
    studentId,
    weekStart,
    weekDates: [...weekDates]
  };
}

export function buildHistoryDayRows(input: {
  weekDates: string[];
  checkins: CheckIn[];
  items: CheckInItem[];
  today?: string;
}): HistoryDayRow[] {
  const selectedDates = new Set(input.weekDates);
  const checkinByDate = new Map(
    input.checkins.filter((checkin) => selectedDates.has(checkin.date)).map((checkin) => [checkin.date, checkin])
  );
  const itemsByCheckInId = new Map<string, CheckInItem[]>();

  for (const item of input.items) {
    itemsByCheckInId.set(item.checkin_id, [...(itemsByCheckInId.get(item.checkin_id) ?? []), item]);
  }

  const today = input.today ?? todayDateString();

  return input.weekDates.map((date) => {
    const checkin = checkinByDate.get(date) ?? null;
    const checkinItems = checkin ? (itemsByCheckInId.get(checkin.id) ?? []) : [];
    const isFuture = !checkin && date > today;

    return {
      date,
      checkin,
      completedItems: checkinItems.filter((item) => item.completed),
      missedItems: checkinItems.filter((item) => !item.completed),
      isFuture,
      missingMessage: checkin ? null : isFuture ? "Not due yet." : "No checklist saved."
    };
  });
}
