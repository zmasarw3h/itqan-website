import { describe, expect, it } from "vitest";
import { halaqaSaturdayForWeek, weekStartForDate } from "@/lib/dates";
import {
  absenceCount,
  absencePayloadFromDrafts,
  parseStudentRotationAbsences
} from "@/lib/student-rotation-availability";
import { focusRotationSection, rotationWorkflowSteps } from "@/lib/rotation-workflow";

describe("student rotation availability", () => {
  it("treats a missing availability row as attending and persists only absences", () => {
    const payload = absencePayloadFromDrafts([
      { studentId: "student-attending", available: true, reason: "" },
      { studentId: "student-absent", available: false, reason: " Family commitment " }
    ]);

    expect(payload).toEqual([{ student_id: "student-absent", reason: "Family commitment" }]);
    expect(absenceCount([
      { studentId: "student-attending", available: true, reason: "" },
      { studentId: "student-absent", available: false, reason: "Family commitment" }
    ])).toBe(1);
  });

  it("keeps optional reasons nullable and rejects malformed or duplicate payloads", () => {
    expect(parseStudentRotationAbsences(JSON.stringify([
      { student_id: "student-absent", reason: "" }
    ]))).toEqual([{ student_id: "student-absent", reason: null }]);

    expect(() => parseStudentRotationAbsences("not-json")).toThrow("invalid");
    expect(() => parseStudentRotationAbsences(JSON.stringify([
      { student_id: "student-absent", reason: null },
      { student_id: "student-absent", reason: null }
    ]))).toThrow("invalid");
  });

  it("keeps the canonical Sunday tracker identity while displaying Saturday separately", () => {
    expect(weekStartForDate("2026-08-09")).toBe("2026-08-09");
    expect(weekStartForDate("2026-08-15")).toBe("2026-08-09");
    expect(halaqaSaturdayForWeek("2026-08-09")).toBe("2026-08-15");
  });
});

describe("rotation availability page sections", () => {
  it("orders the new availability section before the existing rotation sections", () => {
    expect(rotationWorkflowSteps.map((step) => step.id)).toEqual([
      "student-availability",
      "session-group-setup",
      "teacher-responsibilities",
      "assignment-review"
    ]);
  });

  it("continues by scrolling and focusing the session setup section without routing", () => {
    const calls: Array<[string, unknown]> = [];
    const target = {
      scrollIntoView: (options: unknown) => calls.push(["scroll", options]),
      focus: (options: unknown) => calls.push(["focus", options])
    };
    const documentRef = {
      getElementById: (id: string) => id === "session-group-setup" ? target : null
    } as Pick<Document, "getElementById">;

    focusRotationSection(documentRef, "session-group-setup");

    expect(calls).toEqual([
      ["scroll", { behavior: "smooth", block: "start" }],
      ["focus", { preventScroll: true }]
    ]);
  });
});
