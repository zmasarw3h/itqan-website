import { addDays, isValidDateString } from "@/lib/dates";

export const PASSING_PERCENTAGE = 70;
export const REWARD_THRESHOLD_PERCENTAGE = 90;
export const ACCOUNTABILITY_STEP_PERCENTAGE = 10;
export const ACCOUNTABILITY_STEP_CENTS = 500;
export const ACCOUNTABILITY_OBLIGATIONS_START_WEEK = "2026-05-31";

function assertValidPercentage(weeklyPercentage: number) {
  if (!Number.isFinite(weeklyPercentage) || weeklyPercentage < 0 || weeklyPercentage > 100) {
    throw new Error("Weekly percentage must be between 0 and 100.");
  }
}

export function calculateAccountabilityAmountCents(weeklyPercentage: number): number {
  assertValidPercentage(weeklyPercentage);

  if (weeklyPercentage >= PASSING_PERCENTAGE) {
    return 0;
  }

  return (
    Math.ceil((PASSING_PERCENTAGE - weeklyPercentage) / ACCOUNTABILITY_STEP_PERCENTAGE) *
    ACCOUNTABILITY_STEP_CENTS
  );
}

export function calculateBadgeAwardCount(weeklyPercentage: number): number {
  assertValidPercentage(weeklyPercentage);

  return Math.max(0, Math.floor(weeklyPercentage) - REWARD_THRESHOLD_PERCENTAGE);
}

export function accountabilityAppliesToWeek(weekStart: string) {
  return weekStart >= ACCOUNTABILITY_OBLIGATIONS_START_WEEK;
}

export function incentiveWeekIsEligible(weekStart: string, today: string): boolean {
  if (!isValidDateString(weekStart) || !isValidDateString(today)) {
    throw new Error("Invalid date.");
  }

  return addDays(weekStart, 6) < today;
}

export function formatAmountCents(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("Amount cents must be a non-negative integer.");
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amountCents / 100);
}
