import { isValidDateString, weekStartForDate } from "@/lib/dates";

export type OfficialScoringChangeDirection = "activate" | "forward" | "backward" | "unchanged";

// This value has appeared in deployed profile rows, but it is not an
// application-defined default. The schema contract says null means
// "not scorable yet" and every legitimate boundary must be an eligible
// canonical Sunday. Keep the raw value for the guarded workflow, while making
// the read/display contract explicit for admin surfaces.
export const LEGACY_OFFICIAL_SCORING_SENTINEL = "1900-01-07";

export type OfficialScoringChangePreview = {
  student_id: string;
  student_name: string;
  actor_role: "admin" | "super_admin";
  old_score_starts_on: string | null;
  new_score_starts_on: string;
  earliest_access_starts_on: string;
  earliest_valid_score_start: string;
  direction: OfficialScoringChangeDirection;
  affected_week_starts: string[];
  pending_obligations: Array<{
    id: string;
    week_start: string;
    amount_cents: number;
  }>;
  pending_obligation_count: number;
  pending_amount_cents: number;
};

export function isCanonicalScoringSunday(value: string | null | undefined): value is string {
  return Boolean(value && isValidDateString(value) && weekStartForDate(value) === value);
}

export function isLegacyOfficialScoringBoundary(
  value: string | null | undefined
): value is typeof LEGACY_OFFICIAL_SCORING_SENTINEL {
  return value === LEGACY_OFFICIAL_SCORING_SENTINEL;
}

export function displayOfficialScoringBoundary(value: string | null | undefined) {
  if (!value) return "Not scorable yet";
  if (isLegacyOfficialScoringBoundary(value)) return "Legacy value — review required";
  return value;
}

export function parseOfficialScoringChangePreview(value: unknown): OfficialScoringChangePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Partial<OfficialScoringChangePreview>;
  const directions = new Set<OfficialScoringChangeDirection>(["activate", "forward", "backward", "unchanged"]);

  if (
    typeof candidate.student_id !== "string"
    || typeof candidate.student_name !== "string"
    || (candidate.actor_role !== "admin" && candidate.actor_role !== "super_admin")
    || (candidate.old_score_starts_on !== null && !isCanonicalScoringSunday(candidate.old_score_starts_on))
    || !isCanonicalScoringSunday(candidate.new_score_starts_on)
    || !isValidDateString(candidate.earliest_access_starts_on ?? "")
    || !isCanonicalScoringSunday(candidate.earliest_valid_score_start)
    || !candidate.direction
    || !directions.has(candidate.direction)
    || !Array.isArray(candidate.affected_week_starts)
    || !candidate.affected_week_starts.every(isCanonicalScoringSunday)
    || !Array.isArray(candidate.pending_obligations)
    || !candidate.pending_obligations.every(
      (obligation) =>
        Boolean(
          obligation
          && typeof obligation.id === "string"
          && isCanonicalScoringSunday(obligation.week_start)
          && Number.isInteger(obligation.amount_cents)
          && obligation.amount_cents >= 0
        )
    )
    || !Number.isInteger(candidate.pending_obligation_count)
    || (candidate.pending_obligation_count ?? -1) < 0
    || !Number.isInteger(candidate.pending_amount_cents)
    || (candidate.pending_amount_cents ?? -1) < 0
  ) {
    return null;
  }

  return candidate as OfficialScoringChangePreview;
}

export function officialScoringStatus(scoreStartsOn: string | null | undefined, currentWeekStart: string) {
  if (!scoreStartsOn) {
    return {
      state: "orientation" as const,
      label: "Orientation",
      description: "Official scoring has not started."
    };
  }

  if (isLegacyOfficialScoringBoundary(scoreStartsOn)) {
    return {
      state: "legacy" as const,
      label: "Legacy boundary — review required",
      description: "A legacy scoring boundary is stored. Treat its date as unknown until an administrator reviews it; saved activity is not changed by this display status."
    };
  }

  if (scoreStartsOn > currentWeekStart) {
    return {
      state: "scheduled" as const,
      label: `Starts ${scoreStartsOn}`,
      description: "Orientation access remains available until this official scoring week."
    };
  }

  return {
    state: "active" as const,
    label: `Active since ${scoreStartsOn}`,
    description: "This student is included in official scores and accountability."
  };
}
