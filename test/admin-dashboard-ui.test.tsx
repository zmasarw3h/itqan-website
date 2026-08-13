/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminDashboard, { dashboardRowsForFilter } from "@/app/admin/admin-dashboard";
import type { AdminDashboardStudentPreview } from "@/lib/admin-dashboard-preview";
import type { LeaderboardRow } from "@/lib/leaderboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/app/admin/dashboard-actions", () => ({
  loadSelectedStudentPreview: vi.fn(() => new Promise(() => {}))
}));

afterEach(cleanup);

function row(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    studentId: "student-1",
    studentName: "Yusuf Umarbayev",
    studentEmail: null,
    studentPhone: "+17775550101",
    masjidName: "Toronto Islamic Centre",
    cohortName: "Brothers",
    groupName: "Group 4",
    canViewCurrentContact: true,
    canOpenCurrentProfile: true,
    score: { daily_points: 300, partner_points: 75, halaqa_points: 0, total_points: 375, total_possible: 1000, percentage: 37.5 },
    status: "below_70_so_far",
    below70Streak: 1,
    ...overrides
  };
}

function preview(overrides: Partial<AdminDashboardStudentPreview> = {}): AdminDashboardStudentPreview {
  return {
    studentId: "student-1",
    studentName: "Yusuf Umarbayev",
    studentContact: "+17775550101",
    dailyPoints: 300,
    partnerPoints: 75,
    halaqaPoints: 0,
    percentage: 37.5,
    dueDays: 4,
    savedDays: 3,
    recentActivity: [
      { date: "2026-08-09", label: "Sunday, August 9", status: "saved", statusLabel: "Saved · 100%" },
      { date: "2026-08-10", label: "Monday, August 10", status: "missing", statusLabel: "Missing" }
    ],
    ...overrides
  };
}

describe("admin dashboard responsive states", () => {
  it("uses the approved four filter semantics over authorized rows", () => {
    const rows = [row(), row({ studentId: "student-2", score: { daily_points: 700, partner_points: 150, halaqa_points: 150, total_points: 1000, total_possible: 1000, percentage: 100 }, status: "passing", below70Streak: 0 }), row({ studentId: "student-3", score: { daily_points: 100, partner_points: 75, halaqa_points: 0, total_points: 175, total_possible: 1000, percentage: 17.5 }, below70Streak: 0 })];
    expect(dashboardRowsForFilter(rows, "all")).toHaveLength(3);
    expect(dashboardRowsForFilter(rows, "below70")).toHaveLength(2);
    expect(dashboardRowsForFilter(rows, "streaks")).toEqual([rows[0]]);
    expect(dashboardRowsForFilter(rows, "missing")).toEqual([]);
  });

  it("keeps the desktop dashboard mounted while selection updates the detail pane", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const second = row({ studentId: "student-2", studentName: "Second Student", rank: 2 });
    render(<AdminDashboard availableWeekStarts={["2026-08-09"]} exportHref="/admin/export?week=2026-08-09" initialPreview={preview()} rows={[row(), second]} selectedWeekLabel="Aug 9–15, 2026" selectedWeekStart="2026-08-09" />);
    fireEvent.click(screen.getByRole("button", { name: /Second Student/ }));
    expect(screen.getByRole("heading", { name: "Admin Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Second Student" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to dashboard" })).not.toBeInTheDocument();
  });

  it("opens the mobile selected-student state and exposes Back to dashboard", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<AdminDashboard availableWeekStarts={["2026-08-09"]} exportHref="/admin/export?week=2026-08-09" initialPreview={preview()} rows={[row()]} selectedWeekLabel="Aug 9–15, 2026" selectedWeekStart="2026-08-09" />);
    expect(screen.getByRole("heading", { name: "Admin Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yusuf Umarbayev/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Yusuf Umarbayev/ }));
    expect(screen.getByRole("button", { name: "Back to dashboard" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open student workspace/ })[0]).toHaveAttribute("href", "/admin/students/student-1");
    expect(screen.getAllByText("3 / 4")).not.toHaveLength(0);
    expect(screen.getAllByText("Missing")).not.toHaveLength(0);
  });

  it("disables Missing activity until an authoritative aggregate field exists", () => {
    render(<AdminDashboard availableWeekStarts={["2026-08-09"]} exportHref="#" initialPreview={preview()} rows={[row()]} selectedWeekLabel="Aug 9–15, 2026" selectedWeekStart="2026-08-09" />);
    expect(screen.getByRole("button", { name: "Missing activity (—)" })).toBeDisabled();
  });
});
