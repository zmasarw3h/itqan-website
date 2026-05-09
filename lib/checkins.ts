import type { CheckIn, CompletionRow, CompletionStatus, DashboardFilters, Profile } from "@/lib/types";

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

export function toCompletionStatus(completed: boolean): CompletionStatus {
  return completed ? "completed" : "missing";
}

export function buildCompletionRows(
  students: Profile[],
  checkins: CheckIn[],
  dates: string[],
  filters: DashboardFilters = {}
): CompletionRow[] {
  const checkinByStudentAndDate = new Map<string, CheckIn>();

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
      const completed = checkin?.completed ?? false;
      const status = toCompletionStatus(completed);

      if (filters.status && filters.status !== status) {
        continue;
      }

      rows.push({
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        date,
        completed,
        status,
        checkin
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
  now?: Date;
}) {
  return {
    student_id: input.studentId,
    date: input.date,
    completed: input.completed,
    note: input.note,
    updated_at: (input.now ?? new Date()).toISOString(),
    updated_by_admin: input.adminId
  };
}
