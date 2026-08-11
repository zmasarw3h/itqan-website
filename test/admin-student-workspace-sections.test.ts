import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildWeeklyActivityDays,
  correctionDatesForWeek,
  initialCorrectionDate,
  validatedCorrectionDate,
  validCompletedTaskKeysForCorrectionDate,
  weeklyActivityDueSummary
} from "@/lib/admin-student-workspace-sections";
import WeeklyActivitySection from "@/app/admin/students/[id]/weekly-activity-section";
import type { CheckIn, CheckInItem } from "@/lib/types";

const studentId = "11111111-1111-4111-8111-111111111111";
const checkin: CheckIn = {
  id: "22222222-2222-4222-8222-222222222222",
  student_id: studentId,
  date: "2026-08-09",
  completed: true,
  note: "Stored note",
  earned_weight: 17,
  total_weight: 23,
  daily_score: 74,
  submitted_at: "2026-08-09T16:00:00.000Z",
  updated_at: null,
  updated_by_admin: null
};
const storedItem: CheckInItem = {
  id: "33333333-3333-4333-8333-333333333333",
  checkin_id: checkin.id,
  student_id: studentId,
  date: checkin.date,
  task_key: "retired_historical_key",
  task_label: "Historical stored task label",
  weight: 23,
  completed: true,
  created_at: "2026-08-09T16:00:00.000Z"
};

function savedCheckin(date: string, score: number, idSuffix: string): CheckIn {
  return {
    ...checkin,
    id: `22222222-2222-4222-8222-${idSuffix.padStart(12, "0")}`,
    date,
    daily_score: score
  };
}

function dueSummary(input: {
  weekStart?: string;
  effectiveDate: string;
  checkins?: CheckIn[];
}) {
  const days = buildWeeklyActivityDays({
    weekStart: input.weekStart ?? "2026-08-09",
    effectiveDate: input.effectiveDate,
    checkins: input.checkins ?? [],
    items: []
  });
  return weeklyActivityDueSummary(days, input.effectiveDate);
}

describe("admin student workspace section models", () => {
  it("uses stored historical task labels and weights without current-template recomputation", () => {
    const days = buildWeeklyActivityDays({
      weekStart: "2026-08-09",
      effectiveDate: "2026-08-10",
      checkins: [checkin],
      items: [storedItem]
    });
    expect(days[0].items).toEqual([storedItem]);
    expect(days[0].checkin?.total_weight).toBe(23);

    const markup = renderToStaticMarkup(createElement(WeeklyActivitySection, {
      weekStart: "2026-08-09",
      effectiveDate: "2026-08-10",
      checkins: [checkin],
      items: [storedItem]
    }));
    expect(markup).toContain("Historical stored task label");
    expect(markup).toContain("23 / 23");
    expect(markup).not.toMatch(/Save correction|Correct this day|data-correction-form/);
  });

  it("distinguishes saved, missing, open, and upcoming days", () => {
    expect(buildWeeklyActivityDays({
      weekStart: "2026-08-09",
      effectiveDate: "2026-08-11",
      checkins: [checkin],
      items: [storedItem]
    }).map((day) => day.state)).toEqual([
      "saved", "missing", "open", "upcoming", "upcoming", "upcoming", "upcoming"
    ]);
  });

  it("excludes an open current day from due-day and due-points denominators", () => {
    expect(dueSummary({
      effectiveDate: "2026-08-10",
      checkins: [savedCheckin("2026-08-09", 60, "1")]
    })).toEqual({
      dueDays: 1,
      savedDays: 1,
      earnedPoints: 60,
      possiblePoints: 100
    });
  });

  it("includes a saved current day in both due denominators", () => {
    expect(dueSummary({
      effectiveDate: "2026-08-10",
      checkins: [
        savedCheckin("2026-08-09", 60, "1"),
        savedCheckin("2026-08-10", 50, "2")
      ]
    })).toEqual({
      dueDays: 2,
      savedDays: 2,
      earnedPoints: 110,
      possiblePoints: 200
    });
  });

  it("counts a past missing day in the denominator", () => {
    expect(dueSummary({
      effectiveDate: "2026-08-11",
      checkins: [savedCheckin("2026-08-09", 60, "1")]
    })).toEqual({
      dueDays: 2,
      savedDays: 1,
      earnedPoints: 60,
      possiblePoints: 200
    });
  });

  it("counts all seven days for a completed historical week", () => {
    const checkins = Array.from({ length: 7 }, (_, offset) => (
      savedCheckin(`2026-08-${String(2 + offset).padStart(2, "0")}`, 70, String(offset + 1))
    ));
    expect(dueSummary({
      weekStart: "2026-08-02",
      effectiveDate: "2026-08-11",
      checkins
    })).toEqual({
      dueDays: 7,
      savedDays: 7,
      earnedPoints: 490,
      possiblePoints: 700
    });
  });

  it("excludes every future day from due totals", () => {
    expect(dueSummary({
      weekStart: "2026-08-16",
      effectiveDate: "2026-08-11"
    })).toEqual({
      dueDays: 0,
      savedDays: 0,
      earnedPoints: 0,
      possiblePoints: 0
    });
  });

  it("constrains correction dates to the selected week and effective operational date", () => {
    expect(correctionDatesForWeek("2026-08-09", "2026-08-11")).toEqual([
      "2026-08-09", "2026-08-10", "2026-08-11"
    ]);
    expect(correctionDatesForWeek("2026-08-02", "2026-08-11")).toHaveLength(7);
    expect(correctionDatesForWeek("2026-08-16", "2026-08-11")).toEqual([]);
  });

  it("accepts only an opened date inside the canonical correction week", () => {
    expect(validatedCorrectionDate({ candidate: "2026-08-09", weekStart: "2026-08-09", effectiveDate: "2026-08-11" })).toBe("2026-08-09");
    for (const candidate of ["invalid", "2026-08-12", "2026-08-08", "2026-08-16"]) {
      expect(validatedCorrectionDate({ candidate, weekStart: "2026-08-09", effectiveDate: "2026-08-11" })).toBeNull();
    }
    expect(validatedCorrectionDate({ candidate: "2026-08-09", weekStart: "2026-08-10", effectiveDate: "2026-08-11" })).toBeNull();
  });

  it("selects an eligible initial date and the effective checklist version for each correction date", () => {
    expect(initialCorrectionDate({
      weekStart: "2026-08-02",
      effectiveDate: "2026-08-11",
      savedDates: ["2026-08-05"]
    })).toBe("2026-08-05");
    expect(validCompletedTaskKeysForCorrectionDate("2026-08-07", [
      "tafsir", "repeat_new_memorization_5x_listen_1x"
    ])).toEqual(["tafsir", "repeat_new_memorization_5x_listen_1x"]);
    expect(validCompletedTaskKeysForCorrectionDate("2026-08-14", [
      "tafsir", "repeat_new_memorization_5x_listen_1x"
    ])).toEqual(["repeat_new_memorization_5x_listen_1x"]);
  });
});
