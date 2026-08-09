import type { SessionRosterWizardDraftResponse } from "@/lib/session-roster";

export type SessionRosterStudentMovement = {
  moved: boolean;
  unanchored: boolean;
};

export type SessionRosterMovementSummary = {
  byStudentId: Map<string, SessionRosterStudentMovement>;
  movedCountBySlotId: Map<string, number>;
  unanchoredCountBySlotId: Map<string, number>;
  movedTotal: number;
  unanchoredTotal: number;
};

/**
 * A Saturday placement is moved only when an attending student is placed in a
 * slot with a non-null permanent anchor that differs from their usual group.
 * Unanchored slots are reported separately because there is no anchor to
 * compare. Absent and unplaced students are excluded from both totals.
 */
export function sessionRosterMovementSummary(
  draft: Pick<SessionRosterWizardDraftResponse, "groups" | "students">
): SessionRosterMovementSummary {
  const anchorBySlotId = new Map(
    draft.groups.map((group) => [group.session_group_slot_id, group.anchor_group_id])
  );
  const byStudentId = new Map<string, SessionRosterStudentMovement>();
  const movedCountBySlotId = new Map<string, number>();
  const unanchoredCountBySlotId = new Map<string, number>();
  let movedTotal = 0;
  let unanchoredTotal = 0;

  for (const student of draft.students) {
    if (student.attendance_status !== "attending" || !student.session_group_slot_id) {
      byStudentId.set(student.student_id, { moved: false, unanchored: false });
      continue;
    }

    const anchorGroupId = anchorBySlotId.get(student.session_group_slot_id);
    const unanchored = anchorGroupId == null;
    const moved = !unanchored && anchorGroupId !== student.usual_group_id;

    byStudentId.set(student.student_id, { moved, unanchored });
    if (moved) {
      movedTotal += 1;
      movedCountBySlotId.set(
        student.session_group_slot_id,
        (movedCountBySlotId.get(student.session_group_slot_id) ?? 0) + 1
      );
    }
    if (unanchored) {
      unanchoredTotal += 1;
      unanchoredCountBySlotId.set(
        student.session_group_slot_id,
        (unanchoredCountBySlotId.get(student.session_group_slot_id) ?? 0) + 1
      );
    }
  }

  return {
    byStudentId,
    movedCountBySlotId,
    unanchoredCountBySlotId,
    movedTotal,
    unanchoredTotal
  };
}
