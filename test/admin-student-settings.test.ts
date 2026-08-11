import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/actions", () => ({ deleteStudent: vi.fn() }));

import StudentSettingsSection, { officialScoringSettingsHref } from "@/app/admin/students/[id]/student-settings-section";
import type { AdminStudentSettingsData, AdminStudentWorkspaceShell } from "@/lib/admin-student-workspace";
import { officialScoringStatus } from "@/lib/official-scoring";

const shell = {
  student: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Student One",
    email: "student@example.com",
    phone: null,
    role: "student",
    active: true,
    score_starts_on: "2026-01-04",
    created_at: "2025-12-01T00:00:00Z"
  },
  selectedWeekStart: "2026-08-09",
  currentTrackerWeekStart: "2026-08-09",
  availableWeekStarts: ["2026-08-09"],
  scope: {} as AdminStudentWorkspaceShell["scope"]
} satisfies AdminStudentWorkspaceShell;

function markup(input: Partial<AdminStudentSettingsData> = {}) {
  const settings: AdminStudentSettingsData = {
    canDeleteStudent: true,
    scoreStartsOn: "2026-01-04",
    scoringStatus: officialScoringStatus("2026-01-04", shell.currentTrackerWeekStart),
    ...input
  };
  return renderToStaticMarkup(createElement(StudentSettingsSection, { settings, shell }));
}

describe("admin student settings presentation", () => {
  it("preserves the canonical week and settings return view in the scoring route", () => {
    expect(officialScoringSettingsHref(shell.student.id, shell.selectedWeekStart)).toBe(
      `/admin/students/${shell.student.id}/official-scoring?return_week=2026-08-09&return_view=settings`
    );
    expect(markup()).toContain("return_week=2026-08-09&amp;return_view=settings");
  });

  it("shows the live scoring summary and authorized delete workflow", () => {
    const html = markup();
    expect(html).toContain("Scoring eligibility");
    expect(html).toContain("January 4, 2026");
    expect(html).toContain("Danger zone");
    expect(html).toContain("Delete student");
  });

  it("does not expose deletion when the scoped capability is false", () => {
    const html = markup({ canDeleteStudent: false });
    expect(html).not.toContain("Danger zone");
    expect(html).not.toContain("Delete student");
  });

  it("renders the legacy boundary truthfully without exposing it as a date", () => {
    const html = markup({
      scoreStartsOn: "1900-01-07",
      scoringStatus: officialScoringStatus("1900-01-07", shell.currentTrackerWeekStart)
    });
    expect(html).toContain("Legacy value — review required");
    expect(html).not.toContain("1900-01-07");
  });
});
