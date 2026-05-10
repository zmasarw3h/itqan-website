export type Role = "student" | "admin";

export type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  created_at?: string;
};

export type CheckIn = {
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

export type CompletionStatus = "submitted" | "missing";

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
  status?: CompletionStatus;
};
