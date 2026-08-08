import type {
  RefreshSessionRosterDraftResponse,
  SessionRosterDraftResponse,
  SessionRosterHistoryEvent,
  SessionRosterHistoryResponse,
  SessionRosterPublishedResponse,
  SessionRosterReadiness
} from "@/lib/session-roster";

export type SessionRosterActionError = "stale" | "blocked" | "unauthorized" | "conflict" | "failed";

export function sessionRosterActionError(message: string): SessionRosterActionError {
  if (message.includes("stale") || message.includes("source_stale") || message.includes("review_required")) {
    return "stale";
  }
  if (message.includes("unplaced") || message.includes("missing_primary") || message.includes("confirmation_required")) {
    return "blocked";
  }
  if (message.includes("unauthorized") || message.includes("scope_mismatch") || message.includes("42501")) {
    return "unauthorized";
  }
  if (message.includes("conflict") || message.includes("request_reused") || message.includes("payload_mismatch") || message.includes("replay")) {
    return "conflict";
  }
  return "failed";
}

export function sessionRosterPublishBlocked(readiness: SessionRosterReadiness) {
  return !readiness.can_publish || readiness.source_stale || !readiness.reviewed_current;
}

export function sessionRosterAuditLabel(action: SessionRosterHistoryEvent["action"]) {
  return {
    draft_created: "Draft created",
    student_moved: "Session group updated",
    primary_teacher_assigned: "Primary teacher assigned",
    draft_reviewed: "Review prepared",
    version_published: "Saturday roster published",
    revision_created: "Revision started",
    draft_refreshed: "Stale draft refreshed",
    source_dependency_changed: "Source availability changed"
  }[action];
}

export function sessionRosterReadinessSummary(readiness: SessionRosterReadiness) {
  if (readiness.source_stale) {
    return "This draft is out of date. Refresh it before review or publication.";
  }
  if (readiness.unplaced_count > 0) {
    return `${readiness.unplaced_count} attending ${readiness.unplaced_count === 1 ? "student is" : "students are"} unplaced.`;
  }
  if (readiness.missing_primary_teachers.length > 0) {
    return `${readiness.missing_primary_teachers.length} ${readiness.missing_primary_teachers.length === 1 ? "group needs" : "groups need"} a primary teacher.`;
  }
  if (!readiness.reviewed_current) {
    return "Review this draft before publishing.";
  }
  return "Ready to publish.";
}

export type SessionRosterAuthoritativeState = {
  draft: SessionRosterDraftResponse | null;
  history: SessionRosterHistoryResponse;
  published: SessionRosterPublishedResponse;
};

/** The UI only accepts server-returned values after each stateful operation. */
export function sessionRosterAfterDraftMutation(input: {
  draft: SessionRosterDraftResponse;
  history: SessionRosterHistoryResponse;
  published: SessionRosterPublishedResponse;
}): SessionRosterAuthoritativeState {
  return { draft: input.draft, history: input.history, published: input.published };
}

export function sessionRosterAfterPublish(input: {
  published: SessionRosterPublishedResponse;
  history: SessionRosterHistoryResponse;
}): SessionRosterAuthoritativeState {
  return { draft: null, history: input.history, published: input.published };
}

export function sessionRosterRefreshNotice(response: RefreshSessionRosterDraftResponse) {
  return response.refresh.discarded_manual_edits && response.refresh.requires_review
    ? "Draft refreshed. Unpublished placement and primary-teacher edits were discarded; review is required again."
    : "Draft refresh did not return the required discard confirmation.";
}
