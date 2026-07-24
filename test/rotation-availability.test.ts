import { describe, expect, it } from "vitest";
import { sameTeacherSelection } from "@/lib/rotation-availability";

describe("rotation availability selection", () => {
  it("treats the same teachers as unchanged regardless of order", () => {
    expect(sameTeacherSelection(["teacher-a", "teacher-b"], ["teacher-b", "teacher-a"])).toBe(true);
  });

  it("detects added or removed teachers", () => {
    expect(sameTeacherSelection(["teacher-a"], ["teacher-a", "teacher-b"])).toBe(false);
    expect(sameTeacherSelection(["teacher-a", "teacher-b"], ["teacher-a"])).toBe(false);
  });

  it("does not let duplicate identifiers hide a changed selection", () => {
    expect(sameTeacherSelection(["teacher-a", "teacher-a"], ["teacher-a"])).toBe(true);
    expect(sameTeacherSelection(["teacher-a"], ["teacher-b", "teacher-b"])).toBe(false);
  });
});
