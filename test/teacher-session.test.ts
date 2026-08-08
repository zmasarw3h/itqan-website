import { describe, expect, it } from "vitest";
import {
  classifyTeacherGradeSaveError,
  TEACHER_SESSION_CONTRACT_VERSION,
  classifyTeacherChecklistRecord,
  teacherChecklistItemStatus
} from "@/lib/teacher-session";

describe("teacher session read contracts", () => {
  it("classifies missing and saved checklist records without using current definitions", () => {
    expect(classifyTeacherChecklistRecord({
      hasRecord: false,
      storedCompleted: false,
      itemCount: 0,
      completedItemCount: 0
    })).toBe("missing");
    expect(classifyTeacherChecklistRecord({
      hasRecord: true,
      storedCompleted: false,
      itemCount: 6,
      completedItemCount: 6
    })).toBe("in_progress");
    expect(classifyTeacherChecklistRecord({
      hasRecord: true,
      storedCompleted: true,
      itemCount: 0,
      completedItemCount: 0
    })).toBe("in_progress");
    expect(classifyTeacherChecklistRecord({
      hasRecord: true,
      storedCompleted: true,
      itemCount: 6,
      completedItemCount: 3
    })).toBe("partial");
    expect(classifyTeacherChecklistRecord({
      hasRecord: true,
      storedCompleted: true,
      itemCount: 6,
      completedItemCount: 6
    })).toBe("complete");
  });

  it("keeps the stable contract version explicit", () => {
    expect(TEACHER_SESSION_CONTRACT_VERSION).toBe(1);
  });

  it("uses privacy-safe checklist labels for historical and current unchecked items", () => {
    expect(teacherChecklistItemStatus({ completed: true, checklistDate: "2026-08-01", currentDate: "2026-08-08" })).toBe("Completed");
    expect(teacherChecklistItemStatus({ completed: false, checklistDate: "2026-08-01", currentDate: "2026-08-08" })).toBe("Missed");
    expect(teacherChecklistItemStatus({ completed: false, checklistDate: "2026-08-08", currentDate: "2026-08-08" })).toBe("Not completed yet");
    expect(teacherChecklistItemStatus({ completed: false, checklistDate: "2026-08-09", currentDate: "2026-08-08" })).toBe("Not completed yet");
  });

  it("preserves actionable grade-save error states", () => {
    expect(classifyTeacherGradeSaveError({ code: "PT412" })).toBe("grade-stale");
    expect(classifyTeacherGradeSaveError({ message: "teacher_session_grade_roster_superseded (PT412)" })).toBe(
      "grade-stale"
    );
    expect(classifyTeacherGradeSaveError({ code: "42501" })).toBe("grade-denied");
    expect(classifyTeacherGradeSaveError({ code: "22023" })).toBe("grade-invalid");
    expect(classifyTeacherGradeSaveError({ code: "23514" })).toBe("grade-invalid");
    expect(classifyTeacherGradeSaveError({ code: "XX000" })).toBe("grade-error");
  });
});
