// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ correctCheckIn: vi.fn(), correctPartnerRecitations: vi.fn() }));

import CorrectionsSection from "@/app/admin/students/[id]/corrections-section";
import type { AdminStudentWorkspaceShell } from "@/lib/admin-student-workspace";
import type { CheckIn, CheckInItem, PartnerRecitation } from "@/lib/types";

const studentId = "11111111-1111-4111-8111-111111111111";
const weekStart = "2026-08-09";
const shell = {
  student: {
    id: studentId,
    name: "Student One",
    email: "student@example.com",
    phone: null,
    role: "student",
    active: true,
    score_starts_on: "2026-08-09",
    created_at: "2026-01-01T00:00:00Z"
  },
  selectedWeekStart: weekStart,
  currentTrackerWeekStart: weekStart,
  availableWeekStarts: [weekStart],
  scope: {} as AdminStudentWorkspaceShell["scope"]
} satisfies AdminStudentWorkspaceShell;
const checkins: CheckIn[] = [{
  id: "22222222-2222-4222-8222-222222222222",
  student_id: studentId,
  date: "2026-08-09",
  completed: true,
  note: "Stored Sunday",
  earned_weight: 20,
  total_weight: 100,
  daily_score: 20,
  submitted_at: "2026-08-09T12:00:00Z",
  updated_at: null,
  updated_by_admin: null
}];
const items: CheckInItem[] = [];
const recitations: PartnerRecitation[] = [{
  id: "33333333-3333-4333-8333-333333333333",
  student_id: studentId,
  week_start: weekStart,
  round: "round_1",
  points: 75,
  submitted_at: "2026-08-09T12:00:00Z"
}];

function section(status: string, correctionDate?: string) {
  return createElement(CorrectionsSection, {
    shell,
    effectiveDate: "2026-08-11",
    checkins,
    items,
    partnerRecitations: recitations,
    status,
    correctionDate
  });
}

function partnerData() {
  const form = document.querySelector<HTMLFormElement>("[data-correction-form=partner]")!;
  return new FormData(form);
}

describe("partner correction daily-date display context", () => {
  afterEach(cleanup);

  it("keeps Sunday through daily success and subsequent partner success with isolated notices", () => {
    const view = render(section("corrected", "2026-08-09"));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-09");
    expect(screen.getByText(/Daily correction saved/)).toBeInTheDocument();
    expect(screen.queryByText("Partner recitation correction saved.")).not.toBeInTheDocument();
    expect(partnerData().get("correction_date")).toBe("2026-08-09");
    expect(partnerData().get("note")).toBeNull();
    expect(partnerData().get("task_keys")).toBeNull();

    view.rerender(section("partner-corrected", "2026-08-09"));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-09");
    expect(screen.getByText("Partner recitation correction saved.")).toBeInTheDocument();
    expect(screen.queryByText(/Daily correction saved/)).not.toBeInTheDocument();
  });

  it("shares a selector change with only the partner display-context field", () => {
    const view = render(section("corrected", "2026-08-09"));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-10" } });
    expect(partnerData().get("correction_date")).toBe("2026-08-10");
    expect(partnerData().get("date")).toBeNull();
    expect(partnerData().get("status")).toBeNull();

    view.rerender(section("partner-corrected", "2026-08-10"));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-10");
    expect(screen.getByText("Partner recitation correction saved.")).toBeInTheDocument();
  });

  it.each(["not-a-date", "2026-08-08", "2026-08-12"])("falls back safely for forged context %s", (candidate) => {
    render(section("partner-corrected", candidate));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-11");
    expect(screen.getByText("Partner recitation correction saved.")).toBeInTheDocument();
    expect(screen.queryByText(/Daily correction saved/)).not.toBeInTheDocument();
  });
});
