import { describe, expect, it } from "vitest";
import { checkInEffectiveDateString } from "@/lib/dates";
import {
  buildLeaderboardRows,
  buildLeaderboardRowsFromAggregates,
  calculateBelow70Streak,
  leaderboardRowsToCsv,
  type LeaderboardAggregate,
  type LeaderboardRow
} from "@/lib/leaderboard";

function leaderboardRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    studentId: "student-1",
    studentName: "Student One",
    studentEmail: "student@example.com",
    studentPhone: "+1 555 0101",
    masjidName: "Masjid A",
    cohortName: "Brothers",
    groupName: "Group A",
    canViewCurrentContact: true,
    canOpenCurrentProfile: true,
    score: {
      daily_points: 700,
      partner_points: 150,
      halaqa_points: 150,
      total_points: 1000,
      total_possible: 1000,
      percentage: 100
    },
    dueDays: 7,
    submittedDays: 7,
    missingDueDays: 0,
    status: "passing",
    below70Streak: 0,
    ...overrides
  };
}

function leaderboardAggregate(overrides: Partial<LeaderboardAggregate> = {}): LeaderboardAggregate {
  return {
    student_id: "student-1",
    student_name: "Student One",
    student_email: "student@example.com",
    student_phone: "+1 555 0101",
    masjid_name: "Masjid A",
    cohort_name: "Brothers",
    group_name: "Group A",
    can_view_current_contact: true,
    can_open_current_profile: true,
    score_starts_on: "2026-06-07",
    daily_points: 500,
    partner_points: 75,
    halaqa_points: 100,
    total_points: 675,
    percentage: 67.5,
    below70_streak: 2,
    due_days: 7,
    submitted_days: 5,
    missing_due_days: 2,
    ...overrides
  };
}

