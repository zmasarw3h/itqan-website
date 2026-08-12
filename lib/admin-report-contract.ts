import { addDays } from "@/lib/dates";
import type { WeeklyIncentiveReport, WeeklyIncentiveScoreRow } from "@/lib/weekly-incentives";

export type WeeklyFollowUpRow = WeeklyIncentiveScoreRow & {
  below70Streak: number;
};

export type WeeklyFollowUpContract = WeeklyIncentiveReport & {
  pendingAccountabilityRows?: WeeklyIncentiveScoreRow[];
  below70ThreePlusWeeks?: WeeklyIncentiveScoreRow[];
};

export type WeeklyFollowUpContractExtras = {
  pendingAccountabilityRows?: WeeklyIncentiveScoreRow[];
  below70ThreePlusWeeks?: WeeklyIncentiveScoreRow[];
};

export function adaptWeeklyFollowUpContract(
  report: WeeklyIncentiveReport,
  extras: WeeklyFollowUpContractExtras
): WeeklyFollowUpContract {
  return {
    ...report,
    pendingAccountabilityRows: extras.pendingAccountabilityRows,
    below70ThreePlusWeeks: extras.below70ThreePlusWeeks
  };
}

function streakFor(row: WeeklyIncentiveScoreRow, report: WeeklyIncentiveReport) {
  const contractedStreak = (row as WeeklyIncentiveScoreRow & { below70Streak?: number }).below70Streak;
  if (typeof contractedStreak === "number") return contractedStreak;
  const byWeek = new Map(report.rows.filter((candidate) => candidate.studentId === row.studentId).map((candidate) => [candidate.weekStart, candidate]));
  let streak = 0;
  let week = report.selectedWeekStart;
  while (byWeek.get(week)?.weeklyPercentage !== undefined && (byWeek.get(week)?.weeklyPercentage ?? 100) < 70) {
    streak += 1;
    week = addDays(week, -7);
  }
  return streak;
}

export function weeklyFollowUpRows(report: WeeklyFollowUpContract, view: "below70" | "pending" | "three-plus") {
  const source = view === "pending"
    ? report.pendingAccountabilityRows ?? []
    : view === "three-plus"
      ? report.below70ThreePlusWeeks ?? report.below70ThisWeek.filter((row) => streakFor(row, report) >= 3)
      : report.below70ThisWeek;
  return source.map((row) => ({ ...row, below70Streak: streakFor(row, report) }));
}
