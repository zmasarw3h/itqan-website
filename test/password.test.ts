import { describe, expect, it } from "vitest";
import { validateNewPassword } from "@/lib/password";

describe("password validation", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validateNewPassword("short", "short")).toEqual({
      ok: false,
      error: "Password must be at least 8 characters."
    });
  });

  it("rejects mismatched passwords", () => {
    expect(validateNewPassword("itqan2026", "itqan2027")).toEqual({
      ok: false,
      error: "Passwords do not match."
    });
  });

  it("accepts matching passwords at least 8 characters long", () => {
    expect(validateNewPassword("itqan2026", "itqan2026")).toEqual({
      ok: true,
      password: "itqan2026"
    });
  });
});
