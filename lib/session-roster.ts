import { halaqaSaturdayForWeek, weekStartForDate } from "@/lib/dates";

export const SESSION_ROSTER_CONTRACT_VERSION = 1 as const;
export const SESSION_ROSTER_WIZARD_CONTRACT_VERSION = 2 as const;

export type SessionRosterAttendanceStatus = "attending" | "unavailable";

export type SessionRosterBlockerCode =
  | "unplaced_attending_students"
  | "missing_primary_teacher_responsibility"
  | "no_available_teachers"
  | "session_group_count_mismatch"
  | "target_group_count_invalid"
  | "group_count_exceeds_available_teachers"
  | "group_count_mismatch_confirmation_required"
  | "student_availability_confirmation_required"
  | "teacher_availability_confirmation_required"
  | "requested_group_count_not_generated"
  | "duplicate_primary_teacher"
  | "teacher_group_mismatch_confirmation_required"
  | "source_changed"
  | "review_required"
  | "no_session_groups";

export type SessionRosterWarningCode = "group_imbalance";

export type SessionRosterGroup = {
  group_id: string;
  session_group_slot_id?: string | null;
  anchor_group_id?: string | null;
  group_name: string;
  group_sort_order: number;
  primary_teacher_id: string | null;
  primary_teacher_name: string | null;
  mismatch_confirmed?: boolean;
  mismatch_reason?: string | null;
};

