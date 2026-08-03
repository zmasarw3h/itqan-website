import { describe, expect, it } from "vitest";
import {
  isSafeLoginRedirect,
  isSignInResult,
  loginErrorCodeForAuthError,
  loginErrorMessage,
  loginFailure
} from "@/lib/login-contract";

describe("login contract", () => {
  it("provides stable user-facing messages without provider details", () => {
    expect(loginErrorMessage("invalid_credentials")).toBe("The phone number or password is incorrect.");
    expect(loginErrorMessage("rate_limited")).toContain("Wait a few minutes");
    expect(loginErrorMessage("service_unavailable")).toBe("Sign-in is temporarily unavailable. Please try again.");
  });

  it("accepts only the expected response shapes and local redirects", () => {
    expect(isSignInResult({ ok: true, redirectTo: "/admin" })).toBe(true);
    expect(isSignInResult(loginFailure("invalid_credentials"))).toBe(true);
    expect(isSignInResult({ ok: false, error: { code: "provider_message" } })).toBe(false);
    expect(isSignInResult({ ok: true, redirectTo: "https://example.com" })).toBe(false);
    expect(isSafeLoginRedirect("/super-admin")).toBe(true);
    expect(isSafeLoginRedirect("//example.com")).toBe(false);
  });

  it("maps provider throttling and outages without exposing their messages", () => {
    expect(loginErrorCodeForAuthError({ status: 429, message: "provider detail" })).toBe("rate_limited");
    expect(loginErrorCodeForAuthError({ code: "over_request_rate_limit" })).toBe("rate_limited");
    expect(loginErrorCodeForAuthError({ status: 503 })).toBe("service_unavailable");
    expect(loginErrorCodeForAuthError({ status: 400, message: "Invalid login credentials" })).toBe(
      "invalid_credentials"
    );
  });
});
