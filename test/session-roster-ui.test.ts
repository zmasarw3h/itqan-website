import { describe, expect, it } from "vitest";
import type { SessionRosterReadiness } from "@/lib/session-roster";
import {
  sessionRosterAfterDraftMutation,
  sessionRosterAfterPublish,
  sessionRosterActionError,
  sessionRosterAuditLabel,
  sessionRosterPublishBlocked,
  sessionRosterRefreshNotice,
  sessionRosterReadinessSummary
} from "@/lib/session-roster-ui";
import type {
  RefreshSessionRosterDraftResponse,
  SessionRosterDraftResponse,
  SessionRosterHistoryResponse,
  SessionRosterPublishedResponse
} from "@/lib/session-roster";

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

  it("replaces local state with authoritative server responses after every draft mutation", () => {
    const published = publishedResponse();
    const history = historyResponse();
    for (const revision of [2, 3, 4, 5]) {
      const draft = draftResponse(revision);
      expect(sessionRosterAfterDraftMutation({ draft, history, published })).toEqual({ draft, history, published });
    }
  });

  it("uses the atomically returned published version and clears the editable draft", () => {
    const published = publishedResponse();
    const history = historyResponse();
    expect(sessionRosterAfterPublish({ published, history })).toEqual({ draft: null, history, published });
  });

  it("only reports stale refresh success when the server confirms discard plus review-required", () => {
    const response = {
      ...draftResponse(6),
      refresh: {
        superseded_draft_id: "old-draft",
        superseded_state_version: 4,
        refreshed_draft_id: "new-draft",
        refreshed_state_version: 0,
        discarded_manual_edits: true,
        discarded_manual_edit_kinds: ["student_placement", "primary_teacher_responsibility"],
        requires_review: true,
        published_version_unchanged: true,
        published_version_id: "version-1",
        source_state_digest: "fresh"
      }
    } satisfies RefreshSessionRosterDraftResponse;
    expect(sessionRosterRefreshNotice(response)).toContain("discarded");
    expect(sessionRosterRefreshNotice({ ...response, refresh: { ...response.refresh, requires_review: false } } as unknown as RefreshSessionRosterDraftResponse)).toContain("did not return");
  });
});

function draftResponse(revisionNumber: number): SessionRosterDraftResponse {
  return {
    contract_version: 1,
    draft: {
      id: `draft-${revisionNumber}`,
      masjid_id: "masjid-a",
      cohort_id: "cohort-a",
      week_start: "2026-08-02",
      halaqa_saturday: "2026-08-08",
      revision_number: revisionNumber,
      status: "draft",
      base_published_version_id: null,
      source_state_digest: "source",
      current_source_digest: "source",
      source_stale: false,
      state_version: revisionNumber,
      reviewed_at: null,
      reviewed_by: null,
      reviewed_state_version: null,
      published_version_id: null,
      created_by: "admin-a",
      updated_by: "admin-a",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z"
    },
    groups: [],
    students: [],
    roster: [],
    readiness: readiness()
  };
}

function publishedResponse(): SessionRosterPublishedResponse {
  return { contract_version: 1, version: null, groups: [], roster: [] };
}

function historyResponse(): SessionRosterHistoryResponse {
  return { contract_version: 1, cohort_id: "cohort-a", week_start: "2026-08-02", halaqa_saturday: "2026-08-08", versions: [], audit_events: [] };
}
