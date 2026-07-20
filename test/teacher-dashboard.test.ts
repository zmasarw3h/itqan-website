import { describe, expect, it } from "vitest";
import {
  assignmentWeekStarts,
  assignmentsForWeek,
  canAccessTeacherExperience,
  hasActiveTeacherStaffMembership,
  isTrackerWeekStart,
  parseTeacherGradeInput,
  resolveTeacherWeekStart,
  selectTeacherRoster,
  type TeacherAssignmentContext
} from "@/lib/teacher-dashboard";
import type { Profile } from "@/lib/types";

const currentWeek = "2026-07-19";

const teacher: Profile = {
  id: "teacher-1",
  name: "Teacher",
  email: "teacher@example.com",
  phone: null,
  role: "teacher",
  active: true
};

const admin: Profile = { ...teacher, id: "admin-1", role: "admin" };

const assignments: TeacherAssignmentContext[] = [
  {
    assignment_id: "assignment-b",
    group_id: "group-b",
    group_name: "Group B",
    cohort_id: "cohort-a",
    cohort_name: "Brothers",
    cohort_kind: "brothers",
    masjid_id: "masjid-a",
    masjid_name: "Masjid A",
    week_start: currentWeek,
    roster_count: 2
  },
  {
    assignment_id: "assignment-a",
    group_id: "group-a",
    group_name: "Group A",
    cohort_id: "cohort-a",
    cohort_name: "Brothers",
    cohort_kind: "brothers",
    masjid_id: "masjid-a",
    masjid_name: "Masjid A",
    week_start: "2026-07-12",
    roster_count: 1
  }
];

describe("teacher dashboard scope", () => {
  it("accepts only Sunday tracker weeks and falls back safely", () => {
    expect(isTrackerWeekStart(currentWeek)).toBe(true);
    expect(isTrackerWeekStart("2026-07-20")).toBe(false);
    expect(resolveTeacherWeekStart("2026-07-12", currentWeek)).toBe("2026-07-12");
    expect(resolveTeacherWeekStart("2026-07-20", currentWeek)).toBe(currentWeek);
    expect(resolveTeacherWeekStart(["2026-07-12", currentWeek], currentWeek)).toBe("2026-07-12");
  });

  it("builds deterministic week and assignment selections", () => {
    expect(assignmentWeekStarts(assignments, currentWeek)).toEqual([currentWeek, "2026-07-12"]);
    expect(assignmentsForWeek(assignments, currentWeek).map((assignment) => assignment.group_id)).toEqual(["group-b"]);
  });

  it("scopes a moved student to the group effective for the selected week", () => {
    const memberships = [
      { student_id: "student-1", group_id: "group-a", starts_on: "2026-07-01", ends_on: "2026-07-18" },
      { student_id: "student-1", group_id: "group-b", starts_on: "2026-07-19", ends_on: null },
      { student_id: "student-2", group_id: "group-b", starts_on: "2026-07-01", ends_on: null }
    ];
    const profiles = [
      { id: "student-1", name: "Zayd", active: true },
      { id: "student-2", name: "Adam", active: true },
      { id: "student-3", name: "Hidden", active: true }
    ];

    expect(selectTeacherRoster({ groupId: "group-a", weekStart: "2026-07-12", memberships, profiles })).toEqual([
      { id: "student-1", name: "Zayd" }
    ]);
    expect(selectTeacherRoster({ groupId: "group-b", weekStart: currentWeek, memberships, profiles })).toEqual([
      { id: "student-2", name: "Adam" },
      { id: "student-1", name: "Zayd" }
    ]);
  });

  it("allows teachers and active admin-teachers while denying pure admins", () => {
    const activeMembership = [{ staff_role: "teacher" as const, active: true, starts_on: "2026-07-01", ends_on: null }];

    expect(hasActiveTeacherStaffMembership(activeMembership, "2026-07-20")).toBe(true);
    expect(canAccessTeacherExperience(teacher, false)).toBe(true);
    expect(canAccessTeacherExperience(admin, true)).toBe(true);
    expect(canAccessTeacherExperience(admin, false)).toBe(false);
    expect(canAccessTeacherExperience({ ...teacher, active: false }, true)).toBe(false);
  });

  it("validates attended and absent grade shapes", () => {
    expect(parseTeacherGradeInput({ attended: true, recitationPoints: "40", notes: " Good work " })).toEqual({
      attended: true,
      attendancePoints: 100,
      recitationPoints: 40,
      notes: "Good work"
    });
    expect(parseTeacherGradeInput({ attended: false, recitationPoints: "999", notes: "" })).toEqual({
      attended: false,
      attendancePoints: 0,
      recitationPoints: 0,
      notes: null
    });
    expect(parseTeacherGradeInput({ attended: true, recitationPoints: "9", notes: null })).toBeNull();
    expect(parseTeacherGradeInput({ attended: true, recitationPoints: "40.5", notes: null })).toBeNull();
  });
});
