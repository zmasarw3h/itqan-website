import { describe, expect, it } from "vitest";
import { formatLoginIdentifier } from "@/lib/phone-input";

describe("login phone formatting", () => {
  it("formats Canadian numbers as the user types", () => {
    expect(formatLoginIdentifier("4")).toBe("4");
    expect(formatLoginIdentifier("4165550100")).toBe("(416) 555-0100");
  });

  it("formats a leading North American country code", () => {
    expect(formatLoginIdentifier("14165550100")).toBe("1 (416) 555-0100");
  });

  it("adapts to explicit international country codes", () => {
    expect(formatLoginIdentifier("+442079460958")).toBe("+44 20 7946 0958");
    expect(formatLoginIdentifier("+201060901044")).toBe("+20 10 60901044");
  });

  it("normalizes pasted phone punctuation without changing the number", () => {
    expect(formatLoginIdentifier("(416) 555-0100")).toBe("(416) 555-0100");
    expect(formatLoginIdentifier("+44 (20) 7946-0958")).toBe("+44 20 7946 0958");
  });

  it("preserves the existing email identifier fallback", () => {
    expect(formatLoginIdentifier("admin@example.com")).toBe("admin@example.com");
  });
});