export type SessionRosterDraftStudent = {
  student_id: string;
  student_name: string;
  attendance_status: SessionRosterAttendanceStatus;
  unavailable_reason: string | null;
  usual_group_id: string;
  usual_group_name: string;
  session_group_id: string | null;
  session_group_slot_id?: string | null;
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

export type SessionRosterWizardAvailabilityPrerequisite = {
  ready: boolean;
  confirmed: boolean;
  confirmed_at: string | null;
  confirmed_by: string | null;
  attending_count?: number;
  unavailable_count?: number;
  available_teacher_count?: number;
};

export type SessionRosterWizardPrerequisiteState = {
  students: SessionRosterWizardAvailabilityPrerequisite;
  teachers: SessionRosterWizardAvailabilityPrerequisite;
  groups: Record<string, unknown> & { ready: boolean };
  review: Record<string, unknown> & { ready: boolean };
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
  available_teacher_count?: number;
  teacher_count?: number;
  default_group_count?: number;
  requested_group_count?: number | null;
  actual_group_count?: number;
  derived_group_count?: number;
  group_count_mismatch?: boolean;
  group_count_mismatch_direction?: "none" | "fewer" | "more";
  group_count_mismatch_confirmation_required?: boolean;
  group_count_mismatch_confirmed?: boolean;
  actual_group_count_mismatch?: boolean;
  permanent_anchor_mismatch_confirmation_required?: boolean;
  permanent_anchor_mismatch_confirmed?: boolean;
  dependency_revision?: number;
  dependency_digest?: string | null;
  mismatch_confirmation_required?: boolean;
  mismatch_confirmed?: boolean;
  mismatch_groups?: Array<{
    group_id: string;
    group_name: string;
    anchor_group_id: string | null;
    primary_teacher_id: string | null;
    primary_teacher_name: string | null;
    reason: string | null;
    confirmed: boolean;
  }>;
  participating_teachers?: SessionRosterWizardParticipant[];
  imbalance_warning?: boolean;
  primary_responsibilities?: Array<Record<string, unknown>>;
  prerequisite_state?: SessionRosterWizardPrerequisiteState;
  recovery_guidance?: string | null;
  student_availability_confirmed?: boolean;
  student_availability_confirmed_at?: string | null;
  student_availability_confirmed_by?: string | null;
  teacher_availability_confirmed?: boolean;
  teacher_availability_confirmed_at?: string | null;
  teacher_availability_confirmed_by?: string | null;
};

export type SessionRosterDraftMetadata = {
  id: string;
  masjid_id: string;
  cohort_id: string;
  week_start: string;
  halaqa_saturday: string;
  revision_number: number;
  status: "draft" | "published" | "superseded";
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
  wizard_mode?: "legacy" | "teacher_driven";
  dependency_revision?: number;
  dependency_digest?: string | null;
  available_teacher_count?: number;
  derived_group_count?: number;
  wizard_prerequisite_state?: SessionRosterWizardPrerequisiteState;
  mismatch_confirmation_required?: boolean;
  mismatch_confirmed?: boolean;
  unplaced_count?: number;
  imbalance_warning?: boolean;
  primary_responsibilities?: Array<Record<string, unknown>>;
  recovery_guidance?: string | null;
};

export type SessionRosterDraftResponse = {
  contract_version: typeof SESSION_ROSTER_CONTRACT_VERSION;
  draft: SessionRosterDraftMetadata;
  groups: SessionRosterGroup[];
  students: SessionRosterDraftStudent[];
  roster: SessionRosterDraftRosterStudent[];
  readiness: SessionRosterReadiness;
};

export type SessionRosterWizardTeacher = {
  teacher_id: string;
  teacher_name: string;
  teacher_email: string | null;
  available: boolean;
  last_published_week_start: string | null;
  last_published_halaqa_saturday: string | null;
  last_published_group_name: string | null;
};

export type SessionRosterWizardParticipant = {
  teacher_id: string;
  teacher_name: string;
  teacher_email: string | null;
  available: boolean;
  participating: boolean;
  is_primary: boolean;
  primary_slot_id: string | null;
  primary_slot_name: string | null;
};

export type SessionRosterWizardReadiness = SessionRosterReadiness & {
  available_teacher_count: number;
  teacher_count: number;
  default_group_count: number;
  requested_group_count: number | null;
  actual_group_count: number;
  derived_group_count: number;
  group_count_mismatch: boolean;
  group_count_mismatch_direction: "none" | "fewer" | "more";
  group_count_mismatch_confirmation_required: boolean;
  group_count_mismatch_confirmed: boolean;
  actual_group_count_mismatch: boolean;
  permanent_anchor_mismatch_confirmation_required: boolean;
  permanent_anchor_mismatch_confirmed: boolean;
  dependency_revision: number;
  dependency_digest: string | null;
  mismatch_confirmation_required: boolean;
  mismatch_confirmed: boolean;
  imbalance_warning: boolean;
  primary_responsibilities: Array<Record<string, unknown>>;
  prerequisite_state: SessionRosterWizardPrerequisiteState;
  recovery_guidance: string | null;
  student_availability_confirmed: boolean;
  student_availability_confirmed_at: string | null;
  student_availability_confirmed_by: string | null;
  teacher_availability_confirmed: boolean;
  teacher_availability_confirmed_at: string | null;
  teacher_availability_confirmed_by: string | null;
};

export type SessionRosterWizardDraftResponse = {
  contract_version: typeof SESSION_ROSTER_WIZARD_CONTRACT_VERSION;
  draft: SessionRosterDraftMetadata & {
    wizard_mode: "teacher_driven";
    dependency_revision: number;
    dependency_digest: string | null;
    available_teacher_count: number;
    default_group_count: number;
    requested_group_count: number | null;
    actual_group_count: number;
    derived_group_count: number;
    group_count_mismatch_confirmed: boolean;
    wizard_prerequisite_state: SessionRosterWizardPrerequisiteState;
    mismatch_confirmation_required: boolean;
    mismatch_confirmed: boolean;
    unplaced_count: number;
    imbalance_warning: boolean;
    primary_responsibilities: Array<Record<string, unknown>>;
    recovery_guidance: string | null;
  };
  teachers: SessionRosterWizardTeacher[];
  participants: SessionRosterWizardParticipant[];
  groups: Array<SessionRosterGroup & {
    session_group_slot_id: string;
    anchor_group_id: string | null;
    mismatch_confirmed: boolean;
    mismatch_reason: string | null;
  }>;
  students: Array<SessionRosterDraftStudent & { session_group_slot_id: string | null }>;
  roster: Array<SessionRosterDraftRosterStudent & { session_group_slot_id: string }>;
  readiness: SessionRosterWizardReadiness;
};

export type SessionRosterManualEditKind =
  | "student_placement"
  | "primary_teacher_responsibility";

export type RefreshSessionRosterDraftInput = {
  request_id: string;
  actor_id: string;
  cohort_id: string;
  week_start: string;
  draft_id: string;
  expected_state_version: number;
  expected_source_state_digest: string;
  expected_published_version_id: string | null;
  /** Must be true because a refresh intentionally discards stale manual edits. */
  confirm_discard_changes: true;
};

export type RefreshSessionRosterDraftSummary = {
  superseded_draft_id: string;
  superseded_state_version: number;
  refreshed_draft_id: string;
  refreshed_state_version: number;
  discarded_manual_edits: true;
  discarded_manual_edit_kinds: SessionRosterManualEditKind[];
  requires_review: true;
  published_version_unchanged: true;
  published_version_id: string | null;
  source_state_digest: string;
};

export type RefreshSessionRosterDraftResponse = SessionRosterDraftResponse & {
  refresh: RefreshSessionRosterDraftSummary;
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
  session_group_slot_id?: string | null;
  placement_order: number;
};

export type SessionRosterPublishedResponse = {
  contract_version: typeof SESSION_ROSTER_CONTRACT_VERSION;
  version: SessionRosterPublishedVersion | null;
  groups: SessionRosterGroup[];
  roster: SessionRosterPublishedStudent[];
};

export type SessionRosterWizardPublishedResponse = {
  contract_version: typeof SESSION_ROSTER_WIZARD_CONTRACT_VERSION;
  version: SessionRosterPublishedVersion;
  groups: Array<SessionRosterGroup & {
    session_group_slot_id: string;
    anchor_group_id: string | null;
    mismatch_confirmed: boolean;
    mismatch_reason: string | null;
  }>;
  roster: Array<SessionRosterPublishedStudent & { session_group_slot_id: string }>;
  participants: SessionRosterWizardParticipant[];
};

export type SessionRosterWizardLegacyTransitionSummary = {
  legacy_draft_id: string;
  legacy_draft_state_version: number;
  legacy_draft_source_state_digest: string;
  new_draft_id: string;
  new_draft_revision_number: number;
  discarded_legacy_rows: {
    draft_students: number;
    draft_groups: number;
    rows_preserved: true;
    draft_marked_superseded: true;
  };
  published_version_id: string | null;
  published_version_unchanged: true;
  permanent_memberships_changed: false;
  teacher_assignments_changed: false;
  grades_changed: false;
  plans_changed: false;
};

export type SessionRosterWizardLegacyTransitionResponse = SessionRosterWizardDraftResponse & {
  legacy_transition: SessionRosterWizardLegacyTransitionSummary;
};

export type SessionRosterWizardLegacyTransitionPreviewResponse = {
  contract_version: typeof SESSION_ROSTER_WIZARD_CONTRACT_VERSION;
  masjid_id: string;
  cohort_id: string;
  week_start: string;
  blocking_legacy_draft: {
    id: string;
    revision_number: number;
    state_version: number;
    source_state_digest: string;
    status: "draft";
    created_at: string;
    updated_at: string;
  } | null;
  current_published_version: {
    id: string;
    version_number: number;
    published_by: string;
    published_at: string;
  } | null;
  can_transition: boolean;
  recovery: {
    code: string;
    message: string;
    confirm_discard_legacy_draft?: true;
    published_version_unchanged?: true;
  };
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
    | "revision_created"
    | "draft_refreshed"
    | "source_dependency_changed"
    | "participant_snapshot_recorded"
    | "legacy_draft_transition";
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
  | "refresh_session_roster_draft"
  | "get_session_roster_draft"
  | "move_session_roster_student"
  | "assign_session_roster_primary_teacher"
  | "compute_session_roster_readiness"
  | "review_session_roster_draft"
  | "publish_session_roster_draft"
  | "create_session_roster_revision"
  | "load_or_create_session_roster_wizard_draft"
  | "generate_session_roster_wizard_groups"
  | "generate_session_roster_wizard_groups_v2"
  | "move_session_roster_wizard_student"
  | "assign_session_roster_wizard_primary_teacher"
  | "review_session_roster_wizard_draft"
  | "publish_session_roster_wizard_draft"
  | "publish_session_roster_wizard_draft_v2"
  | "create_session_roster_wizard_revision"
  | "preview_session_roster_wizard_legacy_transition"
  | "transition_session_roster_wizard_legacy_draft"
  | "get_current_session_roster"
  | "get_session_roster_history";

export type SessionRosterRpcErrorCode =
  | "PT409"
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
