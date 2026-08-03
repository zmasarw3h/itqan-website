import { isValidDateString, torontoCivilDateString } from "@/lib/dates";
import type { BadgeAward, Profile } from "@/lib/types";
import type { HistoricalReportingStudent } from "@/lib/reporting-population";

export type RewardBadgeAward = Pick<
  BadgeAward,
  "id" | "student_id" | "week_start" | "weekly_percentage" | "badges_awarded" | "created_at"
>;

export type RewardStudent = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  canViewCurrentContact: boolean;
  canOpenCurrentProfile: boolean;
};

export type StudentRewardSummary = {
  totalBadges: number;
  monthBadges: number;
};

export type MonthlyBadgeLeaderboardRow = {
  rank: number;
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  studentPhone: string | null;
  canViewCurrentContact: boolean;
  canOpenCurrentProfile: boolean;
  monthBadges: number;
  lifetimeBadges: number;
  recentAwards: RewardBadgeAward[];
};

export function monthStartForDate(dateString = torontoCivilDateString()) {
  if (!isValidDateString(dateString)) {
    throw new Error("Invalid date.");
  }

  return `${dateString.slice(0, 7)}-01`;
}

export function isValidMonthString(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return false;
  }

  return isValidDateString(`${month}-01`);
}

export function monthStartForMonthString(month: string) {
  if (!isValidMonthString(month)) {
    throw new Error("Invalid month.");
  }

  return `${month}-01`;
}

export function nextMonthStart(monthStart: string) {
  if (!isValidDateString(monthStart) || !monthStart.endsWith("-01")) {
    throw new Error("Invalid month start.");
  }

  const date = new Date(`${monthStart}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export function formatMonthLabel(monthStart: string) {
  if (!isValidDateString(monthStart)) {
    throw new Error("Invalid month start.");
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${monthStart}T00:00:00.000Z`));
}

export function badgeAwardBelongsToStudent(actor: Profile | null, award: Pick<BadgeAward, "student_id"> | null) {
  return Boolean(actor?.active && actor.role === "student" && award?.student_id === actor.id);
}

export function awardIsInMonth(award: Pick<BadgeAward, "week_start">, monthStart: string) {
  return award.week_start >= monthStart && award.week_start < nextMonthStart(monthStart);
}

export function buildStudentRewardSummary(input: {
  awards: Array<Pick<BadgeAward, "week_start" | "badges_awarded">>;
  monthStart: string;
}): StudentRewardSummary {
  const totalBadges = input.awards.reduce((sum, award) => sum + Number(award.badges_awarded ?? 0), 0);
  const monthBadges = input.awards
    .filter((award) => awardIsInMonth(award, input.monthStart))
    .reduce((sum, award) => sum + Number(award.badges_awarded ?? 0), 0);

  return {
    totalBadges,
    monthBadges
  };
}

export function buildMonthlyBadgeLeaderboard(input: {
  students: RewardStudent[];
  awards: RewardBadgeAward[];
  monthStart: string;
}): MonthlyBadgeLeaderboardRow[] {
  const awardsByStudent = new Map<string, RewardBadgeAward[]>();

  for (const award of input.awards) {
    awardsByStudent.set(award.student_id, [...(awardsByStudent.get(award.student_id) ?? []), award]);
  }

  return input.students
    .map((student) => {
      const studentAwards = awardsByStudent.get(student.id) ?? [];
      const recentAwards = [...studentAwards].sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, 3);

      return {
        rank: 0,
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        studentPhone: student.phone,
        canViewCurrentContact: student.canViewCurrentContact,
        canOpenCurrentProfile: student.canOpenCurrentProfile,
        monthBadges: studentAwards
          .filter((award) => awardIsInMonth(award, input.monthStart))
          .reduce((sum, award) => sum + Number(award.badges_awarded ?? 0), 0),
        lifetimeBadges: studentAwards.reduce((sum, award) => sum + Number(award.badges_awarded ?? 0), 0),
        recentAwards
      };
    })
    .sort(
      (a, b) =>
        b.monthBadges - a.monthBadges ||
        b.lifetimeBadges - a.lifetimeBadges ||
        a.studentName.localeCompare(b.studentName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildMonthlyRewardPopulation(input: {
  population: HistoricalReportingStudent[];
  monthStart: string;
}): RewardStudent[] {
  const monthEnd = nextMonthStart(input.monthStart);
  const monthStudentIds = new Set(
    input.population
      .filter(
        (student) =>
          student.scoring_eligible &&
          student.week_start >= input.monthStart &&
          student.week_start < monthEnd
      )
      .map((student) => student.student_id)
  );
  const latestIdentityByStudent = new Map(
    [...input.population]
      .sort((left, right) => left.week_start.localeCompare(right.week_start))
      .map((student) => [student.student_id, student])
  );

  return [...monthStudentIds].flatMap((studentId) => {
    const student = latestIdentityByStudent.get(studentId);

    return student ? [{
      id: student.student_id,
      name: student.student_name,
      email: student.student_email,
      phone: student.student_phone,
      canViewCurrentContact: student.can_view_current_contact,
      canOpenCurrentProfile: student.can_open_current_profile
    }] : [];
  });
}
