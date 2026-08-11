// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HalaqaGradeForm from "@/app/admin/students/[id]/halaqa-grade-form";
import HalaqaPlanSection from "@/app/admin/students/[id]/halaqa-plan-section";
import type { HalaqaGrade, WeeklyPlan } from "@/lib/types";

vi.mock("@/app/admin/actions", () => ({ saveHalaqaGrade: vi.fn() }));

const studentA = "11111111-1111-4111-8111-111111111111";
const studentB = "44444444-4444-4444-8444-444444444444";
const weekA = "2026-08-09";
const weekB = "2026-08-16";

const gradeA: HalaqaGrade = {
  id: "22222222-2222-4222-8222-222222222222",
  student_id: studentA,
  week_start: weekA,
  attended: true,
  attendance_points: 100,
  recitation_points: 40,
  notes: "Week A saved feedback",
  graded_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  graded_at: "2026-08-15T16:00:00.000Z",
  updated_at: null
};

const planA: WeeklyPlan = {
  id: "33333333-3333-4333-8333-333333333333",
  student_id: studentA,
  week_start: weekA,
  file_path: `${studentA}/${weekA}/week-a.png`,
  file_name: "week-a.png",
  file_type: "image/png",
  file_size: 2048,
  uploaded_at: "2026-08-09T16:00:00.000Z"
};

function sectionElement({
  studentId,
  weekStart,
  grade,
  plan,
  status
}: {
  studentId: string;
  weekStart: string;
  grade: HalaqaGrade | null;
  plan: WeeklyPlan | null;
  status?: string;
}) {
  const previewRoot = `/admin/students/${studentId}/weekly-plan`;
  return createElement(HalaqaPlanSection, {
    studentId,
    weekStart,
    grade,
    plan,
    planPreviewUrl: plan ? `${previewRoot}/preview?week=${weekStart}` : null,
    planDownloadUrl: plan ? `${previewRoot}/download?week=${weekStart}` : null,
    status
  });
}

