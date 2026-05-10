import { describe, expect, it } from "vitest";
import {
  adminCorrectionPayload,
  assertNoDuplicateCheckIn,
  buildCompletionRows
} from "@/lib/checkins";
import type { CheckIn, Profile } from "@/lib/types";

const students: Profile[] = [
  {
    id: "student-1",
    name: "Student One",
    email: "14165550101@itqan.local",
    phone: "+1 555 0101",
    role: "student",
    active: true
  },
  {
    id: "student-2",
    name: "Student Two",
    email: "14165550102@itqan.local",
    phone: null,
    role: "student",
    active: true
  }
];

const checkins: CheckIn[] = [
  {
    id: "checkin-1",
    student_id: "student-1",
    date: "2026-05-08",
    completed: true,
    note: "Done",
    earned_weight: 100,
    total_weight: 100,
    daily_score: 100,
    submitted_at: "2026-05-08T12:00:00.000Z",
    updated_at: null,
    updated_by_admin: null
  }
];

describe("check-in rules", () => {
  it("blocks duplicate check-ins for the same student and date", () => {
    expect(() => assertNoDuplicateCheckIn({ student_id: "student-1", date: "2026-05-08" })).toThrow(
      "already exists"
    );
    expect(() => assertNoDuplicateCheckIn(null)).not.toThrow();
  });

  it("builds completed and missing rows for admin views", () => {
    const rows = buildCompletionRows(students, checkins, ["2026-05-08"]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      studentId: "student-1",
      studentPhone: "+1 555 0101",
      completed: true,
      status: "submitted"
    });
    expect(rows[1]).toMatchObject({
      studentId: "student-2",
      studentPhone: null,
      completed: false,
      status: "missing",
      checkin: null
    });
  });

  it("sets admin correction metadata for completed=false corrections", () => {
    const payload = adminCorrectionPayload({
      adminId: "admin-1",
      studentId: "student-2",
      date: "2026-05-08",
      completed: false,
      note: "Excused",
      now: new Date("2026-05-08T15:30:00.000Z")
    });

    expect(payload).toEqual({
      student_id: "student-2",
      date: "2026-05-08",
      completed: false,
      note: "Excused",
      earned_weight: null,
      total_weight: null,
      daily_score: null,
      updated_at: "2026-05-08T15:30:00.000Z",
      updated_by_admin: "admin-1"
    });
  });
});
