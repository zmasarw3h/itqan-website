import { describe, expect, it } from "vitest";
import { completionRowsToCsv, csvColumns } from "@/lib/csv";
import type { CompletionRow } from "@/lib/types";

describe("CSV export", () => {
  it("contains expected columns", () => {
    expect(csvColumns()).toEqual([
      "student name",
      "student email",
      "date",
      "completed",
      "submitted_at",
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
        studentEmail: "student1@example.com",
        date: "2026-05-08",
        completed: true,
        status: "completed",
        checkin: {
          id: "checkin-1",
          student_id: "student-1",
          date: "2026-05-08",
          completed: true,
          note: "Read \"lesson\"",
          submitted_at: "2026-05-08T12:00:00.000Z",
          updated_at: null,
          updated_by_admin: null
        }
      }
    ];

    expect(completionRowsToCsv(rows)).toContain('"Student, One",student1@example.com');
    expect(completionRowsToCsv(rows)).toContain('"Read ""lesson"""');
  });
});
