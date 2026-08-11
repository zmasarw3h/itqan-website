import { describe, expect, it } from "vitest";
import {
  displayOfficialScoringBoundary,
  isCanonicalScoringSunday,
  isLegacyOfficialScoringBoundary,
  officialScoringStatus,
  parseOfficialScoringChangePreview
} from "@/lib/official-scoring";

describe("official scoring workflow", () => {
  it("accepts only canonical Sunday boundaries", () => {
    expect(isCanonicalScoringSunday("2026-07-26")).toBe(true);
    expect(isCanonicalScoringSunday("2026-07-27")).toBe(false);
    expect(isCanonicalScoringSunday(null)).toBe(false);
  });

  it("derives orientation, scheduled, and active labels from the boundary", () => {
    expect(officialScoringStatus(null, "2026-07-19").state).toBe("orientation");
    expect(officialScoringStatus("2026-07-26", "2026-07-19").state).toBe("scheduled");
    expect(officialScoringStatus("2026-07-19", "2026-07-19").state).toBe("active");
  });

  it("treats the legacy 1900 boundary as a review-required value without displaying a false date", () => {
    expect(isLegacyOfficialScoringBoundary("1900-01-07")).toBe(true);
    expect(displayOfficialScoringBoundary("1900-01-07")).toBe("Legacy value — review required");
    expect(officialScoringStatus("1900-01-07", "2026-07-19")).toMatchObject({
      state: "legacy",
      label: "Legacy boundary — review required"
    });
    expect(officialScoringStatus("1900-01-07", "2026-07-19").description).not.toContain("1900");
  });

  it("parses a bounded database preview", () => {
    expect(
      parseOfficialScoringChangePreview({
        student_id: "student",
        student_name: "Student",
        actor_role: "admin",
        old_score_starts_on: "2026-07-19",
        new_score_starts_on: "2026-07-26",
        earliest_access_starts_on: "2026-07-15",
        earliest_valid_score_start: "2026-07-19",
        direction: "forward",
        affected_week_starts: ["2026-07-19"],
        pending_obligations: [{ id: "obligation", week_start: "2026-07-19", amount_cents: 500 }],
        pending_obligation_count: 1,
        pending_amount_cents: 500
      })
    ).toMatchObject({ direction: "forward", pending_obligation_count: 1 });
  });

  it("rejects malformed preview payloads", () => {
    expect(parseOfficialScoringChangePreview({ direction: "forward" })).toBeNull();
  });
});
