import { describe, expect, it } from "vitest";
import { calculateDailySubmission, calculateWeeklyAverage, tasksForDate } from "@/lib/scoring";

describe("weighted Quran tracker scoring", () => {
  it("returns the Sunday-Wednesday task set", () => {
    expect(tasksForDate("2026-05-10")).toEqual([
      {
        key: "new_memorization_3x",
        label: "New memorization assigned recited three times",
        weight: 25
      },
      { key: "old_revision", label: "Old revision recited", weight: 30 },
      {
        key: "salat_recitation",
        label: "Weekly assigned recitation recited during salat",
        weight: 25
      },
      { key: "tajweed_hearing", label: "Hearing tajweed from a sheikh", weight: 20 }
    ]);
  });

  it("scores Sunday-Wednesday completion", () => {
    const result = calculateDailySubmission("2026-05-11", [
      "new_memorization_3x",
      "old_revision",
      "salat_recitation",
      "tajweed_hearing"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores Thursday completion", () => {
    expect(tasksForDate("2026-05-14").find((task) => task.key === "old_revision")?.weight).toBe(25);

    const result = calculateDailySubmission("2026-05-14", [
      "weekly_recitation_3x",
      "old_revision",
      "salat_recitation",
      "tajweed_hearing"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores Friday completion", () => {
    expect(tasksForDate("2026-05-15").find((task) => task.key === "old_revision")?.weight).toBe(25);

    const result = calculateDailySubmission("2026-05-15", [
      "weekly_recitation_5x",
      "old_revision",
      "salat_recitation",
      "tajweed_hearing"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores Saturday completion", () => {
    const result = calculateDailySubmission("2026-05-16", [
      "attending_halaqa",
      "reflection_group",
      "next_week_tafsir"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores partial completion", () => {
    const result = calculateDailySubmission("2026-05-10", ["new_memorization_3x", "tajweed_hearing"]);

    expect(result).toMatchObject({ earnedWeight: 45, totalWeight: 100, dailyScore: 45 });
  });

  it("calculates weekly average across seven daily percentages", () => {
    expect(calculateWeeklyAverage([100, 50, 75, 0, 100, 80, 95])).toBe(71.43);
  });
});
