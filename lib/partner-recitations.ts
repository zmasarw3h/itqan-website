import type { PartnerRecitation } from "@/lib/types";
import { partnerRoundForDate, PARTNER_RECITATION_POINTS_PER_ROUND, type PartnerRound } from "@/lib/scoring";

export function assertNoDuplicatePartnerRecitation(existing: Pick<PartnerRecitation, "student_id" | "week_start" | "round"> | null) {
  if (existing) {
    throw new Error("A partner recitation already exists for this student, week, and round.");
  }
}

export const PARTNER_RECITATION_ROUNDS: readonly PartnerRound[] = ["round_1", "round_2"];

export function isPartnerRecitationRound(value: FormDataEntryValue | null): value is PartnerRound {
  return typeof value === "string" && PARTNER_RECITATION_ROUNDS.includes(value as PartnerRound);
}

export function parsePartnerRecitationRounds(values: FormDataEntryValue[]) {
  const rounds = new Set<PartnerRound>();

  for (const value of values) {
    if (!isPartnerRecitationRound(value)) {
      throw new Error("Invalid partner recitation round.");
    }

    rounds.add(value);
  }

  return PARTNER_RECITATION_ROUNDS.filter((round) => rounds.has(round));
}

export function partnerRecitationPayloads(input: {
  studentId: string;
  weekStart: string;
  rounds: Iterable<PartnerRound>;
}) {
  return [...new Set(input.rounds)].map((round) => ({
    student_id: input.studentId,
    week_start: input.weekStart,
    round,
    points: PARTNER_RECITATION_POINTS_PER_ROUND
  }));
}

export type PartnerRoundStatus = "completed" | "open" | "closed" | "not_completed";

export type PartnerRecitationView = {
  currentRound: PartnerRound;
  currentRoundName: string;
  currentRoundRange: string;
  currentRoundStatus: PartnerRoundStatus;
  currentRoundStatusLabel: string;
  currentRoundMessage: string;
  canSubmitCurrentRound: boolean;
  rounds: Array<{
    round: PartnerRound;
    name: string;
    range: string;
    status: PartnerRoundStatus;
    statusLabel: string;
    detail: string;
    submittedAt?: string;
    points?: number;
  }>;
};

const ROUND_META: Record<PartnerRound, { name: string; range: string }> = {
  round_1: { name: "Round 1", range: "Sunday–Wednesday" },
  round_2: { name: "Round 2", range: "Thursday–Saturday" }
};

function statusLabel(status: PartnerRoundStatus) {
  if (status === "not_completed") return "Not completed";
  return status[0].toUpperCase() + status.slice(1);
}

export function buildPartnerRecitationView(input: {
  today: string;
  recitations: Iterable<Pick<PartnerRecitation, "round" | "submitted_at" | "points">>;
}): PartnerRecitationView {
  const currentRound = partnerRoundForDate(input.today);
  const recitationByRound = new Map([...input.recitations].map((recitation) => [recitation.round, recitation]));
  const round1 = recitationByRound.get("round_1");
  const round2 = recitationByRound.get("round_2");
  const rounds = (["round_1", "round_2"] as const).map((round) => {
    const recitation = recitationByRound.get(round);
    let status: PartnerRoundStatus = "not_completed";

    if (recitation) {
      status = "completed";
    } else if (round === currentRound) {
      status = "open";
    } else if (round === "round_1" && currentRound === "round_2") {
      status = "closed";
    }

    let detail = "";

    if (round === "round_2" && status === "not_completed" && currentRound === "round_1") {
      detail = "Round 2 opens Thursday.";
    }

    return {
      round,
      name: ROUND_META[round].name,
      range: ROUND_META[round].range,
      status,
      statusLabel: statusLabel(status),
      detail,
      submittedAt: recitation?.submitted_at,
      points: recitation?.points
    };
  });
  const currentRoundView = rounds.find((round) => round.round === currentRound);

  if (!currentRoundView) {
    throw new Error("Unable to resolve current partner recitation round.");
  }

  let currentRoundMessage = `${currentRoundView.name} is open`;

  if (round1 && !round2 && currentRound === "round_1") {
    currentRoundMessage = "Round 1 completed. Come back Thursday–Saturday to complete Round 2.";
  } else if (!round1 && currentRound === "round_2") {
    currentRoundMessage = "Round 1 is closed. You can still complete Round 2.";
  } else if (round1 && round2) {
    currentRoundMessage = "Both rounds are complete for this week.";
  } else if (round1 && currentRound === "round_1") {
    currentRoundMessage = "Round 2 opens Thursday.";
  }

  return {
    currentRound,
    currentRoundName: currentRoundView.name,
    currentRoundRange: currentRoundView.range,
    currentRoundStatus: currentRoundView.status,
    currentRoundStatusLabel: currentRoundView.statusLabel,
    currentRoundMessage,
    canSubmitCurrentRound: currentRoundView.status === "open",
    rounds
  };
}
