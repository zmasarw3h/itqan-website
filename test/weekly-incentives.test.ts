import { describe, expect, it } from "vitest";
import { accountabilityAppliesToWeek } from "@/lib/incentives";
import {
  accountabilityGateIsActiveForDate,
  buildWeeklyIncentiveRows,
  buildWeeklyIncentiveReport,
  buildWeeklyFollowUpReport,
  computedBadgeAwardFromRow,
  selectPendingAccountabilityRows,
  type WeeklyIncentiveScoreRow,
  type WeeklyPendingAccountabilityObligation
} from "@/lib/weekly-incentives";
import type { HistoricalReportingStudent } from "@/lib/reporting-population";
import { chunksOf } from "@/lib/supabase-pagination";

function populationFor(
  students: Array<{ id: string; name: string; email: string; phone: string | null; score_starts_on: string | null }>,
  weekStarts: string[]
): HistoricalReportingStudent[] {
  return weekStarts.flatMap((weekStart) => students.map((student) => ({
    week_start: weekStart,
    student_id: student.id,
    student_name: student.name,
    student_email: student.email,
    student_phone: student.phone,
    student_created_at: null,
    membership_starts_on: "2026-01-01",
    membership_ends_on: null,
    score_starts_on: student.score_starts_on,
    scoring_eligible: Boolean(student.score_starts_on && student.score_starts_on <= weekStart),
    masjid_id: "masjid-a",
    masjid_name: "Masjid A",
    cohort_id: "cohort-a",
    cohort_kind: "brothers",
    cohort_name: "Brothers",
    group_id: "group-a",
    group_name: "Group A",
    can_view_current_contact: true,
    can_open_current_profile: true
  })));
}

function row(overrides: Partial<WeeklyIncentiveScoreRow> = {}): WeeklyIncentiveScoreRow {
  const weeklyPercentage = overrides.weeklyPercentage ?? 95;

  return {
    studentId: "student-a",
    studentName: "Student A",
    studentEmail: "student-a@itqan.local",
    studentPhone: null,
    canViewCurrentContact: true,
    canOpenCurrentProfile: true,
    masjidName: "Masjid A",
    cohortName: "Brothers",
    groupName: "Group A",
    weekStart: "2026-05-31",
    weeklyPercentage,
    below70Streak: 0,
    badgesAwarded: weeklyPercentage > 90 ? Math.floor(weeklyPercentage) - 90 : 0,
    accountabilityAmountCents: weeklyPercentage < 70 ? Math.ceil((70 - weeklyPercentage) / 10) * 500 : 0,
    ...overrides
  };
}

function pendingObligation(
  overrides: Partial<WeeklyPendingAccountabilityObligation> = {}
): WeeklyPendingAccountabilityObligation {
  return {
    id: "obligation-a",
    student_id: "student-a",
    week_start: "2026-05-31",
    weekly_percentage: 59,
    amount_cents: 1000,
    status: "pending",
    masjid_id: "masjid-a",
    cohort_id: "cohort-a",
    halaqa_group_id: "group-a",
    ...overrides
  };
}

