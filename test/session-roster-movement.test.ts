import { describe, expect, it } from "vitest";
import type { SessionRosterWizardDraftResponse } from "@/lib/session-roster";
import { sessionRosterMovementSummary } from "@/lib/session-roster-movement";

type MovementDraft = Pick<SessionRosterWizardDraftResponse, "groups" | "students">;

function draft(input: {
  anchor?: string | null;
  attendance?: "attending" | "unavailable";
  slot?: string | null;
  usual?: string;
} = {}): MovementDraft {
  const slot = input.slot === undefined ? "slot-a" : input.slot;
  return {
    groups: [{
      session_group_slot_id: "slot-a",
      anchor_group_id: input.anchor === undefined ? "group-a" : input.anchor,
      group_id: "slot-namespace-id",
      group_name: "Session group A"
    }] as MovementDraft["groups"],
    students: [{
      student_id: "student-a",
      student_name: "Student A",
      attendance_status: input.attendance ?? "attending",
      unavailable_reason: null,
      usual_group_id: input.usual ?? "group-a",
      usual_group_name: "Permanent group A",
      session_group_id: "different-slot-namespace-id",
      session_group_slot_id: slot,
      placed_by: null,
      placed_at: null
    }] as MovementDraft["students"]
  };
}

describe("Saturday roster movement semantics", () => {
  it("does not mark an unchanged anchored placement moved even when slot UUID namespaces differ", () => {
    const summary = sessionRosterMovementSummary(draft());
    expect(summary.byStudentId.get("student-a")).toEqual({ moved: false, unanchored: false });
    expect(summary.movedTotal).toBe(0);
  });

  it("marks a genuinely redistributed attending student moved", () => {
    const summary = sessionRosterMovementSummary(draft({ anchor: "group-b" }));
    expect(summary.byStudentId.get("student-a")).toEqual({ moved: true, unanchored: false });
    expect(summary.movedCountBySlotId.get("slot-a")).toBe(1);
  });

  it("excludes absent and unplaced students", () => {
    expect(sessionRosterMovementSummary(draft({ attendance: "unavailable", anchor: "group-b" })).movedTotal).toBe(0);
    expect(sessionRosterMovementSummary(draft({ slot: null, anchor: "group-b" })).movedTotal).toBe(0);
  });

  it("reports unanchored placements separately and never counts them moved", () => {
    const summary = sessionRosterMovementSummary(draft({ anchor: null }));
    expect(summary.byStudentId.get("student-a")).toEqual({ moved: false, unanchored: true });
    expect(summary.movedTotal).toBe(0);
    expect(summary.unanchoredCountBySlotId.get("slot-a")).toBe(1);
  });

  it("recomputes from regenerated slot anchors", () => {
    expect(sessionRosterMovementSummary(draft({ anchor: "group-b" })).movedTotal).toBe(1);
    expect(sessionRosterMovementSummary(draft({ anchor: "group-a" })).movedTotal).toBe(0);
  });

  it("uses the same anchor comparison for revision drafts", () => {
    const revision = draft({ anchor: "group-b", usual: "group-a" });
    expect(sessionRosterMovementSummary(revision).movedTotal).toBe(1);
  });
});
