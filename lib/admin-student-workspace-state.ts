import { isValidDateString, weekStartForDate } from "@/lib/dates";

export const ADMIN_STUDENT_WORKSPACE_VIEWS = [
  "overview",
  "activity",
  "halaqa-plan",
  "corrections",
  "settings"
] as const;

export type AdminStudentWorkspaceView = (typeof ADMIN_STUDENT_WORKSPACE_VIEWS)[number];

export const ADMIN_STUDENT_WORKSPACE_SECTIONS: ReadonlyArray<{
  value: AdminStudentWorkspaceView;
  label: string;
}> = [
  { value: "overview", label: "Overview" },
  { value: "activity", label: "Weekly activity" },
  { value: "halaqa-plan", label: "Halaqa & plan" },
  { value: "corrections", label: "Corrections" },
  { value: "settings", label: "Student settings" }
];

export function isAdminStudentWorkspaceView(value: string | null | undefined): value is AdminStudentWorkspaceView {
  return ADMIN_STUDENT_WORKSPACE_VIEWS.includes(value as AdminStudentWorkspaceView);
}

export function normalizeAdminStudentWorkspaceView(value: string | null | undefined): AdminStudentWorkspaceView {
  return isAdminStudentWorkspaceView(value) ? value : "overview";
}

export function adminStudentWorkspaceHref(input: {
  studentId: string;
  weekStart: string;
  view?: string | null;
  status?: string | null;
}) {
  const params = new URLSearchParams({
    week: input.weekStart,
    view: normalizeAdminStudentWorkspaceView(input.view)
  });

  if (input.status) params.set("status", input.status);

  return `/admin/students/${encodeURIComponent(input.studentId)}?${params.toString()}`;
}

export function canonicalAdminStudentWorkspaceState(input: {
  week?: string;
  view?: string;
  currentWeekStart: string;
}) {
  const weekStart = input.week
    && isValidDateString(input.week)
    && weekStartForDate(input.week) === input.week
    ? input.week
    : input.currentWeekStart;
  const view = normalizeAdminStudentWorkspaceView(input.view);

  return {
    weekStart,
    view,
    shouldRedirect: input.week !== weekStart || input.view !== view
  };
}
