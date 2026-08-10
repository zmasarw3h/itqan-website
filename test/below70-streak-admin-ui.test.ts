import { describe, expect, it } from "vitest";
import {
  below70ResetErrorMessage,
  below70ResetSuccessMessage,
  below70StreakAdminStatus,
  createBelow70ResetAttempt,
  validateBelow70ResetForm
} from "@/lib/below70-streak-admin-ui";

describe("below-70 streak reset admin UI", () => {
  it("does not offer a reset before three completed below-70 weeks", () => {
    expect(below70StreakAdminStatus(0)).toMatchObject({ canReset: false });
    expect(below70StreakAdminStatus(2)).toMatchObject({
      canReset: false,
      description: "A reset becomes available after 3 consecutive completed weeks below 70%."
    });
  });

  it("offers a reset at three or more completed below-70 weeks", () => {
    expect(below70StreakAdminStatus(3)).toMatchObject({ canReset: true });
    expect(below70StreakAdminStatus(6)).toMatchObject({ canReset: true });
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
    expect(below70ResetErrorMessage("ineligible")).toContain("status has been refreshed");
    expect(below70ResetErrorMessage("error")).toContain("safely retry");
  });
});
