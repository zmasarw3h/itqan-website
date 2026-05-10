import { describe, expect, it } from "vitest";
import { canReadAdminData, canReadCheckInScores, canReadStudentData, canSubmitStudentCheckIn } from "@/lib/access";
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
});
