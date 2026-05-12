import { describe, expect, it } from "vitest";
import { buildPartnerRecitationView } from "@/lib/partner-recitations";

describe("partner recitation view state", () => {
  it("shows clear open copy for round 1 and round 2 opening guidance", () => {
    const view = buildPartnerRecitationView({
      today: "2026-05-10",
      recitations: []
    });

    expect(view.currentRoundName).toBe("Round 1");
    expect(view.currentRoundRange).toBe("Sunday–Wednesday");
    expect(view.currentRoundMessage).toBe("Round 1 is open");
    expect(view.canSubmitCurrentRound).toBe(true);
    expect(view.rounds.find((round) => round.round === "round_2")?.detail).toBe("Round 2 opens Thursday.");
  });

  it("tells students to come back Thursday-Saturday after round 1 is complete", () => {
    const view = buildPartnerRecitationView({
      today: "2026-05-11",
      recitations: [{ round: "round_1", points: 75, submitted_at: "2026-05-11T12:00:00.000Z" }]
    });

    expect(view.currentRoundMessage).toBe("Round 1 completed. Come back Thursday–Saturday to complete Round 2.");
    expect(view.canSubmitCurrentRound).toBe(false);
  });

  it("shows round 1 closed copy when Thursday arrives without round 1", () => {
    const view = buildPartnerRecitationView({
      today: "2026-05-14",
      recitations: []
    });

    expect(view.currentRoundName).toBe("Round 2");
    expect(view.currentRoundMessage).toBe("Round 1 is closed. You can still complete Round 2.");
    expect(view.canSubmitCurrentRound).toBe(true);
    expect(view.rounds.find((round) => round.round === "round_1")?.status).toBe("closed");
  });

  it("shows both rounds complete when round 1 and round 2 are submitted", () => {
    const view = buildPartnerRecitationView({
      today: "2026-05-15",
      recitations: [
        { round: "round_1", points: 75, submitted_at: "2026-05-11T12:00:00.000Z" },
        { round: "round_2", points: 75, submitted_at: "2026-05-15T12:00:00.000Z" }
      ]
    });

    expect(view.currentRoundMessage).toBe("Both rounds are complete for this week.");
    expect(view.canSubmitCurrentRound).toBe(false);
  });
});
