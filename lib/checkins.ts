import { calculateDailySubmission, tasksForDate, type CheckInTask } from "@/lib/scoring";
import { todayDateString } from "@/lib/dates";
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

export function toCompletionStatus(checkin: CheckIn | null, date: string, today = todayDateString()): CompletionStatus {
  if (checkin) {
    return "submitted";
  }

  return date <= today ? "missing" : "upcoming";
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

export function taskForDateOrThrow(date: string, taskKey: string): CheckInTask {
  const task = tasksForDate(date).find((candidate) => candidate.key === taskKey);

  if (!task) {
    throw new Error("Invalid checklist task.");
  }

  return task;
}

export function blankCheckInItemPayloads(input: { checkinId: string; studentId: string; date: string }) {
  return tasksForDate(input.date).map((task) => ({
    checkin_id: input.checkinId,
    student_id: input.studentId,
    date: input.date,
    task_key: task.key,
    task_label: task.label,
    weight: task.weight,
    completed: false
  }));
}

export function completedTaskKeysAfterToggle(input: {
  items: Pick<CheckInItem, "task_key" | "completed">[];
  taskKey: string;
  completed: boolean;
}) {
  const completedTaskKeys = new Set(input.items.filter((item) => item.completed).map((item) => item.task_key));

  if (input.completed) {
    completedTaskKeys.add(input.taskKey);
  } else {
    completedTaskKeys.delete(input.taskKey);
  }

  return [...completedTaskKeys];
}

export function calculateTotalsFromCompletedKeys(date: string, completedTaskKeys: Iterable<string>) {
  const submission = calculateDailySubmission(date, completedTaskKeys);

  return {
    completedTaskKeys: submission.items.filter((item) => item.completed).map((item) => item.key),
    earnedWeight: submission.earnedWeight,
    totalWeight: submission.totalWeight,
    dailyScore: submission.dailyScore
  };
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
  const today = todayDateString();

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
      const status = toCompletionStatus(checkin, date, today);

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
