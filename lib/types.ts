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
  submitted_at: string;
  updated_at: string | null;
  updated_by_admin: string | null;
};

export type CompletionStatus = "completed" | "missing";

export type CompletionRow = {
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  date: string;
  completed: boolean;
  status: CompletionStatus;
  checkin: CheckIn | null;
};

export type DashboardFilters = {
  studentId?: string;
  date?: string;
  status?: CompletionStatus;
};
