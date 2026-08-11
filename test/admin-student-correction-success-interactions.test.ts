// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ correctCheckIn: vi.fn() }));

import CorrectionForm, { type CorrectionFormCheckIn } from "@/app/admin/students/[id]/correction-form";

const studentId = "11111111-1111-4111-8111-111111111111";
const weekStart = "2026-08-09";
const existing: CorrectionFormCheckIn[] = [{
  date: "2026-08-09",
  status: "submitted",
  note: "Canonical stored Sunday note",
  completedTaskKeys: ["fajr"]
}];

function formElement(resultStatus: string, initialDate = "2026-08-09") {
  return createElement(CorrectionForm, {
    studentId,
    initialDate,
    availableDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
    redirectWeek: weekStart,
    redirectView: "corrections",
    existingCheckIns: existing,
    resultStatus
  });
}

describe("daily correction redirect state", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it("shows canonical stored state after success and clears a stale draft", async () => {
    const key = `itqan:v1:admin-daily-correction:${studentId}:${weekStart}`;
    sessionStorage.setItem(key, JSON.stringify({ selectedDate: "2026-08-11", status: "missing", note: "Stale draft", completedTaskKeys: [] }));
    render(formElement("corrected"));

    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-09");
    expect(screen.getByLabelText("Status")).toHaveValue("submitted");
    expect(screen.getByLabelText("Student note")).toHaveValue("Canonical stored Sunday note");
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  });

  it("keeps correction error draft restoration working", async () => {
    sessionStorage.setItem(`itqan:v1:admin-daily-correction:${studentId}:${weekStart}`, JSON.stringify({
      selectedDate: "2026-08-10",
      status: "missing",
      note: "Retryable draft",
      completedTaskKeys: []
    }));
    render(formElement("correction-error", "2026-08-11"));

    await waitFor(() => expect(screen.getByLabelText("Date")).toHaveValue("2026-08-10"));
    expect(screen.getByLabelText("Status")).toHaveValue("missing");
    expect(screen.getByLabelText("Student note")).toHaveValue("Retryable draft");
  });
});
