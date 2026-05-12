import type { CheckIn, CheckInItem } from "@/lib/types";

export type HistoryDayRow = {
  date: string;
  checkin: CheckIn | null;
  completedItems: CheckInItem[];
  missedItems: CheckInItem[];
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
}): HistoryDayRow[] {
  const selectedDates = new Set(input.weekDates);
  const checkinByDate = new Map(
    input.checkins.filter((checkin) => selectedDates.has(checkin.date)).map((checkin) => [checkin.date, checkin])
  );
  const itemsByCheckInId = new Map<string, CheckInItem[]>();

  for (const item of input.items) {
    itemsByCheckInId.set(item.checkin_id, [...(itemsByCheckInId.get(item.checkin_id) ?? []), item]);
  }

  return input.weekDates.map((date) => {
    const checkin = checkinByDate.get(date) ?? null;
    const checkinItems = checkin ? (itemsByCheckInId.get(checkin.id) ?? []) : [];

    return {
      date,
      checkin,
      completedItems: checkinItems.filter((item) => item.completed),
      missedItems: checkinItems.filter((item) => !item.completed),
      missingMessage: checkin ? null : "No check-in submitted."
    };
  });
}
