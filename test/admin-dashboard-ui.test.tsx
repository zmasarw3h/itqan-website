/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminDashboard, { dashboardRowsForFilter } from "@/app/admin/admin-dashboard";
import type { LeaderboardRow } from "@/lib/leaderboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

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

describe("admin dashboard responsive states", () => {
  it("uses the approved four filter semantics over authorized rows", () => {
    const rows = [row(), row({ studentId: "student-2", score: { daily_points: 700, partner_points: 150, halaqa_points: 150, total_points: 1000, total_possible: 1000, percentage: 100 }, status: "passing", below70Streak: 0 }), row({ studentId: "student-3", score: { daily_points: 0, partner_points: 0, halaqa_points: 0, total_points: 0, total_possible: 1000, percentage: 0 }, below70Streak: 0 })];
    expect(dashboardRowsForFilter(rows, "all")).toHaveLength(3);
    expect(dashboardRowsForFilter(rows, "below70")).toHaveLength(2);
    expect(dashboardRowsForFilter(rows, "streaks")).toEqual([rows[0]]);
    expect(dashboardRowsForFilter(rows, "missing")).toEqual([rows[2]]);
  });

  it("opens the mobile selected-student state and exposes Back to dashboard", () => {
    render(<AdminDashboard availableWeekStarts={["2026-08-09"]} exportHref="/admin/export?week=2026-08-09" rows={[row()]} selectedWeekLabel="Aug 9–15, 2026" selectedWeekStart="2026-08-09" />);
    expect(screen.getByRole("heading", { name: "Admin Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yusuf Umarbayev/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Yusuf Umarbayev/ }));
    expect(screen.getByRole("button", { name: "Back to dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open student workspace/ })).toHaveAttribute("href", "/admin/students/student-1");
  });
});
