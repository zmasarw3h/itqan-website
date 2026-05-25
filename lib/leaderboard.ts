import { addDays, weekDatesFromStart } from "@/lib/dates";
import { calculateWeeklyScore, type WeeklyScore } from "@/lib/scoring";
import type { CheckIn, HalaqaGrade, PartnerRecitation, Profile } from "@/lib/types";

export const PASSING_PERCENTAGE = 70;

export type LeaderboardRow = {
  rank: number;
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  score: WeeklyScore;
  status: "passing" | "below_70" | "in_progress" | "below_70_so_far";
  below70Streak: number;
};

type Student = Pick<Profile, "id" | "name" | "email" | "phone">;

function escapeCsv(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;

  if (/[",\n\r]/.test(safeText)) {
    return `"${safeText.replaceAll("\"", "\"\"")}"`;
  }

  return safeText;
}

export function weekIsComplete(weekStart: string, today: string) {
  return addDays(weekStart, 6) < today;
}

export function calculateWeekScoreForStudent(input: {
  weekStart: string;
  checkins: Pick<CheckIn, "student_id" | "date" | "daily_score">[];
  partnerRecitations: Pick<PartnerRecitation, "student_id" | "round" | "points">[];
  halaqaGrade: Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null;
}) {
  const weekDates = weekDatesFromStart(input.weekStart);
  const dailyScoreByDate = new Map(input.checkins.map((checkin) => [checkin.date, checkin.daily_score]));

  return calculateWeeklyScore({
    dailyScores: weekDates.map((date) => dailyScoreByDate.get(date) ?? 0),
    partnerRecitations: input.partnerRecitations,
    halaqaGrade: input.halaqaGrade
  });
}

export function calculateBelow70Streak(input: {
  completedWeekStartsDescending: string[];
  checkinsByWeek: ReadonlyMap<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>;
  partnerRecitationsByWeek: ReadonlyMap<string, Pick<PartnerRecitation, "student_id" | "round" | "points">[]>;
  halaqaGradeByWeek: ReadonlyMap<
    string,
    Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
  >;
}) {
  let streak = 0;

  for (const weekStart of input.completedWeekStartsDescending) {
    const score = calculateWeekScoreForStudent({
      weekStart,
      checkins: input.checkinsByWeek.get(weekStart) ?? [],
      partnerRecitations: input.partnerRecitationsByWeek.get(weekStart) ?? [],
      halaqaGrade: input.halaqaGradeByWeek.get(weekStart) ?? null
    });

    if (score.percentage >= PASSING_PERCENTAGE) {
      break;
    }

    streak += 1;
  }

  return streak;
}

export function buildLeaderboardRows(input: {
  students: Student[];
  selectedWeekStart: string;
  today: string;
  below70Only: boolean;
  completedWeekStartsDescending: string[];
  selectedWeekCheckinsByStudent: ReadonlyMap<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>;
  selectedWeekPartnerRecitationsByStudent: ReadonlyMap<
    string,
    Pick<PartnerRecitation, "student_id" | "round" | "points">[]
  >;
  selectedWeekHalaqaGradeByStudent: ReadonlyMap<
    string,
    Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
  >;
  streakDataByStudent: ReadonlyMap<
    string,
    {
      checkinsByWeek: ReadonlyMap<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>;
      partnerRecitationsByWeek: ReadonlyMap<string, Pick<PartnerRecitation, "student_id" | "round" | "points">[]>;
      halaqaGradeByWeek: ReadonlyMap<
        string,
        Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
      >;
    }
  >;
}) {
  const selectedWeekComplete = weekIsComplete(input.selectedWeekStart, input.today);
  const rows = input.students.map<LeaderboardRow>((student) => {
    const score = calculateWeekScoreForStudent({
      weekStart: input.selectedWeekStart,
      checkins: input.selectedWeekCheckinsByStudent.get(student.id) ?? [],
      partnerRecitations: input.selectedWeekPartnerRecitationsByStudent.get(student.id) ?? [],
      halaqaGrade: input.selectedWeekHalaqaGradeByStudent.get(student.id) ?? null
    });
    const streakData = input.streakDataByStudent.get(student.id);
    const below70Streak = streakData
      ? calculateBelow70Streak({
          completedWeekStartsDescending: input.completedWeekStartsDescending,
          ...streakData
        })
      : 0;
    const belowThreshold = score.percentage < PASSING_PERCENTAGE;

    return {
      rank: 0,
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      studentPhone: student.phone,
      score,
      status: selectedWeekComplete
        ? belowThreshold
          ? "below_70"
          : "passing"
        : belowThreshold
          ? "below_70_so_far"
          : "in_progress",
      below70Streak
    };
  });
  const visibleRows = input.below70Only ? rows.filter((row) => row.score.percentage < PASSING_PERCENTAGE) : rows;

  visibleRows.sort((a, b) => {
    if (input.below70Only) {
      return b.below70Streak - a.below70Streak || a.score.percentage - b.score.percentage || a.studentName.localeCompare(b.studentName);
    }

    return b.score.percentage - a.score.percentage || a.studentName.localeCompare(b.studentName);
  });

  return visibleRows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function leaderboardStatusLabel(status: LeaderboardRow["status"]) {
  if (status === "passing") return "Passing";
  if (status === "below_70") return "Below 70%";
  if (status === "below_70_so_far") return "Below 70% so far";
  return "In progress";
}

export function leaderboardRowsToCsv(rows: LeaderboardRow[]) {
  const columns = [
    "rank",
    "student name",
    "student phone",
    "student email",
    "weekly percentage",
    "status",
    "below_70_streak",
    "daily points",
    "partner points",
    "halaqa points",
    "total points"
  ];
  const lines = [
    columns.join(","),
    ...rows.map((row) =>
      [
        row.rank,
        row.studentName,
        row.studentPhone,
        row.studentEmail,
        row.score.percentage,
        leaderboardStatusLabel(row.status),
        row.below70Streak,
        row.score.daily_points,
        row.score.partner_points,
        row.score.halaqa_points,
        row.score.total_points
      ]
        .map(escapeCsv)
        .join(",")
    )
  ];

  return `${lines.join("\n")}\n`;
}