describe("leaderboard CSV export", () => {
  it("preserves database score components, official-score boundaries, reset-aware streaks, and ranking", () => {
    const rows = buildLeaderboardRowsFromAggregates({
      aggregates: [
        leaderboardAggregate({ student_id: "student-1", student_name: "Student One", below70_streak: 0 }),
        leaderboardAggregate({
          student_id: "student-2",
          student_name: "Student Two",
          total_points: 600,
          percentage: 60,
          below70_streak: 2,
          masjid_name: "Masjid B",
          cohort_name: "Sisters",
          group_name: "Group B"
        }),
        leaderboardAggregate({
          student_id: "orientation",
          student_name: "Orientation",
          score_starts_on: "2026-07-19"
        })
      ],
      selectedWeekStart: "2026-07-12",
      today: "2026-07-28",
      below70Only: true
    });

    expect(rows.map((row) => row.studentId)).toEqual(["student-2", "student-1"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({
      status: "below_70",
      below70Streak: 2,
      masjidName: "Masjid B",
      cohortName: "Sisters",
      groupName: "Group B",
      score: {
        daily_points: 500,
        partner_points: 75,
        halaqa_points: 100,
        total_points: 600,
        percentage: 60
      }
    });
    expect(rows.some((row) => row.studentId === "orientation")).toBe(false);
  });

  it("does not count below-70 streak weeks before the May 31-June 6, 2026 cutoff", () => {
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: ["2026-05-31", "2026-05-24"],
        minimumWeekStart: "2026-05-31",
        checkinsByWeek: new Map(),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(1);
  });

  it("treats an absent score boundary as not scorable", () => {
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: ["2026-06-28"],
        minimumWeekStart: null,
        checkinsByWeek: new Map(),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(0);
  });

  it("does not count below-70 streak weeks before the student score baseline", () => {
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: ["2026-06-28", "2026-06-21", "2026-06-14"],
        minimumWeekStart: "2026-07-05",
        checkinsByWeek: new Map(),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(0);
  });

  it("breaks a streak when the student is absent from one historical population", () => {
    expect(
      calculateBelow70Streak({
        completedWeekStartsDescending: ["2026-06-14", "2026-06-07", "2026-05-31"],
        minimumWeekStart: "2026-05-31",
        eligibleWeekStarts: new Set(["2026-06-14", "2026-05-31"]),
        checkinsByWeek: new Map(),
        partnerRecitationsByWeek: new Map(),
        halaqaGradeByWeek: new Map()
      })
    ).toBe(1);
  });

  it("escapes spreadsheet formula prefixes in user-controlled fields", () => {
    const csv = leaderboardRowsToCsv([
      leaderboardRow({
        studentName: "=cmd",
        studentPhone: "+15550101",
        studentEmail: "@student.example"
      })
    ]);

    expect(csv).toContain("1,'=cmd,'+15550101,'@student.example");
  });

  it("quotes commas and quotes after formula-prefix escaping", () => {
    const csv = leaderboardRowsToCsv([
      leaderboardRow({
        studentName: '-Student, "One"'
      })
    ]);

    expect(csv).toContain('"\'-Student, ""One"""');
  });
});

describe("selected-week daily activity counts", () => {
  const student = {
    id: "student-1",
    name: "Student One",
    email: "student@example.com",
    phone: "+1 555 0101",
    masjidName: "Masjid A",
    cohortName: "Brothers",
    groupName: "Group A",
    canViewCurrentContact: true,
    canOpenCurrentProfile: true
  };

  function buildRows(input: {
    selectedWeekStart: string;
    today: string;
    checkinDates: string[];
    minimumWeekStart?: string;
  }) {
    const checkins = input.checkinDates.map((date) => ({
      student_id: student.id,
      date,
      daily_score: 0
    }));

    return buildLeaderboardRows({
      students: [student],
      selectedWeekStart: input.selectedWeekStart,
      today: input.today,
      below70Only: false,
      completedWeekStartsDescending: [],
      selectedWeekCheckinsByStudent: new Map([[student.id, checkins]]),
      selectedWeekPartnerRecitationsByStudent: new Map(),
      selectedWeekHalaqaGradeByStudent: new Map(),
      streakDataByStudent: new Map(),
      minimumWeekStartByStudent: new Map([[student.id, input.minimumWeekStart ?? input.selectedWeekStart]])
    });
  }

  it("counts only due current-week dates and excludes upcoming dates", () => {
    expect(buildRows({
      selectedWeekStart: "2026-08-09",
      today: "2026-08-11",
      checkinDates: ["2026-08-09"]
    })[0]).toMatchObject({
      dueDays: 2,
      submittedDays: 1,
      missingDueDays: 1
    });
  });

  it("includes the effective current date only when its check-in is saved", () => {
    expect(buildRows({
      selectedWeekStart: "2026-08-09",
      today: "2026-08-11",
      checkinDates: ["2026-08-09", "2026-08-10"]
    })[0]).toMatchObject({
      dueDays: 2,
      submittedDays: 2,
      missingDueDays: 0
    });

    expect(buildRows({
      selectedWeekStart: "2026-08-09",
      today: "2026-08-11",
      checkinDates: ["2026-08-09", "2026-08-10", "2026-08-11"]
    })[0]).toMatchObject({
      dueDays: 3,
      submittedDays: 3,
      missingDueDays: 0
    });
  });

  it("counts all seven historical due days and treats saved zero points as submitted", () => {
    const completeDates = Array.from({ length: 7 }, (_, index) => `2026-08-${String(2 + index).padStart(2, "0")}`);

    expect(buildRows({
      selectedWeekStart: "2026-08-02",
      today: "2026-08-11",
      checkinDates: completeDates
    })[0]).toMatchObject({
      dueDays: 7,
      submittedDays: 7,
      missingDueDays: 0
    });

    expect(buildRows({
      selectedWeekStart: "2026-08-02",
      today: "2026-08-11",
      checkinDates: ["2026-08-02", "2026-08-03", "2026-08-04"]
    })[0]).toMatchObject({
      dueDays: 7,
      submittedDays: 3,
      missingDueDays: 4
    });
  });

  it("does not expose activity counts before the scoring start boundary", () => {
    expect(buildLeaderboardRowsFromAggregates({
      aggregates: [leaderboardAggregate({
        score_starts_on: "2026-08-16",
        due_days: 0,
        submitted_days: 0,
        missing_due_days: 0
      })],
      selectedWeekStart: "2026-08-09",
      today: "2026-08-11",
      below70Only: false
    })).toEqual([]);
  });

  it("keeps deterministic ranking and aggregate count mapping", () => {
    const rows = buildLeaderboardRowsFromAggregates({
      aggregates: [
        leaderboardAggregate({
          student_id: "student-b",
          student_name: "Same Name",
          due_days: 3,
          submitted_days: 1,
          missing_due_days: 2
        }),
        leaderboardAggregate({
          student_id: "student-a",
          student_name: "Same Name",
          due_days: 3,
          submitted_days: 3,
          missing_due_days: 0
        })
      ],
      selectedWeekStart: "2026-08-09",
      today: "2026-08-11",
      below70Only: false
    });

    expect(rows.map((row) => row.studentId)).toEqual(["student-a", "student-b"]);
    expect(rows.map((row) => [row.dueDays, row.submittedDays, row.missingDueDays])).toEqual([
      [3, 3, 0],
      [3, 1, 2]
    ]);
  });

  it("uses the Toronto effective date across the DST/reset boundary", () => {
    const beforeReset = checkInEffectiveDateString(new Date("2026-05-11T04:30:00.000Z"));
    const atReset = checkInEffectiveDateString(new Date("2026-05-11T05:00:00.000Z"));

    expect(beforeReset).toBe("2026-05-10");
    expect(atReset).toBe("2026-05-11");
    expect(buildRows({
      selectedWeekStart: "2026-05-10",
      today: beforeReset,
      checkinDates: ["2026-05-10"]
    })[0]).toMatchObject({ dueDays: 1, submittedDays: 1, missingDueDays: 0 });
    expect(buildRows({
      selectedWeekStart: "2026-05-10",
      today: atReset,
      checkinDates: ["2026-05-10", "2026-05-11"]
    })[0]).toMatchObject({ dueDays: 2, submittedDays: 2, missingDueDays: 0 });
  });
});