describe("weekly incentive reports", () => {
  it("keeps accountability obligations scoped to the May 31-June 6, 2026 week and later", () => {
    expect(accountabilityAppliesToWeek("2026-05-24")).toBe(false);
    expect(accountabilityAppliesToWeek("2026-05-31")).toBe(true);
  });

  it("does not activate the student sadaqa gate on Saturday", () => {
    expect(accountabilityGateIsActiveForDate("2026-06-06")).toBe(false);
  });

  it("activates the student sadaqa gate on Sunday after the previous week completes", () => {
    expect(accountabilityGateIsActiveForDate("2026-06-07")).toBe(true);
  });

  it("computes badge awards from completed weekly scores", () => {
    expect(computedBadgeAwardFromRow(row({ weeklyPercentage: 95, badgesAwarded: 5 }))).toMatchObject({
      student_id: "student-a",
      week_start: "2026-05-31",
      weekly_percentage: 95,
      badges_awarded: 5
    });
    expect(computedBadgeAwardFromRow(row({ weeklyPercentage: 90, badgesAwarded: 0 }))).toBeNull();
  });

  it("orders the weekly badge report by badges, score, then student name", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31"],
      rows: [
        row({ studentId: "student-b", studentName: "Student B", weeklyPercentage: 94, badgesAwarded: 4 }),
        row({ studentId: "student-a", studentName: "Student A", weeklyPercentage: 96, badgesAwarded: 6 })
      ]
    });

    expect(report.mostBadgesThisWeek.map((studentRow) => studentRow.studentId)).toEqual(["student-a", "student-b"]);
  });

  it("lists students below 70 for the selected week", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31"],
      rows: [
        row({ studentId: "student-a", weeklyPercentage: 69, accountabilityAmountCents: 500 }),
        row({ studentId: "student-b", weeklyPercentage: 70, badgesAwarded: 0 })
      ]
    });

    expect(report.below70ThisWeek.map((studentRow) => studentRow.studentId)).toEqual(["student-a"]);
  });

  it("returns exactly the selected completed-week follow-up populations and current streak lengths", () => {
    const report = buildWeeklyFollowUpReport({
      selectedWeekStart: "2026-06-28",
      completedWeekStartsDescending: ["2026-06-28", "2026-06-21"],
      rows: [
        row({ studentId: "student-zero", studentName: "Student Zero", weekStart: "2026-06-28", weeklyPercentage: 69, below70Streak: 0 }),
        row({ studentId: "student-one", studentName: "Student One", weekStart: "2026-06-28", weeklyPercentage: 68, below70Streak: 1 }),
        row({ studentId: "student-two", studentName: "Student Two", weekStart: "2026-06-28", weeklyPercentage: 67, below70Streak: 2 }),
        row({ studentId: "student-three", studentName: "Student Three", weekStart: "2026-06-28", weeklyPercentage: 66, below70Streak: 3 }),
        row({ studentId: "student-four", studentName: "Student Four", weekStart: "2026-06-28", weeklyPercentage: 65, below70Streak: 4 }),
        row({ studentId: "student-previous", weekStart: "2026-06-21", weeklyPercentage: 10, below70Streak: 5 })
      ]
    });

    expect(report.below70ThisWeek.map((studentRow) => studentRow.studentId)).toEqual([
      "student-four",
      "student-three",
      "student-two",
      "student-one",
      "student-zero"
    ]);
    expect(report.below70ThreePlusWeeks.map((studentRow) => [studentRow.studentId, studentRow.below70Streak])).toEqual([
      ["student-four", 4],
      ["student-three", 3]
    ]);
    expect(report.rows.map((studentRow) => studentRow.studentId)).not.toContain("student-previous");
  });

  it("does not produce follow-up rows for an incomplete or current week", () => {
    const report = buildWeeklyFollowUpReport({
      selectedWeekStart: "2026-08-09",
      completedWeekStartsDescending: ["2026-08-02"],
      rows: [row({ weekStart: "2026-08-09", weeklyPercentage: 0, below70Streak: 4 })]
    });

    expect(report.rows).toEqual([]);
    expect(report.below70ThisWeek).toEqual([]);
    expect(report.pendingSadaqaRows).toEqual([]);
    expect(report.below70ThreePlusWeeks).toEqual([]);
  });

  it("returns pending sadaqa rows only for pending obligations with exact historical scope", () => {
    const population = populationFor([
      { id: "student-a", name: "Student A", email: "a@itqan.local", phone: "+1 555 0101", score_starts_on: "2026-05-31" },
      { id: "student-b", name: "Student B", email: "b@itqan.local", phone: "+1 555 0102", score_starts_on: "2026-05-31" }
    ], ["2026-05-31"]);
    const rows = [
      row({ studentId: "student-a", studentName: "Student A", weeklyPercentage: 59, weekStart: "2026-05-31", below70Streak: 3 }),
      row({
        studentId: "student-b",
        studentName: "Student B",
        weeklyPercentage: 49,
        weekStart: "2026-05-31",
        below70Streak: 2,
        studentEmail: null,
        studentPhone: null,
        canViewCurrentContact: false,
        canOpenCurrentProfile: false
      })
    ];
    const pending = selectPendingAccountabilityRows({
      selectedWeekStart: "2026-05-31",
      population,
      selectedRows: rows,
      obligations: [
        pendingObligation({ amount_cents: 1500 }),
        pendingObligation({ id: "paid-a", status: "attested_paid" }),
        pendingObligation({
          id: "wrong-cohort",
          student_id: "student-b",
          masjid_id: "masjid-a",
          cohort_id: "cohort-other",
          halaqa_group_id: "group-a"
        }),
        pendingObligation({
          id: "pending-b",
          student_id: "student-b",
          amount_cents: 500
        }),
        pendingObligation({
          id: "wrong-week",
          student_id: "student-b",
          week_start: "2026-06-07"
        })
      ]
    });

    expect(pending.map((studentRow) => studentRow.studentId)).toEqual(["student-b", "student-a"]);
    expect(pending[0]).toMatchObject({
      requiredSadaqaCents: 500,
      accountabilityAmountCents: 500,
      below70Streak: 2,
      studentEmail: null,
      studentPhone: null,
      canViewCurrentContact: false,
      canOpenCurrentProfile: false
    });
    expect(pending[1]).toMatchObject({ requiredSadaqaCents: 1500, accountabilityAmountCents: 1500 });
    expect(
      selectPendingAccountabilityRows({
        selectedWeekStart: "2026-05-31",
        population,
        selectedRows: rows,
        obligations: []
      })
    ).toEqual([]);
  });

  it("uses stable id tie-breakers and chunks large pending-student scopes", () => {
    const report = buildWeeklyFollowUpReport({
      selectedWeekStart: "2026-06-28",
      completedWeekStartsDescending: ["2026-06-28"],
      rows: [
        row({ studentId: "student-b", studentName: "Same Name", weekStart: "2026-06-28", weeklyPercentage: 60 }),
        row({ studentId: "student-a", studentName: "Same Name", weekStart: "2026-06-28", weeklyPercentage: 60 })
      ]
    });

    expect(report.below70ThisWeek.map((studentRow) => studentRow.studentId)).toEqual(["student-a", "student-b"]);
    const chunks = chunksOf(Array.from({ length: 201 }, (_, index) => `student-${index}`));
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 1]);
  });

  it("does not generate incentive rows before a student's score baseline", () => {
    const rows = buildWeeklyIncentiveRows({
      population: populationFor([
        {
          id: "student-a",
          name: "Student A",
          email: "student-a@itqan.local",
          phone: null,
          score_starts_on: "2026-07-05"
        }
      ], ["2026-06-28", "2026-07-05"]),
      checkins: [],
      partnerRecitations: [],
      halaqaGrades: []
    });

    expect(rows.map((scoreRow) => scoreRow.weekStart)).toEqual(["2026-07-05"]);
  });

  it("treats a missing score baseline as not eligible instead of scoring all history", () => {
    const rows = buildWeeklyIncentiveRows({
      population: populationFor([
        {
          id: "student-a",
          name: "Student A",
          email: "student-a@itqan.local",
          phone: null,
          score_starts_on: null
        }
      ], ["2026-05-31", "2026-06-07", "2026-07-12"]),
      checkins: [],
      partnerRecitations: [],
      halaqaGrades: []
    });

    expect(rows).toEqual([]);
  });

  it("does not score completed weeks for a student onboarding in the current week", () => {
    const rows = buildWeeklyIncentiveRows({
      population: populationFor([
        {
          id: "student-a",
          name: "Student A",
          email: "student-a@itqan.local",
          phone: null,
          score_starts_on: "2026-07-19"
        }
      ], ["2026-07-05", "2026-07-12"]),
      checkins: [],
      partnerRecitations: [],
      halaqaGrades: []
    });

    expect(rows).toEqual([]);
  });

  it("does not score a student whose first eligible week is in the future", () => {
    const rows = buildWeeklyIncentiveRows({
      population: populationFor([
        {
          id: "student-a",
          name: "Student A",
          email: "student-a@itqan.local",
          phone: null,
          score_starts_on: "2026-07-26"
        }
      ], ["2026-07-12", "2026-07-19"]),
      checkins: [],
      partnerRecitations: [],
      halaqaGrades: []
    });

    expect(rows).toEqual([]);
  });

  it("keeps valid below-70 accountability rows after the score baseline", () => {
    const rows = buildWeeklyIncentiveRows({
      population: populationFor([
        {
          id: "student-a",
          name: "Student A",
          email: "student-a@itqan.local",
          phone: null,
          score_starts_on: "2026-07-12"
        }
      ], ["2026-07-12"]),
      checkins: [],
      partnerRecitations: [],
      halaqaGrades: []
    });

    expect(rows).toEqual([
      expect.objectContaining({
        studentId: "student-a",
        weekStart: "2026-07-12",
        weeklyPercentage: 0,
        accountabilityAmountCents: 3500
      })
    ]);
  });

  it("identifies students below 70 for two completed weeks straight", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-06-07",
      completedWeekStartsDescending: ["2026-06-07", "2026-05-31"],
      rows: [
        row({ studentId: "student-a", weekStart: "2026-06-07", weeklyPercentage: 59 }),
        row({ studentId: "student-a", weekStart: "2026-05-31", weeklyPercentage: 69 }),
        row({ studentId: "student-b", weekStart: "2026-06-07", weeklyPercentage: 59 }),
        row({ studentId: "student-b", weekStart: "2026-05-31", weeklyPercentage: 70 })
      ]
    });

    expect(report.below70TwoWeeksStraight.map((studentRow) => studentRow.studentId)).toEqual(["student-a"]);
  });

  it("does not fabricate a two-week streak when the student joined in the selected week", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-06-07",
      completedWeekStartsDescending: ["2026-06-07", "2026-05-31"],
      rows: [row({ studentId: "new-student", weekStart: "2026-06-07", weeklyPercentage: 40 })]
    });

    expect(report.below70TwoWeeksStraight).toEqual([]);
  });

  it("does not count pre-cutoff weeks for two-week below-70 streak reports", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31", "2026-05-24"],
      rows: [
        row({ studentId: "student-a", weekStart: "2026-05-31", weeklyPercentage: 59 }),
        row({ studentId: "student-a", weekStart: "2026-05-24", weeklyPercentage: 59 })
      ]
    });

    expect(report.below70TwoWeeksStraight).toEqual([]);
  });

  it("identifies students at 70% or above for three completed weeks straight", () => {
    const report = buildWeeklyIncentiveReport({
      selectedWeekStart: "2026-05-31",
      completedWeekStartsDescending: ["2026-05-31", "2026-05-24", "2026-05-17"],
      rows: [
        row({ studentId: "student-a", weekStart: "2026-05-31", weeklyPercentage: 90, badgesAwarded: 0 }),
        row({ studentId: "student-a", weekStart: "2026-05-24", weeklyPercentage: 80, badgesAwarded: 0 }),
        row({ studentId: "student-a", weekStart: "2026-05-17", weeklyPercentage: 70, badgesAwarded: 0 }),
        row({ studentId: "student-b", weekStart: "2026-05-31", weeklyPercentage: 95, badgesAwarded: 5 }),
        row({ studentId: "student-b", weekStart: "2026-05-24", weeklyPercentage: 80, badgesAwarded: 0 }),
        row({ studentId: "student-b", weekStart: "2026-05-17", weeklyPercentage: 69, badgesAwarded: 0 })
      ]
    });

    expect(report.passingThreeWeeksStraight.map((studentRow) => studentRow.studentId)).toEqual(["student-a"]);
  });
});
