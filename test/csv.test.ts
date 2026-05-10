import { describe, expect, it } from "vitest";
import { completionRowsToCsv, csvColumns } from "@/lib/csv";
import type { CompletionRow } from "@/lib/types";

describe("CSV export", () => {
  it("contains expected columns", () => {
    expect(csvColumns()).toEqual([
      "student name",
      "student phone",
      "student email",
      "date",
      "status",
      "daily_score",
      "earned_weight",
      "total_weight",
      "submitted_at",
      "task_breakdown",
      "note",
      "updated_at",
      "updated_by_admin"
    ]);
  });

  it("renders rows with escaped values", () => {
    const rows: CompletionRow[] = [
      {
        studentId: "student-1",
        studentName: "Student, One",
        studentEmail: "14165550101@itqan.local",
        studentPhone: "+1 555 0101",
        date: "2026-05-08",
        completed: true,
        status: "submitted",
        checkin: {
          id: "checkin-1",
          student_id: "student-1",
          date: "2026-05-08",
          completed: true,
          note: "Read \"lesson\"",
          earned_weight: 75,
          total_weight: 100,
          daily_score: 75,
          submitted_at: "2026-05-08T12:00:00.000Z",
          updated_at: null,
          updated_by_admin: null
        },
        items: [
          {
            id: "item-1",
            checkin_id: "checkin-1",
            student_id: "student-1",
            date: "2026-05-08",
            task_key: "weekly_recitation_5x",
            task_label: "Weekly recitation made 5 times",
            weight: 30,
            completed: true,
            created_at: "2026-05-08T12:00:00.000Z"
          }
        ]
      }
    ];

    expect(completionRowsToCsv(rows)).toContain('"Student, One",+1 555 0101,14165550101@itqan.local');
    expect(completionRowsToCsv(rows)).toContain("submitted,75,75,100");
    expect(completionRowsToCsv(rows)).toContain("Weekly recitation made 5 times: completed (30)");
    expect(completionRowsToCsv(rows)).toContain('"Read ""lesson"""');
  });
});
