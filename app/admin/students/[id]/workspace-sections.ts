import type { AdminStudentWorkspaceView } from "@/lib/admin-student-workspace";

export const WORKSPACE_SECTIONS: Array<{ value: AdminStudentWorkspaceView; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "activity", label: "Weekly activity" },
  { value: "halaqa-plan", label: "Halaqa & plan" },
  { value: "corrections", label: "Corrections" },
  { value: "settings", label: "Student settings" }
];
