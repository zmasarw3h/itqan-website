import { describe, expect, it } from "vitest";
import { canReadAdminData, canReadStudentData, canSubmitStudentCheckIn } from "@/lib/access";
import { assertNoDuplicateCheckIn } from "@/lib/checkins";
import { assertNoDuplicatePartnerRecitation } from "@/lib/partner-recitations";
import { isPartnerRoundAvailable } from "@/lib/scoring";
import type { Profile } from "@/lib/types";
import { canReadWeeklyPlan, canStudentManageWeeklyPlan } from "@/lib/weekly-plans";

const studentA: Profile = {
  id: "student-a",
  name: "Student A",
  email: "student-a@itqan.local",
  phone: null,
  role: "student",
  active: true
};

const studentB: Profile = {
  id: "student-b",
  name: "Student B",
  email: "student-b@itqan.local",
  phone: null,
  role: "student",
  active: true
};

const admin: Profile = {
  id: "admin-a",
  name: "Admin A",
  email: "admin-a@itqan.local",
  phone: null,
  role: "admin",
  active: true
};

const inactiveAdmin: Profile = {
  ...admin,
  id: "inactive-admin",
  active: false
};

describe("security-critical helper expectations", () => {
  it("keeps student-owned data scoped to the signed-in student", () => {
    expect(canReadStudentData(studentA, studentA.id)).toBe(true);
    expect(canReadStudentData(studentA, studentB.id)).toBe(false);
    expect(canSubmitStudentCheckIn(studentA, studentA.id)).toBe(true);
    expect(canSubmitStudentCheckIn(studentA, studentB.id)).toBe(false);
    expect(canStudentManageWeeklyPlan(studentA, studentA.id)).toBe(true);
    expect(canStudentManageWeeklyPlan(studentA, studentB.id)).toBe(false);
    expect(canReadWeeklyPlan(studentA, { student_id: studentA.id })).toBe(true);
    expect(canReadWeeklyPlan(studentA, { student_id: studentB.id })).toBe(false);
  });

  it("allows only active admins to use admin helper paths", () => {
    expect(canReadAdminData(admin)).toBe(true);
    expect(canReadStudentData(admin, studentA.id)).toBe(true);
    expect(canReadWeeklyPlan(admin, { student_id: studentA.id })).toBe(true);
    expect(canReadAdminData(studentA)).toBe(false);
    expect(canReadAdminData(inactiveAdmin)).toBe(false);
    expect(canReadStudentData(inactiveAdmin, studentA.id)).toBe(false);
  });

  it("models duplicate protections that are also enforced by database constraints", () => {
    expect(() => assertNoDuplicateCheckIn({ student_id: studentA.id, date: "2026-05-17" })).toThrow(
      "already exists"
    );
    expect(() =>
      assertNoDuplicatePartnerRecitation({
        student_id: studentA.id,
        week_start: "2026-05-17",
        round: "round_1"
      })
    ).toThrow("already exists");
  });

  it("identifies only the current partner recitation round as available", () => {
    expect(isPartnerRoundAvailable("round_1", "2026-05-17")).toBe(true);
    expect(isPartnerRoundAvailable("round_2", "2026-05-17")).toBe(false);
    expect(isPartnerRoundAvailable("round_2", "2026-05-21")).toBe(true);
    expect(isPartnerRoundAvailable("round_1", "2026-05-21")).toBe(false);
  });
});
