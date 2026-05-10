import { calculateDailySubmission } from "@/lib/scoring";
import type { CheckIn, CheckInItem, CompletionRow, CompletionStatus, DashboardFilters, Profile } from "@/lib/types";

export function normalizeNote(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function assertNoDuplicateCheckIn(existing: Pick<CheckIn, "student_id" | "date"> | null) {
  if (existing) {
    throw new Error("A check-in already exists for this student and date.");
  }
}

export function toCompletionStatus(checkin: CheckIn | null): CompletionStatus {
  return checkin ? "submitted" : "missing";
}

export function checkInItemPayloads(input: {
  checkinId: string;
  studentId: string;
  date: string;
  completedTaskKeys: Iterable<string>;
}) {
  return calculateDailySubmission(input.date, input.completedTaskKeys).items.map((item) => ({
    checkin_id: input.checkinId,
    student_id: input.studentId,
    date: input.date,
    task_key: item.key,
    task_label: item.label,
    weight: item.weight,
    completed: item.completed
  }));
}

export function groupCheckInItemsByCheckInId(items: CheckInItem[]) {
  const itemsByCheckInId = new Map<string, CheckInItem[]>();

  for (const item of items) {
    const existing = itemsByCheckInId.get(item.checkin_id) ?? [];
    existing.push(item);
    itemsByCheckInId.set(item.checkin_id, existing);
  }

  return itemsByCheckInId;
}

export function buildCompletionRows(
  students: Profile[],
  checkins: CheckIn[],
  dates: string[],
  filters: DashboardFilters = {},
  items: CheckInItem[] = []
): CompletionRow[] {
  const checkinByStudentAndDate = new Map<string, CheckIn>();
  const itemsByCheckInId = groupCheckInItemsByCheckInId(items);

  for (const checkin of checkins) {
    checkinByStudentAndDate.set(`${checkin.student_id}:${checkin.date}`, checkin);
  }

  const rows: CompletionRow[] = [];

  for (const student of students) {
    if (student.role !== "student" || !student.active) {
      continue;
    }

    if (filters.studentId && student.id !== filters.studentId) {
      continue;
    }

    for (const date of dates) {
      if (filters.date && filters.date !== date) {
        continue;
      }

      const checkin = checkinByStudentAndDate.get(`${student.id}:${date}`) ?? null;
      const completed = Boolean(checkin);
      const status = toCompletionStatus(checkin);

      if (filters.status && filters.status !== status) {
        continue;
      }

      rows.push({
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        studentPhone: student.phone,
        date,
        completed,
        status,
        checkin,
        items: checkin ? (itemsByCheckInId.get(checkin.id) ?? []) : []
      });
    }
  }

  return rows;
}

export function adminCorrectionPayload(input: {
  adminId: string;
  studentId: string;
  date: string;
  completed: boolean;
  note: string | null;
  earnedWeight?: number | null;
  totalWeight?: number | null;
  dailyScore?: number | null;
  now?: Date;
}) {
  return {
    student_id: input.studentId,
    date: input.date,
    completed: input.completed,
    note: input.note,
    earned_weight: input.earnedWeight ?? null,
    total_weight: input.totalWeight ?? null,
    daily_score: input.dailyScore ?? null,
    updated_at: (input.now ?? new Date()).toISOString(),
    updated_by_admin: input.adminId
  };
}
