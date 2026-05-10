import { describe, expect, it } from "vitest";
import {
  hasExplicitCountryCode,
  normalizePhoneNumber,
  normalizedPhoneToAuthEmail,
  phoneDigits,
  phoneNumberToAuthEmail
} from "@/lib/phone-auth";

describe("phone auth helpers", () => {
  it("normalizes 10-digit Canada/US numbers with +1", () => {
    expect(normalizePhoneNumber("4165551234")).toBe("+14165551234");
    expect(normalizePhoneNumber("(416) 555-1234")).toBe("+14165551234");
  });

  it("preserves explicit country codes after stripping separators", () => {
    expect(normalizePhoneNumber("+1 (416) 555-1234")).toBe("+14165551234");
    expect(normalizePhoneNumber("+99 123 456 7890")).toBe("+991234567890");
  });

  it("converts normalized phone numbers into synthetic auth emails", () => {
    expect(phoneNumberToAuthEmail("4165551234")).toBe("14165551234@itqan.local");
    expect(normalizedPhoneToAuthEmail("+201116638874")).toBe("201116638874@itqan.local");
  });

  it("extracts local digits for server-side suffix matching", () => {
    expect(phoneDigits("1116638874")).toBe("1116638874");
    expect(phoneDigits("+20 1116638874")).toBe("201116638874");
    expect(hasExplicitCountryCode("+20 1116638874")).toBe(true);
    expect(hasExplicitCountryCode("1116638874")).toBe(false);
  });

  it("rejects invalid phone input", () => {
    expect(() => normalizePhoneNumber("555")).toThrow("valid");
    expect(() => normalizePhoneNumber("")).toThrow("Enter a phone number.");
  });
});
