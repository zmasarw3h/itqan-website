import type { AccountabilityObligation, Profile } from "@/lib/types";

export const ACCOUNTABILITY_GATE_COPY = {
  heading: "Confirm your sadaqa to unlock today's checklist",
  support:
    "Your score for a previous week was below 70%. Please confirm your required sadaqa before continuing today’s checklist.",
  requiredLabel: "Required sadaqa",
  question: "Have you paid the required sadaqa?",
  yesButton: "Yes, I paid the sadaqa",
  notYetButton: "Not yet",
  notYetMessage: "Your checklist will remain paused until sadaqa is confirmed."
};

export type AccountabilityGateObligation = Pick<
  AccountabilityObligation,
  "id" | "student_id" | "week_start" | "weekly_percentage" | "amount_cents" | "status"
>;

export function accountabilityObligationBlocksCheckIn(
  obligation: AccountabilityGateObligation | null | undefined,
  currentWeekStart: string
) {
  return Boolean(obligation && obligation.status === "pending" && obligation.week_start < currentWeekStart);
}

export function findBlockingAccountabilityObligation(
  obligations: AccountabilityGateObligation[],
  currentWeekStart: string
) {
  return (
    [...obligations]
      .filter((obligation) => accountabilityObligationBlocksCheckIn(obligation, currentWeekStart))
      .sort((a, b) => a.week_start.localeCompare(b.week_start))[0] ?? null
  );
}

export function canStudentAttestAccountabilityPaid(
  actor: Profile | null,
  obligation: AccountabilityGateObligation | null | undefined
) {
  return Boolean(
    actor?.active &&
      actor.role === "student" &&
      obligation &&
      obligation.student_id === actor.id &&
      obligation.status === "pending"
  );
}

export function routeIsAccountabilityGated(pathname: string) {
  return pathname === "/student/check-in";
}
