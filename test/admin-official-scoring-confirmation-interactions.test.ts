// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("@/app/admin/students/[id]/official-scoring/actions", () => ({ applyOfficialScoringStart: applyMock }));

import { OfficialScoringConfirmationForm } from "@/app/admin/students/[id]/official-scoring/submit-buttons";

const studentName = "Amina Student";

function renderForm() {
  render(createElement(OfficialScoringConfirmationForm, {
    studentId: "11111111-1111-4111-8111-111111111111",
    studentName,
    requestId: "22222222-2222-4222-8222-222222222222",
    scoreStartsOn: "2026-08-16",
    expectedScoreStartsOn: "2026-08-09",
    returnTo: "",
    returnWeek: "2026-08-09",
    returnView: "settings",
    cancelHref: "/admin/students/11111111-1111-4111-8111-111111111111?week=2026-08-09&view=settings"
  }));
  return {
    reason: screen.getByLabelText("Reason for change"),
    name: screen.getByLabelText(`Type ${studentName} to confirm`),
    submit: screen.getByRole("button", { name: "Confirm scoring change" })
  };
}

describe("official scoring confirmation readiness", () => {
  beforeEach(() => applyMock.mockReset());
  afterEach(cleanup);

  it.each([
    ["", studentName],
    ["no", studentName],
    ["     ", studentName],
    ["x".repeat(501), studentName],
    ["Valid reason", ""],
    ["Valid reason", "Amina"],
    ["Valid reason", "Wrong student"],
    ["Valid reason", "amina Student"]
  ])("stays disabled for reason %j and confirmation %j", (reasonValue, nameValue) => {
    const fields = renderForm();
    fireEvent.change(fields.reason, { target: { value: reasonValue } });
    fireEvent.change(fields.name, { target: { value: nameValue } });
    expect(fields.submit).toBeDisabled();
  });

  it("enables only for a valid trimmed reason and the exact live name", () => {
    const fields = renderForm();
    fireEvent.change(fields.reason, { target: { value: "  Valid reason  " } });
    expect(fields.submit).toBeDisabled();
    fireEvent.change(fields.name, { target: { value: studentName } });
    expect(fields.submit).toBeEnabled();
  });

  it("announces concise readiness feedback on blur rather than every keystroke", () => {
    const fields = renderForm();
    fireEvent.change(fields.reason, { target: { value: "no" } });
    expect(document.querySelector("[aria-live=polite]")).toHaveTextContent("");
    fireEvent.blur(fields.reason);
    expect(screen.getByText("Reason must contain 5 to 500 non-whitespace characters.")).toBeInTheDocument();
    fireEvent.change(fields.name, { target: { value: studentName } });
    fireEvent.blur(fields.name);
    expect(screen.getByText("Confirmation name matches.")).toBeInTheDocument();
  });

});
