import { describe, expect, it } from "vitest";
import { halaqaSaturdayForWeek, weekStartForDate } from "@/lib/dates";
import {
  absenceCount,
  absencePayloadFromDrafts,
  parseStudentRotationAbsences
} from "@/lib/student-rotation-availability";
import {
  clampRotationWizardStep,
  parseRotationWizardStep,
  rotationWizardSteps,
  rotationWizardUnlockedSteps
} from "@/lib/rotation-workflow";
import { rotationPath } from "@/lib/rotation-scope";

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

describe("rotation wizard routing", () => {
  it("parses the four URL steps and defaults invalid values to students", () => {
    expect(rotationWizardSteps).toEqual(["students", "teachers", "groups", "review"]);
    expect(parseRotationWizardStep("groups")).toBe("groups");
    expect(parseRotationWizardStep("unknown")).toBe("students");
  });

  it("locks future steps and clamps deep links to the latest valid prerequisite", () => {
    const locked = rotationWizardUnlockedSteps({ studentsReady: true, teachersReady: false, groupsReady: false, reviewReady: false });
    expect(locked).toEqual({ students: true, teachers: true, groups: false, review: false });
    expect(clampRotationWizardStep("review", locked)).toBe("teachers");
    const groupsReady = rotationWizardUnlockedSteps({ studentsReady: true, teachersReady: true, groupsReady: true, reviewReady: true });
    expect(clampRotationWizardStep("review", groupsReady)).toBe("review");
  });

  it("does not unlock defaults and clamps each deep link to the latest authoritative step", () => {
    const studentsOnly = rotationWizardUnlockedSteps({ studentsReady: false, teachersReady: false, groupsReady: false, reviewReady: false });
    expect(clampRotationWizardStep("teachers", studentsOnly)).toBe("students");
    expect(clampRotationWizardStep("review", studentsOnly)).toBe("students");

    const teachersConfirmedZero = rotationWizardUnlockedSteps({ studentsReady: true, teachersReady: false, groupsReady: false, reviewReady: false });
    expect(clampRotationWizardStep("groups", teachersConfirmedZero)).toBe("teachers");

    const staleGroups = rotationWizardUnlockedSteps({ studentsReady: true, teachersReady: true, groupsReady: false, reviewReady: false });
    expect(clampRotationWizardStep("review", staleGroups)).toBe("groups");
  });

  it("preserves canonical scope, Sunday week, and selected step in links", () => {
    expect(rotationPath({ masjidId: "m1", cohortId: "c1", weekStart: "2026-08-09", step: "teachers" }))
      .toBe("/admin/rotation?masjid=m1&cohort=c1&week=2026-08-09&step=teachers");
  });
});
