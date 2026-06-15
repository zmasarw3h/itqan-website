import type { Profile, WeeklyPlan } from "@/lib/types";
import { weekStartForDate } from "@/lib/dates";

export const WEEKLY_PLAN_BUCKET = "weekly-plans";
export const WEEKLY_PLAN_MAX_MB = 3;
export const WEEKLY_PLAN_MAX_BYTES = WEEKLY_PLAN_MAX_MB * 1024 * 1024;
export const WEEKLY_PLAN_MAX_SIZE_LABEL = `${WEEKLY_PLAN_MAX_MB} MB`;
export const WEEKLY_PLAN_ALLOWED_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;

export type WeeklyPlanAllowedType = (typeof WEEKLY_PLAN_ALLOWED_TYPES)[number];
export type WeeklyPlanUploadFile = {
  name: string;
  type: string;
  size: number;
};

export function isAllowedWeeklyPlanType(fileType: string): fileType is WeeklyPlanAllowedType {
  return WEEKLY_PLAN_ALLOWED_TYPES.includes(fileType as WeeklyPlanAllowedType);
}

export function validateWeeklyPlanFile(file: WeeklyPlanUploadFile | null) {
  if (!file || !file.name || file.size === 0) {
    return "Choose a weekly plan file.";
  }

  if (!isAllowedWeeklyPlanType(file.type)) {
    return "Upload a PNG, JPG, or PDF file.";
  }

  if (file.size > WEEKLY_PLAN_MAX_BYTES) {
    return `Weekly plan files must be ${WEEKLY_PLAN_MAX_SIZE_LABEL} or smaller.`;
  }

  return null;
}

export function safeWeeklyPlanFileName(fileName: string) {
  const trimmed = fileName.trim().replace(/\s+/g, "-").toLowerCase();
  const safe = trimmed.replace(/[^a-z0-9._-]/g, "");
  const withoutRepeats = safe.replace(/-+/g, "-").replace(/\.+/g, ".");

  return withoutRepeats.replace(/^\.+/, "").replace(/\.+$/, "") || "weekly-plan";
}

export function weeklyPlanStoragePath(studentId: string, weekStart: string, fileName: string) {
  return `${studentId}/${weekStart}/${safeWeeklyPlanFileName(fileName)}`;
}

export const WEEKLY_PLAN_GATE_COPY = {
  heading: "Upload this week's plan to unlock today's checklist",
  support: "Weekly plans are due at the start of the week. Upload this week's plan before continuing today's checklist.",
  weekLabel: "Required plan week",
  actionLabel: "Upload weekly plan"
};

export function weeklyPlanRequiredWeekStart(today: string) {
  return weekStartForDate(today);
}

export function weeklyPlanBlocksCheckIn(
  weeklyPlan: Pick<WeeklyPlan, "week_start"> | null | undefined,
  today: string
) {
  return weeklyPlan?.week_start !== weeklyPlanRequiredWeekStart(today);
}

export function routeIsWeeklyPlanGated(pathname: string) {
  return pathname === "/student/check-in";
}

export function canStudentManageWeeklyPlan(actor: Profile | null, studentId: string) {
  return Boolean(actor?.active && actor.role === "student" && actor.id === studentId);
}

export function canReadWeeklyPlan(actor: Profile | null, weeklyPlan: Pick<WeeklyPlan, "student_id"> | null) {
  if (!actor?.active || !weeklyPlan) {
    return false;
  }

  return actor.role === "admin" || actor.id === weeklyPlan.student_id;
}
