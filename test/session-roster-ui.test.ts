import { describe, expect, it } from "vitest";
import type { SessionRosterReadiness } from "@/lib/session-roster";
import {
  sessionRosterActionError,
  sessionRosterAuditLabel,
  sessionRosterPublishBlocked,
  sessionRosterReadinessSummary
} from "@/lib/session-roster-ui";

function readiness(overrides: Partial<SessionRosterReadiness> = {}): SessionRosterReadiness {
  return {
    can_publish: true,
    attending_count: 8,
    unavailable_count: 1,
    placed_count: 8,
    unplaced_count: 0,
    group_counts: [],
    unplaced_students: [],
    missing_primary_teachers: [],
    warning_codes: [],
    blocker_codes: [],
    source_stale: false,
    reviewed_current: true,
    current_source_digest: "current",
    ...overrides
  };
}

describe("session roster UI action states", () => {
  it("keeps imbalance warning-only while unplaced students and missing teachers block publish", () => {
    expect(sessionRosterPublishBlocked(readiness({ warning_codes: ["group_imbalance"] }))).toBe(false);
    expect(sessionRosterPublishBlocked(readiness({
      can_publish: false,
      unplaced_count: 1,
      blocker_codes: ["unplaced_attending_students"]
    }))).toBe(true);
    expect(sessionRosterPublishBlocked(readiness({
      can_publish: false,
      missing_primary_teachers: [{ group_id: "group-a", group_name: "Level 1" }],
      blocker_codes: ["missing_primary_teacher_responsibility"]
    }))).toBe(true);
  });

  it("requires a fresh review after a move, responsibility change, revision, or refresh", () => {
    expect(sessionRosterPublishBlocked(readiness({ can_publish: false, reviewed_current: false, blocker_codes: ["review_required"] }))).toBe(true);
    expect(sessionRosterReadinessSummary(readiness({ can_publish: false, reviewed_current: false, blocker_codes: ["review_required"] }))).toBe("Review this draft before publishing.");
  });

  it("turns stale and replay/concurrent responses into a safe reload path", () => {
    expect(sessionRosterActionError("session_roster_stale_draft")).toBe("stale");
    expect(sessionRosterActionError("session_roster_source_stale")).toBe("stale");
    expect(sessionRosterActionError("session_roster_refresh_stale_draft")).toBe("stale");
    expect(sessionRosterActionError("session_roster_revision_conflict")).toBe("conflict");
    expect(sessionRosterActionError("session_roster_request_reused")).toBe("conflict");
    expect(sessionRosterActionError("session_roster_request_payload_mismatch")).toBe("conflict");
  });

  it("renders audit events for draft loading, edits, publication, revision, and stale refresh", () => {
    expect(sessionRosterAuditLabel("draft_created")).toBe("Draft created");
    expect(sessionRosterAuditLabel("student_moved")).toBe("Session group updated");
    expect(sessionRosterAuditLabel("primary_teacher_assigned")).toBe("Primary teacher assigned");
    expect(sessionRosterAuditLabel("version_published")).toBe("Saturday roster published");
    expect(sessionRosterAuditLabel("revision_created")).toBe("Revision started");
    expect(sessionRosterAuditLabel("draft_refreshed")).toBe("Stale draft refreshed");
  });
});
