import { describe, expect, it } from "vitest";
import {
  canReadAdminData,
  canReadCheckInScores,
  canReadStudentData,
  canSubmitStudentCheckIn,
  defaultPathForRole,
  navigationLinksForRole
} from "@/lib/access";
import type { Profile } from "@/lib/types";

const student: Profile = {
  id: "student-1",
  name: "Student One",
  email: "14165550101@itqan.local",
  phone: "+1 555 0101",
  role: "student",
  active: true
};

const otherStudent: Profile = {
  id: "student-2",
  name: "Student Two",
  email: "14165550102@itqan.local",
  phone: null,
  role: "student",
  active: true
};

const admin: Profile = {
  id: "admin-1",
  name: "Admin One",
  email: "14165550000@itqan.local",
  phone: null,
  role: "admin",
  active: true
};

const teacher: Profile = {
  id: "teacher-1",
  name: "Teacher One",
  email: "14165550200@itqan.local",
  phone: null,
  role: "teacher",
  active: true
};

const superAdmin: Profile = {
  id: "super-admin-1",
  name: "Super Admin One",
  email: "14165550300@itqan.local",
  phone: null,
  role: "super_admin",
  active: true
};

describe("access rules", () => {
  it("allows students to read only their own data", () => {
    expect(canReadStudentData(student, student.id)).toBe(true);
    expect(canReadStudentData(student, otherStudent.id)).toBe(false);
  });

  it("prevents students from reading admin data", () => {
    expect(canReadAdminData(student)).toBe(false);
  });

  it("allows admins to read all student data and admin data", () => {
    expect(canReadStudentData(admin, student.id)).toBe(true);
    expect(canReadStudentData(admin, otherStudent.id)).toBe(true);
    expect(canReadAdminData(admin)).toBe(true);
  });

  it("keeps teacher access out of broad admin and student-owned helpers", () => {
    expect(canReadAdminData(teacher)).toBe(false);
    expect(canReadStudentData(teacher, student.id)).toBe(false);
    expect(canSubmitStudentCheckIn(teacher, student.id)).toBe(false);
  });

  it("allows super admins to use existing broad admin fallbacks until scoped UI exists", () => {
    expect(canReadAdminData(superAdmin)).toBe(true);
    expect(canReadStudentData(superAdmin, student.id)).toBe(true);
  });

  it("allows admins to view scores", () => {
    expect(canReadCheckInScores(admin, student.id)).toBe(true);
    expect(canReadCheckInScores(admin, otherStudent.id)).toBe(true);
  });

  it("prevents students from reading other students' scores", () => {
    expect(canReadCheckInScores(student, student.id)).toBe(true);
    expect(canReadCheckInScores(student, otherStudent.id)).toBe(false);
  });

  it("allows only the active student to submit their own check-in", () => {
    expect(canSubmitStudentCheckIn(student, student.id)).toBe(true);
    expect(canSubmitStudentCheckIn(student, otherStudent.id)).toBe(false);
    expect(canSubmitStudentCheckIn(admin, student.id)).toBe(false);
  });

  it("routes roles to their default app area", () => {
    expect(defaultPathForRole("student")).toBe("/student/check-in");
    expect(defaultPathForRole("admin")).toBe("/admin");
    expect(defaultPathForRole("teacher")).toBe("/teacher");
    expect(defaultPathForRole("super_admin")).toBe("/super-admin");
  });

  it("adds teacher navigation only for admins with teacher capability", () => {
    expect(navigationLinksForRole("admin", false).some((link) => link.href === "/teacher")).toBe(false);
    expect(navigationLinksForRole("admin", true).some((link) => link.href === "/teacher")).toBe(true);
    expect(navigationLinksForRole("teacher").map((link) => link.href)).toContain("/teacher");
  });

  it("exposes the complete super-admin console navigation", () => {
    expect(navigationLinksForRole("super_admin").map((link) => link.href)).toEqual([
      "/super-admin",
      "/super-admin/people",
      "/super-admin/masajid",
      "/super-admin/repairs",
      "/super-admin/audit",
      "/account/change-password"
    ]);
  });
});
