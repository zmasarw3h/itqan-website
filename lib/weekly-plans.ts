import type { Profile, WeeklyPlan } from "@/lib/types";
import { checkInEffectiveDateString, isValidDateString, weekStartForDate } from "@/lib/dates";

export const WEEKLY_PLAN_BUCKET = "weekly-plans";
export const WEEKLY_PLAN_MAX_MB = 3;
export const WEEKLY_PLAN_MAX_BYTES = WEEKLY_PLAN_MAX_MB * 1024 * 1024;
export const WEEKLY_PLAN_MAX_SIZE_LABEL = `${WEEKLY_PLAN_MAX_MB} MB`;
export const WEEKLY_PLAN_ALLOWED_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;

const WEEKLY_PLAN_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WeeklyPlanContext = {
  effectiveDate: string;
  weekStart: string;
};

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

/**
 * Generates a never-overwritten candidate object path for a replacement.
 * Legacy metadata paths remain valid; new uploads add a UUID only to the
 * object name so the visible file name stays in weekly_plans.file_name.
 */
export function weeklyPlanReplacementStoragePath(
  studentId: string,
  weekStart: string,
  fileName: string,
  replacementId: string
) {
  if (!WEEKLY_PLAN_UUID_PATTERN.test(replacementId)) {
    throw new Error("Weekly-plan replacement ids must be UUIDs.");
  }

  return `${studentId}/${weekStart}/${replacementId}-${safeWeeklyPlanFileName(fileName)}`;
}

export function weeklyPlanPathBelongsToStudent(studentId: string, weekStart: string, filePath: string) {
  return filePath.startsWith(`${studentId}/${weekStart}/`) && !filePath.includes("..");
}

/**
 * Accepts both the original exact filename path and the UUID-prefixed paths
 * created by non-destructive replacements. The caller must still provide the
 * stored metadata filename so a substituted object cannot pass validation.
 */
export function weeklyPlanPathMatchesExactContext(
  studentId: string,
  weekStart: string,
  filePath: string,
  fileName?: string
) {
  if (
    !WEEKLY_PLAN_UUID_PATTERN.test(studentId)
    || !isValidDateString(weekStart)
    || weekStartForDate(weekStart) !== weekStart
    || !filePath.startsWith(`${studentId}/${weekStart}/`)
    || filePath.includes("..")
  ) {
    return false;
  }

  const parts = filePath.split("/");
  if (parts.length !== 3 || parts[0] !== studentId || parts[1] !== weekStart || !parts[2]) {
    return false;
  }

  const pathFileName = parts[2];
  if (pathFileName !== safeWeeklyPlanFileName(pathFileName)) {
    return false;
  }

  if (fileName === undefined) {
    return true;
  }

  const safeFileName = safeWeeklyPlanFileName(fileName);
  if (filePath === weeklyPlanStoragePath(studentId, weekStart, fileName)) {
    return true;
  }

  const replacementSuffix = `-${safeFileName}`;
  if (!pathFileName.endsWith(replacementSuffix)) {
    return false;
  }

  return WEEKLY_PLAN_UUID_PATTERN.test(pathFileName.slice(0, -replacementSuffix.length));
}

export const WEEKLY_PLAN_GATE_COPY = {
  heading: "Upload this week's plan to unlock today's checklist",
  support: "Weekly plans are due at the start of the week. Upload this week's plan before continuing today's checklist.",
  weekLabel: "Required plan week",
  actionLabel: "Upload weekly plan"
};

/**
 * Returns the one date/week snapshot used by checklist and weekly-plan flows.
 * The week must follow the reset-aware checklist date, not the Toronto civil date.
 */
export function currentWeeklyPlanContext(now = new Date()): WeeklyPlanContext {
  const effectiveDate = checkInEffectiveDateString(now);

  return {
    effectiveDate,
    weekStart: weeklyPlanRequiredWeekStart(effectiveDate)
  };
}

export function weeklyPlanRequiredWeekStart(effectiveDate: string) {
  return weekStartForDate(effectiveDate);
}

export function weeklyPlanBlocksCheckIn(
  weeklyPlan: Pick<WeeklyPlan, "week_start"> | null | undefined,
  effectiveDate: string
) {
  return weeklyPlan?.week_start !== weeklyPlanRequiredWeekStart(effectiveDate);
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
