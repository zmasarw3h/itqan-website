import { describe, expect, it } from "vitest";
import {
  calculateAccountabilityAmountCents,
  calculateBadgeAwardCount,
  formatAmountCents,
  incentiveWeekIsEligible
} from "@/lib/incentives";

describe("weekly incentive calculations", () => {
  it("calculates accountability amount only below 70 percent", () => {
    expect(calculateAccountabilityAmountCents(70)).toBe(0);
    expect(calculateAccountabilityAmountCents(70.01)).toBe(0);
    expect(calculateAccountabilityAmountCents(69)).toBe(500);
    expect(calculateAccountabilityAmountCents(60)).toBe(500);
    expect(calculateAccountabilityAmountCents(59)).toBe(1000);
    expect(calculateAccountabilityAmountCents(50)).toBe(1000);
    expect(calculateAccountabilityAmountCents(0)).toBe(3500);
  });

  it("calculates badge awards only above 90 percent", () => {
    expect(calculateBadgeAwardCount(90)).toBe(0);
    expect(calculateBadgeAwardCount(90.99)).toBe(0);
    expect(calculateBadgeAwardCount(91)).toBe(1);
    expect(calculateBadgeAwardCount(95)).toBe(5);
    expect(calculateBadgeAwardCount(100)).toBe(10);
  });

  it("rejects weekly percentages outside the persisted range", () => {
    expect(() => calculateAccountabilityAmountCents(-1)).toThrow("between 0 and 100");
    expect(() => calculateBadgeAwardCount(101)).toThrow("between 0 and 100");
  });

  it("detects completed incentive-eligible weeks", () => {
    expect(incentiveWeekIsEligible("2026-05-24", "2026-05-30")).toBe(false);
    expect(incentiveWeekIsEligible("2026-05-24", "2026-05-31")).toBe(true);
  });

  it("formats cents as dollars", () => {
    expect(formatAmountCents(500)).toBe("$5");
    expect(formatAmountCents(550)).toBe("$5.50");
  });
});
