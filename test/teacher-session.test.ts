import { describe, expect, it } from "vitest";
import {
  TEACHER_SESSION_CONTRACT_VERSION,
  classifyTeacherChecklistRecord
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
});
