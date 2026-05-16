import { describe, expect, it } from "vitest";
import {
  calculateDailySubmission,
  calculateHalaqaGrade,
  calculateWeeklyAverage,
  calculateWeeklyScore,
  isPartnerRoundAvailable,
  partnerRoundForDate,
  recitationMarkToStoredPoints,
  storedRecitationPointsToMark,
  tasksForDate
} from "@/lib/scoring";

describe("weighted Quran tracker scoring", () => {
  it("returns the Sunday-Wednesday task set", () => {
    expect(tasksForDate("2026-05-10")).toEqual([
      {
        key: "new_memorization_listening",
        label: "New memorization & Listening",
        weight: 20
      },
      { key: "revise_old", label: "Revise old", weight: 40 },
      { key: "revise_new", label: "Revise new", weight: 20 },
      { key: "tafsir", label: "Tafsir", weight: 10 },
      { key: "recite_next_week_memorization", label: "Recite next week memorization", weight: 5 },
      { key: "read_during_salat", label: "Read during Salat", weight: 5 }
    ]);
  });

  it("scores Sunday-Wednesday completion", () => {
    const result = calculateDailySubmission("2026-05-11", [
      "new_memorization_listening",
      "revise_old",
      "revise_new",
      "tafsir",
      "recite_next_week_memorization",
      "read_during_salat"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores Thursday completion", () => {
    expect(tasksForDate("2026-05-14")[0]).toEqual({
      key: "repeat_new_memorization_3x_listen_1x",
      label: "Repeat new memorization 3 times & listen one time",
      weight: 20
    });

    const result = calculateDailySubmission("2026-05-14", [
      "repeat_new_memorization_3x_listen_1x",
      "revise_old",
      "revise_new",
      "tafsir",
      "recite_next_week_memorization",
      "read_during_salat"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores Friday completion", () => {
    expect(tasksForDate("2026-05-15")[0]).toEqual({
      key: "repeat_new_memorization_5x_listen_1x",
      label: "Repeat new memorization 5 times & listen one time",
      weight: 20
    });

    const result = calculateDailySubmission("2026-05-15", [
      "repeat_new_memorization_5x_listen_1x",
      "revise_old",
      "revise_new",
      "tafsir",
      "recite_next_week_memorization",
      "read_during_salat"
    ]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores Saturday completion", () => {
    expect(tasksForDate("2026-05-16")).toEqual([
      { key: "tafsir_reflection_group", label: "Tafsir and sharing reflection on the group", weight: 50 },
      { key: "repeat_week_memorization_2x", label: "Repeat the memorization of the week 2 times", weight: 50 }
    ]);

    const result = calculateDailySubmission("2026-05-16", ["tafsir_reflection_group", "repeat_week_memorization_2x"]);

    expect(result).toMatchObject({ earnedWeight: 100, totalWeight: 100, dailyScore: 100 });
  });

  it("scores partial completion", () => {
    const result = calculateDailySubmission("2026-05-10", ["new_memorization_listening", "tafsir"]);

    expect(result).toMatchObject({ earnedWeight: 30, totalWeight: 100, dailyScore: 30 });
  });

  it("calculates weekly average across seven daily percentages", () => {
    expect(calculateWeeklyAverage([100, 50, 75, 0, 100, 80, 95])).toBe(71.43);
  });

  it("detects partner recitation rounds from the effective date", () => {
    expect(partnerRoundForDate("2026-05-10")).toBe("round_1");
    expect(partnerRoundForDate("2026-05-13")).toBe("round_1");
    expect(partnerRoundForDate("2026-05-14")).toBe("round_2");
    expect(partnerRoundForDate("2026-05-16")).toBe("round_2");
  });

  it("makes round 1 available Sunday-Wednesday", () => {
    expect(isPartnerRoundAvailable("round_1", "2026-05-10")).toBe(true);
    expect(isPartnerRoundAvailable("round_1", "2026-05-13")).toBe(true);
    expect(isPartnerRoundAvailable("round_1", "2026-05-14")).toBe(false);
  });

  it("makes round 2 available Thursday-Saturday", () => {
    expect(isPartnerRoundAvailable("round_2", "2026-05-13")).toBe(false);
    expect(isPartnerRoundAvailable("round_2", "2026-05-14")).toBe(true);
    expect(isPartnerRoundAvailable("round_2", "2026-05-16")).toBe(true);
  });

  it("sets halaqa points to zero when attendance is false", () => {
    expect(calculateHalaqaGrade({ attended: false, recitationMarkOutOf10: 10 })).toEqual({
      attended: false,
      attendance_points: 0,
      recitation_points: 0,
      halaqa_points: 0
    });
  });

  it("scales attended recitation marks from out of 10 to stored out of 50 points", () => {
    expect(recitationMarkToStoredPoints(2)).toBe(10);
    expect(recitationMarkToStoredPoints(10)).toBe(50);
    expect(storedRecitationPointsToMark(35)).toBe(7);
  });

  it("requires attended recitation mark to be 2-10", () => {
    expect(() => calculateHalaqaGrade({ attended: true, recitationMarkOutOf10: 1 })).toThrow("between 2 and 10");
    expect(() => calculateHalaqaGrade({ attended: true, recitationMarkOutOf10: 11 })).toThrow("between 2 and 10");
    expect(calculateHalaqaGrade({ attended: true, recitationMarkOutOf10: 2 })).toMatchObject({
      attendance_points: 100,
      recitation_points: 10,
      halaqa_points: 110
    });
    expect(calculateHalaqaGrade({ attended: true, recitationMarkOutOf10: 10 })).toMatchObject({
      attendance_points: 100,
      recitation_points: 50,
      halaqa_points: 150
    });
  });

  it("calculates weekly totals out of 1000", () => {
    expect(
      calculateWeeklyScore({
        dailyScores: [100, 100, 80, 70, 90, 60, 100],
        partnerRecitations: [
          { round: "round_1", points: 75 },
          { round: "round_2", points: 75 }
        ],
        halaqaGrade: { attendance_points: 100, recitation_points: 40 }
      })
    ).toEqual({
      daily_points: 600,
      partner_points: 150,
      halaqa_points: 140,
      total_points: 890,
      total_possible: 1000,
      percentage: 89
    });
  });
});
