import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  adminStudentWorkspaceHref,
  isAdminStudentWorkspaceView,
  normalizeAdminStudentWorkspaceView
} from "@/lib/admin-student-workspace";

describe("admin student workspace URL contract", () => {
  it("allows only the five approved sections and defaults invalid values to overview", () => {
    expect(isAdminStudentWorkspaceView("overview")).toBe(true);
    expect(isAdminStudentWorkspaceView("halaqa-plan")).toBe(true);
    expect(isAdminStudentWorkspaceView("not-a-section")).toBe(false);
    expect(normalizeAdminStudentWorkspaceView(undefined)).toBe("overview");
    expect(normalizeAdminStudentWorkspaceView("not-a-section")).toBe("overview");
  });

  it("keeps the canonical week, section, and mutation status together", () => {
    expect(adminStudentWorkspaceHref({
      studentId: "student/with-slash",
      weekStart: "2026-07-19",
      view: "corrections",
      status: "corrected"
    })).toBe(
      "/admin/students/student%2Fwith-slash?week=2026-07-19&view=corrections&status=corrected"
    );
  });
});
