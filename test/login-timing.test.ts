import { describe, expect, it } from "vitest";
import { createLoginTiming, formatLoginServerTiming } from "@/lib/login-timing";

describe("login timing instrumentation", () => {
  it("formats only the total duration for browser-visible Server-Timing", () => {
    const timings = createLoginTiming();
    timings.totalRequestMs = 42;
    timings.identifierAccountResolutionMs = 7;
    timings.passwordAuthenticationMs = 21;
    timings.profileRoleResolutionMs = 13;

    expect(formatLoginServerTiming(timings)).toBe("login-total;dur=42");
  });

  it("does not emit a browser timing header before the total is measured", () => {
    expect(formatLoginServerTiming(createLoginTiming())).toBe("");
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
