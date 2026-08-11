import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

import {
  loadAdminDashboardAvailableWeeks,
  loadAdminDashboardLeaderboardForWeek
} from "@/lib/admin-dashboard";

const studentId = "11111111-1111-4111-8111-111111111111";

function dashboardAggregate(overrides: Record<string, unknown> = {}) {
  return {
    student_id: studentId,
    student_name: "Student One",
    student_email: "student@example.com",
    student_phone: null,
    masjid_name: "Masjid One",
    cohort_name: "Brothers",
    group_name: "Group One",
    can_view_current_contact: true,
    can_open_current_profile: true,
    score_starts_on: "2026-06-07",
    daily_points: 500,
    partner_points: 75,
    halaqa_points: 100,
    total_points: 675,
    percentage: 67.5,
    below70_streak: 2,
    ...overrides
  };
}

function makeFakeSupabase() {
  const rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const range = vi.fn(() => {
    throw new Error("The bounded admin contract must not use client-side pagination.");
  });
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });

    const data = name === "admin_dashboard_available_weeks"
      ? ["2026-08-09", "2026-06-07"]
      : {
        selected_week_start: "2026-06-07",
        rows: [dashboardAggregate()]
      };

    return {
      range,
      returns: vi.fn(async () => ({ data, error: null }))
    };
  });

  return { supabase: { rpc }, rpc, rpcCalls, range };
}

describe("bounded admin reporting contracts", () => {
  it("keeps dashboard and workspace loaders free of raw client-side history pagination", () => {
    const dashboardLoader = readFileSync("app/admin/leaderboard/data.ts", "utf8");
    const workspaceLoader = readFileSync("lib/admin-student-workspace.ts", "utf8");
    const availableWeeksHelper = workspaceLoader.slice(
      workspaceLoader.indexOf("async function loadAvailableWeekStarts"),
      workspaceLoader.indexOf("/**\n * Shared, server-side gate")
    );

    expect(dashboardLoader).toContain("loadAdminDashboardAvailableWeeks");
    expect(dashboardLoader).toContain("loadAdminDashboardLeaderboardForWeek");
    expect(dashboardLoader).not.toContain("loadHistoricalReportingActivityForWeeks");
    expect(dashboardLoader).not.toContain("loadAllSupabasePages");
    expect(dashboardLoader).not.toContain(".range(");
    expect(availableWeeksHelper).toContain("loadAdminStudentAvailableWeekStarts");
    expect(availableWeeksHelper).not.toContain("Promise.all");
    expect(availableWeeksHelper).not.toContain('.from("checkins")');
    expect(availableWeeksHelper).not.toContain('.from("partner_recitations")');
    expect(availableWeeksHelper).not.toContain('.from("halaqa_grades")');
    expect(availableWeeksHelper).not.toContain('.from("weekly_plans")');
  });

  it("loads the dashboard week list without PostgREST page ranges", async () => {
    const fake = makeFakeSupabase();

    await expect(loadAdminDashboardAvailableWeeks(fake.supabase as never)).resolves.toEqual([
      "2026-08-09",
      "2026-06-07"
    ]);
    expect(fake.rpcCalls).toEqual([{ name: "admin_dashboard_available_weeks", args: undefined }]);
    expect(fake.range).not.toHaveBeenCalled();
  });

  it("returns one aggregated leaderboard payload and never fetches raw 500-row pages", async () => {
    const fake = makeFakeSupabase();

    await expect(
      loadAdminDashboardLeaderboardForWeek(fake.supabase as never, "2026-06-07", true)
    ).resolves.toEqual([dashboardAggregate()]);
    expect(fake.rpcCalls).toEqual([{
      name: "admin_dashboard_leaderboard_for_week",
      args: {
        input_selected_week_start: "2026-06-07",
        input_below70_only: true
      }
    }]);
    expect(fake.range).not.toHaveBeenCalled();
  });
});
