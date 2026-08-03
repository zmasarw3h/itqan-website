import { describe, expect, it } from "vitest";
import {
  activityMatchesHistoricalPopulation,
  historicalPopulationByStudentWeek,
  type HistoricalReportingStudent
} from "@/lib/reporting-population";
import { buildMonthlyRewardPopulation } from "@/lib/rewards";

function population(overrides: Partial<HistoricalReportingStudent> = {}): HistoricalReportingStudent {
  return {
    week_start: "2026-06-07",
    student_id: "student-a",
    student_name: "Student A",
    student_email: null,
    student_phone: null,
    membership_starts_on: "2026-06-01",
    membership_ends_on: null,
    score_starts_on: "2026-06-07",
    scoring_eligible: true,
    masjid_id: "masjid-a",
    masjid_name: "Masjid A",
    cohort_id: "cohort-a",
    cohort_kind: "brothers",
    cohort_name: "Brothers",
    group_id: "group-a",
    group_name: "Group A",
    can_view_current_contact: false,
    can_open_current_profile: false,
    ...overrides
  };
}

describe("historical reporting population", () => {
  it("accepts activity only when its immutable scope matches that student-week population", () => {
    const byWeek = historicalPopulationByStudentWeek([population()]);

    expect(activityMatchesHistoricalPopulation({
      student_id: "student-a",
      masjid_id: "masjid-a",
      cohort_id: "cohort-a",
      halaqa_group_id: "group-a"
    }, "2026-06-07", byWeek)).toBe(true);
    expect(activityMatchesHistoricalPopulation({
      student_id: "student-a",
      masjid_id: "masjid-b",
      cohort_id: "cohort-b",
      halaqa_group_id: "group-b"
    }, "2026-06-07", byWeek)).toBe(false);
  });

  it("builds a monthly union only from students eligible during that month", () => {
    const result = buildMonthlyRewardPopulation({
      monthStart: "2026-06-01",
      population: [
        population({ student_id: "historical", student_name: "Historical" }),
        population({ student_id: "midmonth", student_name: "Midmonth", week_start: "2026-06-21" }),
        population({ student_id: "orientation", student_name: "Orientation", scoring_eligible: false }),
        population({ student_id: "later", student_name: "Later", week_start: "2026-07-05" })
      ]
    });

    expect(result.map((student) => student.id).sort()).toEqual(["historical", "midmonth"]);
  });
});
