import { halaqaSaturdayForWeek, weekStartForDate } from "@/lib/dates";

export const SESSION_ROSTER_CONTRACT_VERSION = 1 as const;

export type SessionRosterAttendanceStatus = "attending" | "unavailable";

export type SessionRosterBlockerCode =
  | "unplaced_attending_students"
  | "missing_primary_teacher_responsibility"
  | "source_changed"
  | "review_required"
  | "no_session_groups";

export type SessionRosterWarningCode = "group_imbalance";

export type SessionRosterGroup = {
  group_id: string;
  group_name: string;
  group_sort_order: number;
  primary_teacher_id: string | null;
  primary_teacher_name: string | null;
};

export type SessionRosterDraftStudent = {
  student_id: string;
  student_name: string;
  attendance_status: SessionRosterAttendanceStatus;
  unavailable_reason: string | null;
  usual_group_id: string;
  usual_group_name: string;
  session_group_id: string | null;
  placed_by: string | null;
  placed_at: string | null;
};

export type SessionRosterDraftRosterStudent = Pick<
  SessionRosterDraftStudent,
  "student_id" | "student_name" | "usual_group_id" | "usual_group_name" | "session_group_id"
>;

export type SessionRosterGroupCount = SessionRosterGroup & {
  attending_count: number;
};

export type SessionRosterReadiness = {
  can_publish: boolean;
  attending_count: number;
  unavailable_count: number;
  placed_count: number;
  unplaced_count: number;
  group_counts: SessionRosterGroupCount[];
  unplaced_students: Array<Pick<SessionRosterDraftStudent, "student_id" | "student_name" | "usual_group_id" | "usual_group_name">>;
  missing_primary_teachers: Array<Pick<SessionRosterGroup, "group_id" | "group_name">>;
  warning_codes: SessionRosterWarningCode[];
  blocker_codes: SessionRosterBlockerCode[];
  source_stale: boolean;
  reviewed_current: boolean;
  current_source_digest: string | null;
};

export type SessionRosterDraftMetadata = {
  id: string;
  masjid_id: string;
  cohort_id: string;
  week_start: string;
  halaqa_saturday: string;
  revision_number: number;
  status: "draft" | "published";
  base_published_version_id: string | null;
  source_state_digest: string;
  current_source_digest: string | null;
  source_stale: boolean;
  state_version: number;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_state_version: number | null;
  published_version_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type SessionRosterDraftResponse = {
  contract_version: typeof SESSION_ROSTER_CONTRACT_VERSION;
  draft: SessionRosterDraftMetadata;
  groups: SessionRosterGroup[];
  students: SessionRosterDraftStudent[];
  roster: SessionRosterDraftRosterStudent[];
  readiness: SessionRosterReadiness;
};

export type SessionRosterPublishedVersion = {
  id: string;
  masjid_id: string;
  cohort_id: string;
  week_start: string;
  halaqa_saturday: string;
  version_number: number;
  source_draft_id: string;
  source_draft_revision: number;
  source_state_digest: string;
  published_by: string;
  published_at: string;
};

export type SessionRosterPublishedStudent = {
  student_id: string;
  student_name: string;
  usual_group_id: string;
  usual_group_name: string;
  session_group_id: string;
  placement_order: number;
};

export type SessionRosterPublishedResponse = {
  contract_version: typeof SESSION_ROSTER_CONTRACT_VERSION;
  version: SessionRosterPublishedVersion | null;
  groups: SessionRosterGroup[];
  roster: SessionRosterPublishedStudent[];
};

export type SessionRosterHistoryEvent = {
  id: string;
  occurred_at: string;
  actor_id: string;
  action:
    | "draft_created"
    | "student_moved"
    | "primary_teacher_assigned"
    | "draft_reviewed"
    | "version_published"
    | "revision_created";
  draft_id: string | null;
  version_id: string | null;
  request_id: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type SessionRosterHistoryResponse = {
  contract_version: typeof SESSION_ROSTER_CONTRACT_VERSION;
  cohort_id: string;
  week_start: string;
  halaqa_saturday: string;
  versions: Array<Pick<
    SessionRosterPublishedVersion,
    | "id"
    | "version_number"
    | "source_draft_id"
    | "source_draft_revision"
    | "source_state_digest"
    | "published_by"
    | "published_at"
  >>;
  audit_events: SessionRosterHistoryEvent[];
};

export type SessionRosterRpcName =
  | "load_or_create_session_roster_draft"
  | "get_session_roster_draft"
  | "move_session_roster_student"
  | "assign_session_roster_primary_teacher"
  | "compute_session_roster_readiness"
  | "review_session_roster_draft"
  | "publish_session_roster_draft"
  | "create_session_roster_revision"
  | "get_current_session_roster"
  | "get_session_roster_history";

export type SessionRosterRpcErrorCode =
  | "PT412"
  | "PT422"
  | "42501"
  | "P0002"
  | "22023"
  | "23514";

export function sessionRosterWeekIdentity(inputDate: string) {
  const weekStart = weekStartForDate(inputDate);
  return {
    weekStart,
    halaqaSaturday: halaqaSaturdayForWeek(weekStart)
  };
}

export function defaultSessionRosterPlacement(students: SessionRosterDraftStudent[]) {
  return students
    .filter((student) => student.attendance_status === "attending")
    .map((student) => ({
      studentId: student.student_id,
      sessionGroupId: student.usual_group_id
    }));
}

export function publishedSessionRosterStudents(students: SessionRosterDraftStudent[]) {
  return students.filter(
    (student): student is SessionRosterDraftStudent & { session_group_id: string } =>
      student.attendance_status === "attending" && student.session_group_id !== null
  );
}

export function validateExactlyOncePlacement(students: SessionRosterDraftStudent[]) {
  const attending = students.filter((student) => student.attendance_status === "attending");
  const placed = publishedSessionRosterStudents(students);
  const seen = new Set<string>();

  for (const student of placed) {
    if (seen.has(student.student_id)) {
      return false;
    }
    seen.add(student.student_id);
  }

  return placed.length === attending.length && seen.size === attending.length;
}

export function sessionRosterHasOnlyWarningImbalance(readiness: SessionRosterReadiness) {
  return readiness.warning_codes.includes("group_imbalance")
    && readiness.blocker_codes.length === 0;
}
