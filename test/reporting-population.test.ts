import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  activityMatchesHistoricalPopulation,
  historicalPopulationByStudentWeek,
  loadHistoricalReportingAvailableWeeks,
  type HistoricalReportingStudent
} from "@/lib/reporting-population";
import { buildMonthlyRewardPopulation } from "@/lib/rewards";
import { loadCompletedWeekStarts } from "@/lib/weekly-incentives";

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
  it("keeps SQL report weeks on the same 1am Toronto tracker boundary as the app", () => {
    const migration = readFileSync(
      "supabase/migrations/20260803013447_historical_report_populations.sql",
      "utf8"
    );

    expect(migration).toContain("week_start_for_date(public.current_effective_date())");
    expect(migration).not.toContain(
      "week_start_for_date(public.current_toronto_civil_date())"
    );
    expect(migration).toContain(
      "public.current_toronto_civil_date()\n      )"
    );
  });

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

  it("paginates only the bounded evidence weeks supplied by the RPC", async () => {
    const boundedWeeks = Array.from({ length: 12 }, (_, index) => ({
      week_start: `2026-${String(index + 1).padStart(2, "0")}-01`
    }));
    const range = vi.fn(async () => ({ data: boundedWeeks, error: null }));
    const rpc = vi.fn(() => ({ range }));
    const supabase = { rpc } as never;

    await expect(loadHistoricalReportingAvailableWeeks(supabase)).resolves.toHaveLength(12);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledOnce();
    expect(range).toHaveBeenCalledWith(0, 499);
  });

  it("uses the bounded available-week result as the complete rewards scan input", async () => {
    const range = vi.fn(async () => ({
      data: [
        { week_start: "2026-06-21" },
        { week_start: "2026-06-14" },
        { week_start: "2026-06-07" }
      ],
      error: null
    }));
    const supabase = { rpc: vi.fn(() => ({ range })) } as never;

    await expect(loadCompletedWeekStarts(supabase, "2026-06-28")).resolves.toEqual([
      "2026-06-21",
      "2026-06-14",
      "2026-06-07"
    ]);
    expect(range).toHaveBeenCalledOnce();
  });
});
