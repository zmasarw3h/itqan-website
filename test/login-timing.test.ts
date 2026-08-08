import { describe, expect, it } from "vitest";
import { createLoginTiming, formatLoginServerTiming } from "@/lib/login-timing";

describe("login timing instrumentation", () => {
  it("formats only measured phase durations for Server-Timing", () => {
    const timings = createLoginTiming();
    timings.totalRequestMs = 42;
    timings.identifierAccountResolutionMs = 7;
    timings.passwordAuthenticationMs = 21;

    expect(formatLoginServerTiming(timings)).toBe(
      "login-total;dur=42, login-identifier;dur=7, login-password;dur=21"
    );
  });

  it("starts with no account or credential data in the timing fields", () => {
    expect(createLoginTiming()).toEqual({
      totalRequestMs: null,
      identifierAccountResolutionMs: null,
      passwordAuthenticationMs: null,
      profileRoleResolutionMs: null
    });
  });
});
