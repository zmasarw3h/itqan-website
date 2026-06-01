import { describe, expect, it } from "vitest";
import {
  adminCorrectionPayload,
  assertNoDuplicateCheckIn,
  blankCheckInItemPayloads,
  buildCompletionRows,
  calculateTotalsFromCompletedKeys,
  checkInItemPayloads,
  completedTaskKeysAfterToggle,
  taskForDateOrThrow
} from "@/lib/checkins";
import { assertNoDuplicatePartnerRecitation } from "@/lib/partner-recitations";
import type { CheckIn, CheckInItem, Profile } from "@/lib/types";

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

function checkinItem(overrides: Partial<CheckInItem>): CheckInItem {
  return {
    id: "item-1",
    checkin_id: "checkin-1",
    student_id: "student-1",
    date: "2026-05-10",
    task_key: "revise_old",
    task_label: "Revise old",
    weight: 40,
    completed: false,
    created_at: "2026-05-10T12:00:00.000Z",
    ...overrides
  };
}

describe("check-in rules", () => {
  it("blocks duplicate check-ins for the same student and date", () => {
    expect(() => assertNoDuplicateCheckIn({ student_id: "student-1", date: "2026-05-08" })).toThrow(
      "already exists"
    );
    expect(() => assertNoDuplicateCheckIn(null)).not.toThrow();
  });

  it("blocks duplicate partner recitation submissions for the same student, week, and round", () => {
    expect(() =>
      assertNoDuplicatePartnerRecitation({
        student_id: "student-1",
        week_start: "2026-05-10",
        round: "round_1"
      })
    ).toThrow("already exists");
    expect(() => assertNoDuplicatePartnerRecitation(null)).not.toThrow();
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

  it("marks future dates as upcoming instead of missing", () => {
    const rows = buildCompletionRows(students, [], ["2999-01-01"]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      completed: false,
      status: "upcoming",
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

  it("builds one blank item payload per task for first autosave initialization", () => {
    const payloads = blankCheckInItemPayloads({
      checkinId: "checkin-1",
      studentId: "student-1",
      date: "2026-05-10"
    });

    expect(payloads).toHaveLength(6);
    expect(new Set(payloads.map((payload) => payload.task_key)).size).toBe(payloads.length);
    expect(payloads.every((payload) => payload.completed === false)).toBe(true);
    expect(payloads.every((payload) => payload.checkin_id === "checkin-1")).toBe(true);
    expect(payloads.every((payload) => payload.student_id === "student-1")).toBe(true);
  });

  it("keeps one item payload per task when building a saved checklist snapshot", () => {
    const payloads = checkInItemPayloads({
      checkinId: "checkin-1",
      studentId: "student-1",
      date: "2026-05-10",
      completedTaskKeys: ["revise_old", "tafsir", "revise_old"]
    });

    expect(payloads).toHaveLength(6);
    expect(new Set(payloads.map((payload) => payload.task_key)).size).toBe(payloads.length);
    expect(payloads.find((payload) => payload.task_key === "revise_old")?.completed).toBe(true);
    expect(payloads.find((payload) => payload.task_key === "tafsir")?.completed).toBe(true);
  });

  it("checking and unchecking one task changes the saved daily score", () => {
    const checkedTotals = calculateTotalsFromCompletedKeys("2026-05-10", ["revise_old"]);
    const uncheckedTotals = calculateTotalsFromCompletedKeys("2026-05-10", []);

    expect(checkedTotals).toMatchObject({
      completedTaskKeys: ["revise_old"],
      earnedWeight: 40,
      totalWeight: 100,
      dailyScore: 40
    });
    expect(uncheckedTotals.dailyScore).toBeLessThan(checkedTotals.dailyScore);
  });

  it("merges a targeted checkbox toggle without changing unrelated saved items", () => {
    const items = [
      checkinItem({ task_key: "revise_old", completed: true }),
      checkinItem({ id: "item-2", task_key: "tafsir", completed: false })
    ];

    expect(completedTaskKeysAfterToggle({ items, taskKey: "tafsir", completed: true }).sort()).toEqual([
      "revise_old",
      "tafsir"
    ]);
    expect(completedTaskKeysAfterToggle({ items, taskKey: "revise_old", completed: false })).toEqual([]);
  });

  it("rejects task keys that are not part of the selected day", () => {
    expect(() => taskForDateOrThrow("2026-05-10", "not-a-real-task")).toThrow("Invalid checklist task");
  });
});
