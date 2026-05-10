import { describe, expect, it } from "vitest";
import { normalizePhoneNumber, phoneNumberToAuthEmail } from "@/lib/phone-auth";

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
  });

  it("rejects invalid phone input", () => {
    expect(() => normalizePhoneNumber("555")).toThrow("valid");
    expect(() => normalizePhoneNumber("")).toThrow("Enter a phone number.");
  });
});
