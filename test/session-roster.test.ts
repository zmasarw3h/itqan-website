import { describe, expect, it } from "vitest";
import {
  defaultSessionRosterPlacement,
  publishedSessionRosterStudents,
  sessionRosterHasOnlyWarningImbalance,
  sessionRosterWeekIdentity,
  validateExactlyOncePlacement,
  type SessionRosterDraftStudent,
  type SessionRosterReadiness
} from "@/lib/session-roster";

const attendingStudent = (overrides: Partial<SessionRosterDraftStudent> = {}): SessionRosterDraftStudent => ({
  student_id: "student-a",
  student_name: "Student A",
  attendance_status: "attending",
  unavailable_reason: null,
  usual_group_id: "group-a",
  usual_group_name: "Group A",
  session_group_id: "group-a",
  placed_by: null,
  placed_at: null,
  ...overrides
});

describe("session roster domain contract", () => {
  it("keeps Sunday as the storage identity and derives Saturday for the session", () => {
    expect(sessionRosterWeekIdentity("2026-08-15")).toEqual({
      weekStart: "2026-08-09",
      halaqaSaturday: "2026-08-15"
    });
  });

  it("defaults attending students to usual groups and excludes explicit absences", () => {
    const students = [
      attendingStudent(),
      attendingStudent({
        student_id: "student-b",
        student_name: "Student B",
        attendance_status: "unavailable",
        unavailable_reason: "Family commitment",
        session_group_id: null
      })
    ];

    expect(defaultSessionRosterPlacement(students)).toEqual([
      { studentId: "student-a", sessionGroupId: "group-a" }
    ]);
    expect(publishedSessionRosterStudents(students).map((student) => student.student_id)).toEqual(["student-a"]);
  });

  it("requires exactly one placement for every attending student", () => {
    expect(validateExactlyOncePlacement([
      attendingStudent(),
      attendingStudent({
        student_id: "student-b",
        student_name: "Student B",
        session_group_id: "group-b"
      })
    ])).toBe(true);

    expect(validateExactlyOncePlacement([
      attendingStudent(),
      attendingStudent({
        student_id: "student-b",
        student_name: "Student B",
        session_group_id: null
      })
    ])).toBe(false);
  });

  it("treats imbalance as a warning and not a publish blocker", () => {
    const readiness: SessionRosterReadiness = {
      can_publish: true,
      attending_count: 3,
      unavailable_count: 0,
      placed_count: 3,
      unplaced_count: 0,
      group_counts: [],
      unplaced_students: [],
      missing_primary_teachers: [],
      warning_codes: ["group_imbalance"],
      blocker_codes: [],
      source_stale: false,
      reviewed_current: true,
      current_source_digest: "digest"
    };

    expect(sessionRosterHasOnlyWarningImbalance(readiness)).toBe(true);
  });
});
