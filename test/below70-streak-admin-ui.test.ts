import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/admin/actions", () => ({ resetStudentBelow70Streak: vi.fn() }));

import Below70StreakReset from "@/app/admin/students/[id]/below70-streak-reset";
import type { Below70StreakReadRow } from "@/lib/below70-streak";
import {
  below70ResetErrorMessage,
  below70ResetSuccessMessage,
  below70StreakAdminStatus,
  createBelow70ResetAttempt,
  validateBelow70ResetForm
} from "@/lib/below70-streak-admin-ui";

function streak(streakLength: number): Below70StreakReadRow {
  return {
    student_id: "00000000-0000-4000-8000-000000000001",
    active_streak_length: streakLength,
    streak_through_week_start: "2026-08-02",
    latest_reset_id: null,
    latest_reset_masjid_id: null,
    latest_reset_cohort_id: null,
    latest_reset_group_id: null,
    latest_reset_effective_through_week_start: null,
    latest_reset_previous_streak_length: null,
    latest_reset_passed_test_confirmation: null,
    latest_reset_admin_note: null,
    latest_reset_actor_id: null,
    latest_reset_created_at: null
  };
}

function renderStreakCard(streakLength: number) {
  return renderToStaticMarkup(React.createElement(Below70StreakReset, {
    initialLoadError: false,
    initialStreak: streak(streakLength),
    studentId: "00000000-0000-4000-8000-000000000001"
  }));
}

describe("below-70 streak reset admin UI", () => {
  it("does not offer a reset at zero completed below-70 weeks", () => {
    expect(below70StreakAdminStatus(0)).toMatchObject({ canReset: false });
  });

  it("offers a reset for every positive completed below-70 streak", () => {
    expect(below70StreakAdminStatus(1)).toMatchObject({ canReset: true });
    expect(below70StreakAdminStatus(2)).toMatchObject({ canReset: true });
    expect(below70StreakAdminStatus(3)).toMatchObject({ canReset: true });
    expect(below70StreakAdminStatus(6)).toMatchObject({ canReset: true });
    expect(below70StreakAdminStatus(3).description).toContain("intervention and test trigger");
  });

  it("renders the actual card action only for positive streaks", () => {
    expect(renderStreakCard(0)).not.toContain("Reset streak");
    expect(renderStreakCard(1)).toContain("Reset streak");
    expect(renderStreakCard(2)).toContain("Reset streak");
    expect(renderStreakCard(3)).toContain("Reset streak");
    expect(renderStreakCard(3)).toContain("intervention and test trigger");
  });

  it("requires passed-test confirmation and validates the note contract", () => {
    expect(validateBelow70ResetForm({ passedTest: false, note: "Passed" })).toMatchObject({ valid: false });
    expect(validateBelow70ResetForm({ passedTest: true, note: "x".repeat(281) })).toMatchObject({ valid: false });
    expect(validateBelow70ResetForm({ passedTest: true, note: "bad\u0007note" })).toMatchObject({ valid: false });
    expect(validateBelow70ResetForm({ passedTest: true, note: "  Passed after review  " })).toEqual({
      valid: true,
      note: "Passed after review"
    });
  });

  it("keeps one request ID for retries and creates a new one only after completion or a new action", () => {
    const ids = ["request-1", "request-2", "request-3"];
    const attempt = createBelow70ResetAttempt(() => ids.shift() ?? "unexpected");

    expect(attempt.requestIdForSubmission()).toBe("request-1");
    expect(attempt.requestIdForSubmission()).toBe("request-1");
    attempt.complete();
    expect(attempt.requestIdForSubmission()).toBe("request-2");
    attempt.resetForNewAction();
    expect(attempt.requestIdForSubmission()).toBe("request-3");
  });

  it("uses clear success, idempotent replay, stale eligibility, and server-error messages", () => {
    expect(below70ResetSuccessMessage("reset")).toContain("Historical grades remain unchanged");
    expect(below70ResetSuccessMessage("replayed")).toContain("already recorded");
    expect(below70ResetErrorMessage("ineligible")).toContain("positive below-70% streak");
    expect(below70ResetErrorMessage("error")).toContain("safely retry");
  });
});
