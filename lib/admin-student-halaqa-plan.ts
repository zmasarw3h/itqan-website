import type { WeeklyPlan } from "@/lib/types";

export type WeeklyPlanPreviewKind = "image" | "pdf" | "unsupported";

export const WEEKLY_PLAN_MIN_ZOOM = 50;
export const WEEKLY_PLAN_MAX_ZOOM = 200;

export function adminStudentHalaqaPlanContextKey(studentId: string, weekStart: string) {
  return `${studentId}:${weekStart}`;
}

export function clampWeeklyPlanZoom(value: number) {
  return Math.min(WEEKLY_PLAN_MAX_ZOOM, Math.max(WEEKLY_PLAN_MIN_ZOOM, Math.round(value / 5) * 5));
}

export function weeklyPlanPinchZoom(startZoom: number, startDistance: number, currentDistance: number) {
  if (!Number.isFinite(startDistance) || startDistance <= 0 || !Number.isFinite(currentDistance)) {
    return clampWeeklyPlanZoom(startZoom);
  }
  return clampWeeklyPlanZoom(startZoom * currentDistance / startDistance);
}

export function halaqaGradeDraftSummary(attended: boolean, recitationPointsValue: string) {
  if (!attended) {
    return {
      attendancePoints: 0,
      recitationPoints: 0,
      totalPoints: 0,
      valid: true
    };
  }

  const recitationPoints = Number(recitationPointsValue);
  const valid = recitationPointsValue.trim() !== ""
    && Number.isInteger(recitationPoints)
    && recitationPoints >= 10
    && recitationPoints <= 50;

  return {
    attendancePoints: 100,
    recitationPoints: Number.isFinite(recitationPoints) ? recitationPoints : 0,
    totalPoints: 100 + (Number.isFinite(recitationPoints) ? recitationPoints : 0),
    valid
  };
}

export function weeklyPlanPreviewKind(fileType: string): WeeklyPlanPreviewKind {
  if (fileType === "application/pdf") return "pdf";
  if (["image/png", "image/jpeg"].includes(fileType)) return "image";
  return "unsupported";
}

export function weeklyPlanTypeLabel(fileType: string) {
  if (fileType === "application/pdf") return "PDF";
  if (fileType === "image/png") return "PNG";
  if (fileType === "image/jpeg") return "JPEG";
  return "File";
}

export function formatWeeklyPlanFileSize(fileSize: number) {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return null;
  if (fileSize < 1024) return `${Math.round(fileSize)} B`;
  if (fileSize < 1024 * 1024) return `${Math.round(fileSize / 1024)} KB`;
  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function weeklyPlanSummary(plan: Pick<WeeklyPlan, "file_type" | "file_size"> | null) {
  if (!plan) return "Not uploaded";
  return [weeklyPlanTypeLabel(plan.file_type), formatWeeklyPlanFileSize(plan.file_size)]
    .filter(Boolean)
    .join(" · ");
}
