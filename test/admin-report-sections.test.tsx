/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BadgeReport, WeeklyReport } from "@/app/admin/reports/report-sections";
import type { MonthlyBadgeLeaderboardRow, RewardBadgeAward } from "@/lib/rewards";
import type { WeeklyFollowUpReport, WeeklyFollowUpRow } from "@/lib/weekly-incentives";

afterEach(cleanup);

function followUpRow(overrides: Partial<WeeklyFollowUpRow> = {}): WeeklyFollowUpRow {
  return {
    studentId: "student-1",
    studentName: "Yusuf Umarbayev",
    studentEmail: null,
    studentPhone: null,
    canViewCurrentContact: true,
    canOpenCurrentProfile: true,
    masjidName: "Toronto Islamic Centre",
    cohortName: "Brothers",
    groupName: "Group 4",
    weekStart: "2026-08-02",
    weeklyPercentage: 62,
    below70Streak: 3,
    badgesAwarded: 0,
    accountabilityAmountCents: 999,
    requiredSadaqaCents: 425,
    ...overrides
  };
}

function weeklyReport(rows: WeeklyFollowUpRow[]): WeeklyFollowUpReport {
  return {
    selectedWeekStart: "2026-08-02",
    selectedWeekLabel: "Aug 2–8, 2026",
    below70ThisWeek: rows,
    pendingSadaqaRows: rows,
    below70ThreePlusWeeks: rows,
    rows
  };
}

function award(id: string, weekStart: string, count: number): RewardBadgeAward {
  return {
    id,
    student_id: "student-1",
    week_start: weekStart,
    weekly_percentage: 90 + count,
    badges_awarded: count,
    created_at: `${weekStart}T00:00:00.000Z`
  };
}

function badgeRow(recentAwards: RewardBadgeAward[]): MonthlyBadgeLeaderboardRow {
  return {
    rank: 1,
    studentId: "student-1",
    studentName: "Yusuf Umarbayev",
    studentEmail: null,
    studentPhone: null,
    canViewCurrentContact: true,
    canOpenCurrentProfile: true,
    monthBadges: 7,
    lifetimeBadges: 12,
    recentAwards
  };
}

describe("admin report responsive sections", () => {
  it("renders grouped mobile follow-up rows and uses the stored sadaqa obligation", () => {
    const row = followUpRow();
    render(<WeeklyReport pendingCount={1} report={weeklyReport([row])} rows={[row]} threePlusCount={1} view="pending" />);

    const studentLink = screen.getByRole("link", { name: /Yusuf Umarbayev/ });
    expect(studentLink).toHaveClass("block", "min-h-24");
    expect(within(studentLink).getByText("Weekly score")).toBeInTheDocument();
    expect(within(studentLink).getByText("Below-70 streak")).toBeInTheDocument();
    expect(within(studentLink).getByText("Required sadaqa")).toBeInTheDocument();
    expect(within(studentLink).getByText("$4.25")).toBeInTheDocument();
    expect(within(studentLink).queryByText("$9.99")).not.toBeInTheDocument();
  });

  it.each([
    ["zero", [], []],
    ["one", [award("award-1", "2026-08-02", 1)], ["Aug 2–8, 2026", "1 badge"]],
    ["multiple", [award("award-2", "2026-08-09", 3), award("award-1", "2026-08-02", 1)], ["Aug 9–15, 2026", "3 badges", "Aug 2–8, 2026", "1 badge"]]
  ])("renders %s recent badge awards", (_label, awards, expected) => {
    render(<BadgeReport month="2026-08-01" rows={[badgeRow(awards as RewardBadgeAward[])]} />);
    const renderedAwards = screen.queryAllByTestId("recent-award");
    expect(renderedAwards).toHaveLength((awards as RewardBadgeAward[]).length);
    if (renderedAwards.length) {
      expect(renderedAwards[0].parentElement).toHaveClass("col-span-2");
      expect(renderedAwards[0]).toHaveClass("min-h-11");
    }
    const renderedText = renderedAwards.map((element) => element.textContent).join(" ");
    for (const text of expected as string[]) expect(renderedText).toContain(text);
    if (!(awards as RewardBadgeAward[]).length) expect(screen.getByText("No awards yet")).toBeInTheDocument();
  });
});
