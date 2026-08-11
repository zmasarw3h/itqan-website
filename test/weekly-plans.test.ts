import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isCanonicalTrackerWeek, weeklyPlanPathMatchesExactContext } from "@/lib/admin-weekly-plan";
import type { Profile } from "@/lib/types";
import {
  canReadWeeklyPlan,
  canStudentManageWeeklyPlan,
  currentWeeklyPlanContext,
  routeIsWeeklyPlanGated,
  safeWeeklyPlanFileName,
  validateWeeklyPlanFile,
  WEEKLY_PLAN_MAX_BYTES,
  weeklyPlanBlocksCheckIn,
  weeklyPlanPathBelongsToStudent,
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
  it("allows PNG, JPG, and PDF files up to 3 MB", () => {
    expect(validateWeeklyPlanFile({ name: "plan.png", type: "image/png", size: 1024 })).toBeNull();
    expect(validateWeeklyPlanFile({ name: "plan.jpg", type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateWeeklyPlanFile({ name: "plan.pdf", type: "application/pdf", size: 1024 })).toBeNull();
    expect(validateWeeklyPlanFile({ name: "plan.pdf", type: "application/pdf", size: WEEKLY_PLAN_MAX_BYTES })).toBeNull();
  });

  it("rejects unsupported file types", () => {
    expect(validateWeeklyPlanFile({ name: "plan.gif", type: "image/gif", size: 1024 })).toBe(
      "Upload a PNG, JPG, or PDF file."
    );
  });

  it("rejects files larger than 3 MB", () => {
    expect(validateWeeklyPlanFile({ name: "plan.pdf", type: "application/pdf", size: WEEKLY_PLAN_MAX_BYTES + 1 })).toBe(
      "Weekly plan files must be 3 MB or smaller."
    );
  });

  it("generates safe storage paths", () => {
    expect(safeWeeklyPlanFileName(" My Plan (Final).PDF ")).toBe("my-plan-final.pdf");
    expect(safeWeeklyPlanFileName("../..")).toBe("weekly-plan");
    expect(weeklyPlanStoragePath("student-1", "2026-05-09", " My Plan.PDF ")).toBe(
      "student-1/2026-05-09/my-plan.pdf"
    );
  });

  it("rejects weekly-plan paths outside the student's week folder", () => {
    expect(weeklyPlanPathBelongsToStudent("student-1", "2026-05-10", "student-1/2026-05-10/plan.pdf")).toBe(true);
    expect(weeklyPlanPathBelongsToStudent("student-1", "2026-05-10", "student-2/2026-05-10/plan.pdf")).toBe(false);
    expect(weeklyPlanPathBelongsToStudent("student-1", "2026-05-10", "student-1/2026-05-10/../secret.pdf")).toBe(false);
  });

  it("validates the exact admin viewer path, student, week, and normalized filename", () => {
    const studentId = "11111111-1111-4111-8111-111111111111";
    const weekStart = "2026-07-19";
    const exactPath = `${studentId}/${weekStart}/plan.pdf`;

    expect(isCanonicalTrackerWeek(weekStart)).toBe(true);
    expect(weeklyPlanPathMatchesExactContext(studentId, weekStart, exactPath, "plan.pdf")).toBe(true);
    expect(weeklyPlanPathMatchesExactContext(studentId, weekStart, `${studentId}/${weekStart}/../plan.pdf`, "plan.pdf")).toBe(false);
    expect(weeklyPlanPathMatchesExactContext(studentId, weekStart, `${studentId}/${weekStart}/nested/plan.pdf`, "plan.pdf")).toBe(false);
    expect(weeklyPlanPathMatchesExactContext(studentId, weekStart, `22222222-2222-4222-8222-222222222222/${weekStart}/plan.pdf`, "plan.pdf")).toBe(false);
    expect(weeklyPlanPathMatchesExactContext(studentId, "2026-07-20", exactPath, "plan.pdf")).toBe(false);
    expect(weeklyPlanPathMatchesExactContext(studentId, weekStart, exactPath, "substituted.pdf")).toBe(false);
    expect(weeklyPlanPathMatchesExactContext(studentId, weekStart, `${studentId}/${weekStart}/Plan.PDF`)).toBe(false);
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
  it("uses Saturday's operational week on Saturday evening", () => {
    expect(currentWeeklyPlanContext(new Date("2026-07-19T03:30:00.000Z"))).toEqual({
      effectiveDate: "2026-07-18",
      weekStart: "2026-07-12"
    });
  });

  it("keeps the Saturday plan week through Sunday 00:00-00:59 Toronto", () => {
    for (const timestamp of ["2026-07-19T04:00:00.000Z", "2026-07-19T04:59:00.000Z"]) {
      expect(currentWeeklyPlanContext(new Date(timestamp))).toEqual({
        effectiveDate: "2026-07-18",
        weekStart: "2026-07-12"
      });
    }
  });

  it("switches to the new Sunday plan week exactly at 1:00 Toronto", () => {
    expect(currentWeeklyPlanContext(new Date("2026-07-19T05:00:00.000Z"))).toEqual({
      effectiveDate: "2026-07-19",
      weekStart: "2026-07-19"
    });
  });

  it("keeps the weekly-plan context aligned across spring DST", () => {
    expect(currentWeeklyPlanContext(new Date("2026-03-08T05:30:00.000Z"))).toEqual({
      effectiveDate: "2026-03-07",
      weekStart: "2026-03-01"
    });
    expect(currentWeeklyPlanContext(new Date("2026-03-08T07:30:00.000Z"))).toEqual({
      effectiveDate: "2026-03-08",
      weekStart: "2026-03-08"
    });
  });

  it("keeps both fall DST 1 AM occurrences in the new Sunday plan week", () => {
    for (const timestamp of ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]) {
      expect(currentWeeklyPlanContext(new Date(timestamp))).toEqual({
        effectiveDate: "2026-11-01",
        weekStart: "2026-11-01"
      });
    }
  });

  it("requires the Sunday-start weekly plan for the current checklist week", () => {
    expect(weeklyPlanRequiredWeekStart("2026-06-14")).toBe("2026-06-14");
    expect(weeklyPlanRequiredWeekStart("2026-06-17")).toBe("2026-06-14");
  });

  it("uses the same week for the page, checklist action, plan page, and upload action", () => {
    const context = currentWeeklyPlanContext(new Date("2026-07-19T04:59:00.000Z"));

    expect(context.weekStart).toBe(weeklyPlanRequiredWeekStart(context.effectiveDate));
    expect(weeklyPlanBlocksCheckIn({ week_start: context.weekStart }, context.effectiveDate)).toBe(false);
    expect(weeklyPlanBlocksCheckIn(null, context.effectiveDate)).toBe(true);
    expect(weeklyPlanBlocksCheckIn({ week_start: "2026-07-19" }, context.effectiveDate)).toBe(true);
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
