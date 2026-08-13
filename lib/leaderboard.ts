import { addDays, weekDatesFromStart } from "@/lib/dates";
import { accountabilityAppliesToWeek } from "@/lib/incentives";
import {
  calculateDailyScoreProgress,
  calculateWeeklyScore,
  type WeeklyScore
} from "@/lib/scoring";
import type { CheckIn, HalaqaGrade, PartnerRecitation } from "@/lib/types";

export const PASSING_PERCENTAGE = 70;

export type LeaderboardRow = {
  rank: number;
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  studentPhone: string | null;
  masjidName: string;
  cohortName: string;
  groupName: string;
  canViewCurrentContact: boolean;
  canOpenCurrentProfile: boolean;
  score: WeeklyScore;
  dueDays: number;
  submittedDays: number;
  missingDueDays: number;
  status: "passing" | "below_70" | "in_progress" | "below_70_so_far";
  below70Streak: number;
};

type Student = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  masjidName: string;
  cohortName: string;
  groupName: string;
  canViewCurrentContact: boolean;
  canOpenCurrentProfile: boolean;
};

export type LeaderboardAggregate = {
  student_id: string;
  student_name: string;
  student_email: string | null;
  student_phone: string | null;
  masjid_name: string;
  cohort_name: string;
  group_name: string;
  can_view_current_contact: boolean;
  can_open_current_profile: boolean;
  score_starts_on: string | null;
  daily_points: number;
  partner_points: number;
  halaqa_points: number;
  total_points: number;
  percentage: number;
  below70_streak: number;
  due_days: number;
  submitted_days: number;
  missing_due_days: number;
};

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
  minimumWeekStart?: string | null;
  resetEffectiveThroughWeekStart?: string | null;
  eligibleWeekStarts?: ReadonlySet<string>;
  checkinsByWeek: ReadonlyMap<string, Pick<CheckIn, "student_id" | "date" | "daily_score">[]>;
  partnerRecitationsByWeek: ReadonlyMap<string, Pick<PartnerRecitation, "student_id" | "round" | "points">[]>;
  halaqaGradeByWeek: ReadonlyMap<
    string,
    Pick<HalaqaGrade, "student_id" | "attendance_points" | "recitation_points"> | null
  >;
}) {
  if (!input.minimumWeekStart) {
    return 0;
  }

  let streak = 0;

  for (const weekStart of input.completedWeekStartsDescending) {
    if (input.eligibleWeekStarts && !input.eligibleWeekStarts.has(weekStart)) {
      break;
    }

    if (weekStart < input.minimumWeekStart) {
      break;
    }

    if (input.resetEffectiveThroughWeekStart && weekStart <= input.resetEffectiveThroughWeekStart) {
      break;
    }

    if (!accountabilityAppliesToWeek(weekStart)) {
      break;
    }

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
      eligibleWeekStarts: ReadonlySet<string>;
    }
  >;
  minimumWeekStartByStudent?: ReadonlyMap<string, string | null | undefined>;
  below70StreakByStudent?: ReadonlyMap<string, number>;
}) {
  const selectedWeekComplete = weekIsComplete(input.selectedWeekStart, input.today);
  const selectedWeekDates = weekDatesFromStart(input.selectedWeekStart);
  const rows = input.students.flatMap<LeaderboardRow>((student) => {
    const minimumWeekStart = input.minimumWeekStartByStudent?.get(student.id) ?? null;

    if (!minimumWeekStart || input.selectedWeekStart < minimumWeekStart) {
      return [];
    }

    const selectedWeekCheckins = input.selectedWeekCheckinsByStudent.get(student.id) ?? [];
    const checkinByDate = new Map(selectedWeekCheckins.map((checkin) => [checkin.date, checkin.daily_score]));
    const effectiveToday = !selectedWeekDates.includes(input.today) || checkinByDate.has(input.today)
      ? input.today
      : addDays(input.today, -1);
    const dailyProgress = calculateDailyScoreProgress({
      weekDates: selectedWeekDates,
      dailyScoresByDate: checkinByDate,
      today: effectiveToday
    });
    const score = calculateWeekScoreForStudent({
      weekStart: input.selectedWeekStart,
      checkins: selectedWeekCheckins,
      partnerRecitations: input.selectedWeekPartnerRecitationsByStudent.get(student.id) ?? [],
      halaqaGrade: input.selectedWeekHalaqaGradeByStudent.get(student.id) ?? null
    });
    const streakData = input.streakDataByStudent.get(student.id);
    const below70Streak = input.below70StreakByStudent?.has(student.id)
      ? input.below70StreakByStudent.get(student.id) ?? 0
      : streakData
        ? calculateBelow70Streak({
            completedWeekStartsDescending: input.completedWeekStartsDescending,
            minimumWeekStart: input.minimumWeekStartByStudent?.get(student.id) ?? null,
            ...streakData
          })
        : 0;
    const belowThreshold = score.percentage < PASSING_PERCENTAGE;

    return [{
      rank: 0,
      studentId: student.id,
      studentName: student.name,
      studentEmail: student.email,
      studentPhone: student.phone,
      masjidName: student.masjidName,
      cohortName: student.cohortName,
      groupName: student.groupName,
      canViewCurrentContact: student.canViewCurrentContact,
      canOpenCurrentProfile: student.canOpenCurrentProfile,
      score,
      dueDays: dailyProgress.due_days,
      submittedDays: dailyProgress.submitted_days,
      missingDueDays: Math.max(dailyProgress.due_days - dailyProgress.submitted_days, 0),
      status: selectedWeekComplete
        ? belowThreshold
          ? "below_70"
          : "passing"
        : belowThreshold
          ? "below_70_so_far"
          : "in_progress",
      below70Streak
    }];
  });
  const visibleRows = input.below70Only ? rows.filter((row) => row.score.percentage < PASSING_PERCENTAGE) : rows;

  visibleRows.sort((a, b) => {
    if (input.below70Only) {
      return b.below70Streak - a.below70Streak
        || a.score.percentage - b.score.percentage
        || a.studentName.localeCompare(b.studentName)
        || a.studentId.localeCompare(b.studentId);
    }

    return b.score.percentage - a.score.percentage
      || a.studentName.localeCompare(b.studentName)
      || a.studentId.localeCompare(b.studentId);
  });

  return visibleRows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildLeaderboardRowsFromAggregates(input: {
  aggregates: LeaderboardAggregate[];
  selectedWeekStart: string;
  today: string;
  below70Only: boolean;
}) {
  const selectedWeekComplete = weekIsComplete(input.selectedWeekStart, input.today);
  const rows = input.aggregates.flatMap<LeaderboardRow>((aggregate) => {
    if (!aggregate.score_starts_on || input.selectedWeekStart < aggregate.score_starts_on) {
      return [];
    }

    const belowThreshold = aggregate.percentage < PASSING_PERCENTAGE;
    const score: WeeklyScore = {
      daily_points: aggregate.daily_points,
      partner_points: aggregate.partner_points,
      halaqa_points: aggregate.halaqa_points,
      total_points: aggregate.total_points,
      total_possible: 1000,
      percentage: aggregate.percentage
    };

    return [{
      rank: 0,
      studentId: aggregate.student_id,
      studentName: aggregate.student_name,
      studentEmail: aggregate.student_email,
      studentPhone: aggregate.student_phone,
      masjidName: aggregate.masjid_name,
      cohortName: aggregate.cohort_name,
      groupName: aggregate.group_name,
      canViewCurrentContact: aggregate.can_view_current_contact,
      canOpenCurrentProfile: aggregate.can_open_current_profile,
      score,
      dueDays: aggregate.due_days,
      submittedDays: aggregate.submitted_days,
      missingDueDays: aggregate.missing_due_days,
      status: selectedWeekComplete
        ? belowThreshold
          ? "below_70"
          : "passing"
        : belowThreshold
          ? "below_70_so_far"
          : "in_progress",
      below70Streak: aggregate.below70_streak
    }];
  });

  const visibleRows = input.below70Only
    ? rows.filter((row) => row.score.percentage < PASSING_PERCENTAGE)
    : rows;

  visibleRows.sort((a, b) => {
    if (input.below70Only) {
      return b.below70Streak - a.below70Streak
        || a.score.percentage - b.score.percentage
        || a.studentName.localeCompare(b.studentName)
        || a.studentId.localeCompare(b.studentId);
    }

    return b.score.percentage - a.score.percentage
      || a.studentName.localeCompare(b.studentName)
      || a.studentId.localeCompare(b.studentId);
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
    "historical masjid",
    "historical cohort",
    "historical group",
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
        row.masjidName,
        row.cohortName,
        row.groupName,
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
