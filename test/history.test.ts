import { describe, expect, it } from "vitest";
import { weekDatesFromStart } from "@/lib/dates";
import { buildHistoryDayRows, studentHistoryScope } from "@/lib/history";
import type { CheckIn, CheckInItem } from "@/lib/types";

function checkin(overrides: Partial<CheckIn>): CheckIn {
  return {
    id: "checkin-1",
    student_id: "student-1",
    date: "2026-05-10",
    completed: true,
    note: null,
    earned_weight: 80,
    total_weight: 100,
    daily_score: 80,
    submitted_at: "2026-05-10T12:00:00.000Z",
    updated_at: null,
    updated_by_admin: null,
    ...overrides
  };
}

function item(overrides: Partial<CheckInItem>): CheckInItem {
  return {
    id: "item-1",
    checkin_id: "checkin-1",
    student_id: "student-1",
    date: "2026-05-10",
    task_key: "tafsir",
    task_label: "Tafsir",
    weight: 10,
    completed: true,
    created_at: "2026-05-10T12:00:00.000Z",
    ...overrides
  };
}

describe("student history", () => {
  it("uses the selected week date range for history scope", () => {
    expect(studentHistoryScope("student-1", "2026-05-10", weekDatesFromStart("2026-05-10"))).toEqual({
      studentId: "student-1",
      weekStart: "2026-05-10",
      weekDates: [
        "2026-05-10",
        "2026-05-11",
        "2026-05-12",
        "2026-05-13",
        "2026-05-14",
        "2026-05-15",
        "2026-05-16"
      ]
    });
  });

  it("shows a missing day message when no check-in exists", () => {
    const [row] = buildHistoryDayRows({
      weekDates: ["2026-05-11"],
      checkins: [],
      items: []
    });

    expect(row).toMatchObject({
      date: "2026-05-11",
      checkin: null,
      completedItems: [],
      missedItems: [],
      missingMessage: "No check-in submitted."
    });
  });

  it("only displays check-ins from the selected week dates", () => {
    const rows = buildHistoryDayRows({
      weekDates: ["2026-05-10", "2026-05-11"],
      checkins: [
        checkin({ id: "selected", date: "2026-05-10" }),
        checkin({ id: "outside", date: "2026-05-17" })
      ],
      items: [
        item({ id: "done", checkin_id: "selected", completed: true }),
        item({ id: "missed", checkin_id: "selected", completed: false }),
        item({ id: "outside-item", checkin_id: "outside", completed: true })
      ]
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].checkin?.id).toBe("selected");
    expect(rows[0].completedItems.map((rowItem) => rowItem.id)).toEqual(["done"]);
    expect(rows[0].missedItems.map((rowItem) => rowItem.id)).toEqual(["missed"]);
    expect(rows[1].checkin).toBeNull();
  });

  it("requires a student id for student history scope", () => {
    expect(() => studentHistoryScope("", "2026-05-10", ["2026-05-10"])).toThrow("Student id is required");
  });
});