function formElement(status: string, key = status) {
  return createElement(HalaqaGradeForm, {
    key,
    studentId: studentA,
    weekStart: weekA,
    grade: gradeA,
    redirectView: "halaqa-plan",
    resultStatus: status
  });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin Halaqa & plan client state transitions", () => {
  it("remounts the whole task surface for week and student context changes", () => {
    const { rerender } = render(sectionElement({
      studentId: studentA,
      weekStart: weekA,
      grade: gradeA,
      plan: planA,
      status: "grade-saved"
    }));

    fireEvent.change(screen.getByRole("spinbutton", { name: /recitation points/i }), { target: { value: "45" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Unsaved Week A draft" } });
    fireEvent.click(screen.getByRole("button", { name: "View plan" }));
    expect(screen.getByRole("dialog", { name: "week-a.png" })).toBeTruthy();
    expect(screen.getAllByText("145 / 150").length).toBeGreaterThan(0);

    rerender(sectionElement({
      studentId: studentA,
      weekStart: weekB,
      grade: null,
      plan: null
    }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /recitation points/i })).toBeNull();
    expect(screen.queryByDisplayValue("Unsaved Week A draft")).toBeNull();
    expect(screen.queryByText("Halaqa grade saved.")).toBeNull();
    expect(screen.getByText("No plan uploaded for this week.")).toBeTruthy();
    expect(screen.getByText("Not saved yet")).toBeTruthy();
    expect(screen.getAllByText("0 / 150").length).toBeGreaterThan(0);

    const weekBForm = document.querySelector<HTMLFormElement>("[data-halaqa-grade-form]")!;
    const weekBData = new FormData(weekBForm);
    expect(weekBData.get("student_id")).toBe(studentA);
    expect(weekBData.get("week_start")).toBe(weekB);
    expect(weekBData.get("recitation_points")).toBeNull();
    expect(weekBData.get("notes")).toBe("");

    const studentBGrade = {
      ...gradeA,
      id: "55555555-5555-4555-8555-555555555555",
      student_id: studentB,
      week_start: weekB,
      recitation_points: 20,
      notes: "Student B feedback"
    };
    rerender(sectionElement({
      studentId: studentB,
      weekStart: weekB,
      grade: studentBGrade,
      plan: null,
      status: "grade-error"
    }));

    expect(screen.getByRole("spinbutton", { name: /recitation points/i })).toHaveValue(20);
    expect(screen.getByRole("textbox", { name: "Feedback" })).toHaveValue("Student B feedback");
    expect(screen.queryByDisplayValue("Unsaved Week A draft")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to save the halaqa grade");
    const studentBData = new FormData(document.querySelector<HTMLFormElement>("[data-halaqa-grade-form]")!);
    expect(studentBData.get("student_id")).toBe(studentB);
    expect(studentBData.get("week_start")).toBe(weekB);
  });

  it("keeps restored drafts isolated by student and week", async () => {
    sessionStorage.setItem(
      `itqan:v1:admin-halaqa-grade:${studentA}:${weekA}`,
      JSON.stringify({ attended: true, recitationPoints: "19", notes: "Week A retry draft" })
    );
    const { rerender } = render(sectionElement({
      studentId: studentA,
      weekStart: weekA,
      grade: gradeA,
      plan: null,
      status: "grade-error"
    }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Feedback" })).toHaveValue("Week A retry draft"));

    rerender(sectionElement({
      studentId: studentA,
      weekStart: weekB,
      grade: null,
      plan: null,
      status: "grade-error"
    }));
    expect(screen.getByRole("textbox", { name: "Feedback" })).toHaveValue("");
    expect(screen.queryByDisplayValue("Week A retry draft")).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /recitation points/i })).toBeNull();

    rerender(sectionElement({
      studentId: studentB,
      weekStart: weekB,
      grade: null,
      plan: null,
      status: "grade-error"
    }));
    expect(screen.getByRole("textbox", { name: "Feedback" })).toHaveValue("");
    expect(screen.queryByDisplayValue("Week A retry draft")).toBeNull();
  });

  it.each([
    ["attendance", () => fireEvent.click(screen.getByRole("radio", { name: "No" }))],
    ["recitation points", () => fireEvent.change(screen.getByRole("spinbutton", { name: /recitation points/i }), { target: { value: "42" } })],
    ["feedback", () => fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Edited feedback" } })]
  ])("dismisses saved feedback after an explicit %s edit", (_field, edit) => {
    render(formElement("grade-saved"));
    expect(screen.getByRole("status")).toHaveTextContent("Halaqa grade saved.");

    edit();

    expect(screen.queryByText("Halaqa grade saved.")).toBeNull();
    expect(screen.getByText("Unsaved changes", { exact: true })).toHaveAttribute("role", "status");
  });

  it.each([
    ["grade-invalid", "Enter a whole-number recitation score from 10 to 50."],
    ["grade-error", "Unable to save the halaqa grade. Your draft has been restored; try again."]
  ])("keeps restored %s feedback until the next user edit", async (status, message) => {
    sessionStorage.setItem(
      `itqan:v1:admin-halaqa-grade:${studentA}:${weekA}`,
      JSON.stringify({ attended: true, recitationPoints: "17", notes: "Restored retry draft" })
    );
    render(formElement(status));

    await waitFor(() => expect(screen.getByRole("spinbutton", { name: /recitation points/i })).toHaveValue(17));
    expect(screen.getByRole("textbox", { name: "Feedback" })).toHaveValue("Restored retry draft");
    expect(screen.getByRole("alert")).toHaveTextContent(message);

    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Retry draft edited" } });

    expect(screen.queryByText(message)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  });

  it("initializes new feedback when the result-status prop changes", () => {
    const { rerender } = render(formElement("grade-saved", "result-grade-saved"));
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Edited after save" } });
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");

    rerender(formElement("grade-error", "result-grade-error"));

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to save the halaqa grade");
    expect(within(document.querySelector<HTMLFormElement>("[data-halaqa-grade-form]")!).queryByText("Unsaved changes")).toBeNull();
  });
});
