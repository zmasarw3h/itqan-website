export type Role = "student" | "teacher" | "admin" | "super_admin";
export type CohortKind = "brothers" | "sisters";
export type StaffRole = "admin" | "teacher";

export type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  created_at?: string;
};

export type Masjid = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: string;
  updated_at: string | null;
};

export type Cohort = {
  id: string;
  masjid_id: string;
  kind: CohortKind;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
};

export type HalaqaGroup = {
  id: string;
  cohort_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
};

export type StudentGroupMembership = {
  id: string;
  student_id: string;
  group_id: string;
  starts_on: string;
  ends_on: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type MasjidStaffMembership = {
  id: string;
  profile_id: string;
  masjid_id: string;
  staff_role: StaffRole;
  active: boolean;
  starts_on: string;
  ends_on: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type GroupTeacherAssignment = {
  id: string;
  group_id: string;
  teacher_id: string;
  week_start: string;
  active: boolean;
  assigned_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ScopedStudentRecord = {
  masjid_id?: string | null;
  cohort_id?: string | null;
  halaqa_group_id?: string | null;
};

export type CheckIn = ScopedStudentRecord & {
  id: string;
  student_id: string;
  date: string;
  completed: boolean;
  note: string | null;
  earned_weight: number | null;
  total_weight: number | null;
  daily_score: number | null;
  submitted_at: string;
  updated_at: string | null;
  updated_by_admin: string | null;
};

export type CheckInItem = {
  id: string;
  checkin_id: string;
  student_id: string;
  date: string;
  task_key: string;
  task_label: string;
  weight: number;
  completed: boolean;
  created_at: string;
};

export type WeeklyPlan = ScopedStudentRecord & {
  id: string;
  student_id: string;
  week_start: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
};

export type PartnerRound = "round_1" | "round_2";

export type PartnerRecitation = ScopedStudentRecord & {
  id: string;
  student_id: string;
  week_start: string;
  round: PartnerRound;
  points: number;
  submitted_at: string;
};

export type HalaqaGrade = ScopedStudentRecord & {
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
};

export type WeeklyIncentiveRun = {
  id: string;
  masjid_id?: string | null;
  week_start: string;
  processed_at: string;
  processed_by: string | null;
  created_at: string;
};

export type AccountabilityObligationStatus = "pending" | "attested_paid" | "waived";

export type AccountabilityObligation = ScopedStudentRecord & {
  id: string;
  student_id: string;
  week_start: string;
  weekly_percentage: number;
  amount_cents: number;
  status: AccountabilityObligationStatus;
  attested_paid_at: string | null;
  waived_at: string | null;
  waived_by: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string | null;
};

export type BadgeAward = ScopedStudentRecord & {
  id: string;
  student_id: string;
  week_start: string;
  weekly_percentage: number;
  badges_awarded: number;
  created_at: string;
};

export type CompletionStatus = "submitted" | "missing" | "upcoming";

export type CompletionRow = {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  date: string;
  completed: boolean;
  status: CompletionStatus;
  checkin: CheckIn | null;
  items: CheckInItem[];
};

export type DashboardFilters = {
  studentId?: string;
  date?: string;
  weekStart?: string;
  status?: CompletionStatus;
};
