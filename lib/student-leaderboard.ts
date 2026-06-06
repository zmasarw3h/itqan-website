import { leaderboardStatusLabel, type LeaderboardRow } from "@/lib/leaderboard";

export type StudentLeaderboardRow = {
  rank: number;
  previousRank: number | null;
  rankChange: number | null;
  studentName: string;
  scorePercentage: number;
  totalPoints: number;
  statusLabel: string;
  isCurrentStudent: boolean;
};

export function buildStudentLeaderboardRows(input: {
  currentRows: LeaderboardRow[];
  previousRows: LeaderboardRow[];
  currentStudentId: string;
}) {
  const previousRankByStudent = new Map(input.previousRows.map((row) => [row.studentId, row.rank]));

  return input.currentRows.map<StudentLeaderboardRow>((row) => {
    const previousRank = previousRankByStudent.get(row.studentId) ?? null;

    return {
      rank: row.rank,
      previousRank,
      rankChange: previousRank === null ? null : previousRank - row.rank,
      studentName: row.studentName,
      scorePercentage: row.score.percentage,
      totalPoints: row.score.total_points,
      statusLabel: leaderboardStatusLabel(row.status),
      isCurrentStudent: row.studentId === input.currentStudentId
    };
  });
}

export function studentRankChangeLabel(rankChange: number | null) {
  if (rankChange === null) {
    return "New";
  }

  if (rankChange > 0) {
    return `Up ${rankChange}`;
  }

  if (rankChange < 0) {
    return `Down ${Math.abs(rankChange)}`;
  }

  return "Same";
}

export function studentRankChangeSymbol(rankChange: number | null) {
  if (rankChange === null) {
    return "New";
  }

  if (rankChange > 0) {
    return `+${rankChange}`;
  }

  if (rankChange < 0) {
    return String(rankChange);
  }

  return "-";
}
