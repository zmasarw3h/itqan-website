import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HalaqaGradeForm from "@/app/admin/students/[id]/halaqa-grade-form";
import WeeklyPlanPanel from "@/app/admin/students/[id]/weekly-plan-panel";
import {
  clampWeeklyPlanZoom,
  formatWeeklyPlanFileSize,
  halaqaGradeDraftSummary,
  weeklyPlanPinchZoom,
  weeklyPlanPreviewKind
} from "@/lib/admin-student-halaqa-plan";
import type { HalaqaGrade, WeeklyPlan } from "@/lib/types";

vi.mock("@/app/admin/actions", () => ({ saveHalaqaGrade: vi.fn() }));

const studentId = "11111111-1111-4111-8111-111111111111";
const weekStart = "2026-08-09";

const yesGrade: HalaqaGrade = {
  id: "22222222-2222-4222-8222-222222222222",
  student_id: studentId,
  week_start: weekStart,
  attended: true,
  attendance_points: 100,
  recitation_points: 40,
  notes: "Strong preparation and steady recitation.",
  graded_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  graded_at: "2026-08-15T16:00:00.000Z",
  updated_at: null
};

const plan: WeeklyPlan = {
  id: "33333333-3333-4333-8333-333333333333",
  student_id: studentId,
  week_start: weekStart,
  file_path: `${studentId}/${weekStart}/student-weekly-plan.pdf`,
  file_name: "student-weekly-plan.pdf",
  file_type: "application/pdf",
  file_size: 1_258_291,
  uploaded_at: "2026-08-09T16:00:00.000Z"
};

describe("admin Halaqa & plan models and initial UI", () => {
  it("keeps the No state at zero and removes the recitation input", () => {
    expect(halaqaGradeDraftSummary(false, "50")).toEqual({
      attendancePoints: 0,
      recitationPoints: 0,
      totalPoints: 0,
      valid: true
    });

    const markup = renderToStaticMarkup(createElement(HalaqaGradeForm, {
      studentId,
      weekStart,
      grade: null,
      redirectView: "halaqa-plan"
    }));
    expect(markup).toContain("No attendance or recitation points will be awarded.");
    expect(markup).toContain("0 / 100");
    expect(markup).toContain("0 / 50");
    expect(markup).toContain("0 / 150");
    expect(markup).not.toContain('name="recitation_points"');
    expect(markup).not.toContain('disabled="" value="50"');
  });

  it("shows the required Yes-state field, stored feedback, and live score values", () => {
    expect(halaqaGradeDraftSummary(true, "40")).toEqual({
      attendancePoints: 100,
      recitationPoints: 40,
      totalPoints: 140,
      valid: true
    });
    expect(halaqaGradeDraftSummary(true, "9").valid).toBe(false);
    expect(halaqaGradeDraftSummary(true, "50.5").valid).toBe(false);

    const markup = renderToStaticMarkup(createElement(HalaqaGradeForm, {
      studentId,
      weekStart,
      grade: yesGrade,
      redirectView: "halaqa-plan"
    }));
    expect(markup).toContain('name="recitation_points"');
    expect(markup).toContain('min="10"');
    expect(markup).toContain('max="50"');
    expect(markup).toContain('value="40"');
    expect(markup).toContain("100 / 100");
    expect(markup).toContain("40 / 50");
    expect(markup).toContain("140 / 150");
    expect(markup).toContain("Strong preparation and steady recitation.");
  });

  it("renders a read-only uploaded plan with separate view and download actions", () => {
    const markup = renderToStaticMarkup(createElement(WeeklyPlanPanel, {
      plan,
      previewUrl: `/admin/students/${studentId}/weekly-plan/preview?week=${weekStart}`,
      downloadUrl: `/admin/students/${studentId}/weekly-plan/download?week=${weekStart}`
    }));
    expect(markup).toContain("student-weekly-plan.pdf");
    expect(markup).toContain("PDF · 1.2 MB");
    expect(markup).toContain("View plan");
    expect(markup).toContain("Download");
    expect(markup).toContain("Read-only");
    expect(markup).not.toMatch(/>Upload<|Replace|Approve|Comment/);
  });

  it("renders the selected-week empty plan state without mutation controls", () => {
    const markup = renderToStaticMarkup(createElement(WeeklyPlanPanel, {
      plan: null,
      previewUrl: null,
      downloadUrl: null
    }));
    expect(markup).toContain("No plan uploaded for this week.");
    expect(markup).toContain("Students upload their own weekly plans.");
    expect(markup).not.toMatch(/View plan|Download|Upload/);
  });

  it("classifies supported previews, preserves unsupported fallback, and clamps zoom", () => {
    expect(weeklyPlanPreviewKind("application/pdf")).toBe("pdf");
    expect(weeklyPlanPreviewKind("image/png")).toBe("image");
    expect(weeklyPlanPreviewKind("image/jpeg")).toBe("image");
    expect(weeklyPlanPreviewKind("text/plain")).toBe("unsupported");
    expect(formatWeeklyPlanFileSize(1_258_291)).toBe("1.2 MB");
    expect(clampWeeklyPlanZoom(20)).toBe(50);
    expect(clampWeeklyPlanZoom(137)).toBe(135);
    expect(clampWeeklyPlanZoom(260)).toBe(200);
    expect(weeklyPlanPinchZoom(100, 100, 150)).toBe(150);
    expect(weeklyPlanPinchZoom(175, 100, 200)).toBe(200);
    expect(weeklyPlanPinchZoom(75, 100, 20)).toBe(50);
    expect(weeklyPlanPinchZoom(125, 0, 200)).toBe(125);
  });
});
