import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/types";
import {
  canReadWeeklyPlan,
  canStudentManageWeeklyPlan,
  routeIsWeeklyPlanGated,
  safeWeeklyPlanFileName,
  validateWeeklyPlanFile,
  weeklyPlanBlocksCheckIn,
  weeklyPlanRequiredWeekStart,
  weeklyPlanStoragePath
} from "@/lib/weekly-plans";

const student: Profile = {
  id: "student-1",
  name: "Student One",
  email: "student@example.com",
  phone: null,
  role: "student",
  active: true
};

const otherStudent: Profile = {
  ...student,
  id: "student-2"
};

const admin: Profile = {
  ...student,
  id: "admin-1",
  role: "admin"
};

describe("weekly plan upload rules", () => {
  it("allows PNG, JPG, and PDF files up to 1 MB", () => {
    expect(validateWeeklyPlanFile({ name: "plan.png", type: "image/png", size: 1024 })).toBeNull();
    expect(validateWeeklyPlanFile({ name: "plan.jpg", type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateWeeklyPlanFile({ name: "plan.pdf", type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("rejects unsupported file types", () => {
    expect(validateWeeklyPlanFile({ name: "plan.gif", type: "image/gif", size: 1024 })).toBe(
      "Upload a PNG, JPG, or PDF file."
    );
  });

  it("rejects files larger than 1 MB", () => {
    expect(validateWeeklyPlanFile({ name: "plan.pdf", type: "application/pdf", size: 1024 * 1024 + 1 })).toBe(
      "Weekly plan files must be 1 MB or smaller."
    );
  });

  it("generates safe storage paths", () => {
    expect(safeWeeklyPlanFileName(" My Plan (Final).PDF ")).toBe("my-plan-final.pdf");
    expect(safeWeeklyPlanFileName("../..")).toBe("weekly-plan");
    expect(weeklyPlanStoragePath("student-1", "2026-05-09", " My Plan.PDF ")).toBe(
      "student-1/2026-05-09/my-plan.pdf"
    );
  });
});

describe("weekly plan ownership helpers", () => {
  it("allows students to manage only their own plan records", () => {
    expect(canStudentManageWeeklyPlan(student, "student-1")).toBe(true);
    expect(canStudentManageWeeklyPlan(student, "student-2")).toBe(false);
    expect(canStudentManageWeeklyPlan(admin, "student-1")).toBe(false);
  });

  it("allows admins to read all plans and students to read their own plans", () => {
    const weeklyPlan = { student_id: "student-1" };

    expect(canReadWeeklyPlan(student, weeklyPlan)).toBe(true);
    expect(canReadWeeklyPlan(otherStudent, weeklyPlan)).toBe(false);
    expect(canReadWeeklyPlan(admin, weeklyPlan)).toBe(true);
  });
});

describe("weekly plan check-in gate", () => {
  it("requires the Sunday-start weekly plan for the current checklist week", () => {
    expect(weeklyPlanRequiredWeekStart("2026-06-14")).toBe("2026-06-14");
    expect(weeklyPlanRequiredWeekStart("2026-06-17")).toBe("2026-06-14");
  });

  it("blocks check-in when the Sunday-start weekly plan is missing", () => {
    expect(weeklyPlanBlocksCheckIn(null, "2026-06-14")).toBe(true);
  });

  it("unlocks check-in when the Sunday-start weekly plan exists", () => {
    expect(weeklyPlanBlocksCheckIn({ week_start: "2026-06-14" }, "2026-06-14")).toBe(false);
  });

  it("does not count old Saturday-keyed weekly plans", () => {
    expect(weeklyPlanBlocksCheckIn({ week_start: "2026-06-13" }, "2026-06-14")).toBe(true);
  });

  it("gates only the daily check-in route", () => {
    expect(routeIsWeeklyPlanGated("/student/check-in")).toBe(true);
    expect(routeIsWeeklyPlanGated("/student/weekly-plan")).toBe(false);
    expect(routeIsWeeklyPlanGated("/student/grades")).toBe(false);
    expect(routeIsWeeklyPlanGated("/student/history")).toBe(false);
    expect(routeIsWeeklyPlanGated("/student/partner-recitation")).toBe(false);
    expect(routeIsWeeklyPlanGated("/account/change-password")).toBe(false);
  });
});
