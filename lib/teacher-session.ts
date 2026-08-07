export const TEACHER_SESSION_CONTRACT_VERSION = 1 as const;

export type TeacherSessionRecordState = "complete" | "in_progress" | "missing" | "partial";

export type TeacherSessionPublication = {
  version_id: string;
  version_number: number;
  source_draft_revision?: number;
  masjid_id?: string;
  cohort_id?: string;
  week_start: string;
  halaqa_saturday: string;
  published_by: string;
  published_at: string;
};

export type TeacherSessionAuthorizedScope = {
  masjid_id: string;
  masjid_name: string;
  cohort_id: string;
  cohort_name: string;
  cohort_kind: "brothers" | "sisters";
  week_start: string;
  halaqa_saturday: string;
  publication_version_id: string | null;
  publication_version_number: number | null;
  publication_published_at: string | null;
  publication_published_by: string | null;
  assigned_group_ids: string[];
};

export type TeacherSessionDashboardScope = Pick<
  TeacherSessionAuthorizedScope,
  "masjid_id" | "masjid_name" | "cohort_id" | "cohort_name" | "cohort_kind" | "week_start" | "halaqa_saturday"
> & {
  assigned_group_ids: string[];
};

export type TeacherSessionDashboardGroup = {
  group_id: string;
  group_name: string;
  group_sort_order: number;
  primary_teacher_id: string;
  primary_teacher_name: string;
  is_assigned_group: boolean;
  roster_count: number;
  weekly_plan_count: number;
  grade_progress: {
    graded_count: number;
    roster_count: number;
    remaining_count: number;
    complete: boolean;
  };
};

export type TeacherSessionDashboardResponse = {
  contract_version: typeof TEACHER_SESSION_CONTRACT_VERSION;
  scope: TeacherSessionDashboardScope;
  publication: TeacherSessionPublication | null;
  groups: TeacherSessionDashboardGroup[];
};

export type TeacherSessionGrade = {
  id: string;
  student_id: string;
  week_start: string;
  attended: boolean;
  attendance_points: number;
  recitation_points: number;
  notes: string | null;
  graded_by: string | null;
  graded_at: string;
  updated_at: string | null;
  masjid_id: string | null;
  cohort_id: string | null;
  halaqa_group_id: string | null;
  session_roster_version_id: string | null;
  session_roster_version_number: number | null;
  session_halaqa_saturday: string | null;
  session_group_id: string | null;
  session_group_name: string | null;
  session_primary_teacher_id: string | null;
  session_primary_teacher_name: string | null;
};

export type TeacherSessionGroupRosterStudent = {
  student_id: string;
  student_name: string;
  usual_group_id: string;
  usual_group_name: string;
  session_group_id: string;
  placement_order: number;
  weekly_plan_available: boolean;
  grade_is_current: boolean;
  grade: Pick<
    TeacherSessionGrade,
    | "id"
    | "attended"
    | "attendance_points"
    | "recitation_points"
    | "notes"
    | "graded_by"
    | "graded_at"
    | "updated_at"
    | "session_roster_version_id"
    | "session_group_id"
  > | null;
};

export type TeacherSessionGroupRosterResponse = {
  contract_version: typeof TEACHER_SESSION_CONTRACT_VERSION;
  publication: TeacherSessionPublication;
  group: {
    group_id: string;
    group_name: string;
    group_sort_order: number;
    primary_teacher_id: string;
    primary_teacher_name: string;
  };
  roster: TeacherSessionGroupRosterStudent[];
};

export type TeacherSessionStudentContextResponse = {
  contract_version: typeof TEACHER_SESSION_CONTRACT_VERSION;
  student: {
    student_id: string;
    student_name: string;
    usual_group_id: string;
    usual_group_name: string;
    session_group_id: string;
    placement_order: number;
  };
  group: TeacherSessionGroupRosterResponse["group"];
  publication: TeacherSessionPublication & {
    masjid_id: string;
    cohort_id: string;
  };
};

export type TeacherChecklistItem = {
  saved_item_label: string;
  completed: boolean;
  weight: number;
  earned_points: number;
};

export type TeacherChecklistDetailsResponse = {
  contract_version: typeof TEACHER_SESSION_CONTRACT_VERSION;
  checklist_date: string;
  tracker_week_start: string;
  record_state: TeacherSessionRecordState;
  stored_daily_totals: {
    earned_weight: number | null;
    total_weight: number | null;
    daily_score: number | null;
  } | null;
  items: TeacherChecklistItem[];
};

export type TeacherSessionRpcName =
  | "teacher_session_authorized_scopes"
  | "get_teacher_session_dashboard"
  | "get_teacher_session_group_roster"
  | "get_teacher_session_student_context"
  | "get_teacher_session_checklist_details"
  | "save_teacher_session_halaqa_grade";

export function classifyTeacherChecklistRecord(input: {
  hasRecord: boolean;
  storedCompleted: boolean;
  itemCount: number;
  completedItemCount: number;
}): TeacherSessionRecordState {
  if (!input.hasRecord) {
    return "missing";
  }

  if (!input.storedCompleted || input.itemCount === 0 || input.completedItemCount === 0) {
    return "in_progress";
  }

  return input.completedItemCount === input.itemCount ? "complete" : "partial";
}
