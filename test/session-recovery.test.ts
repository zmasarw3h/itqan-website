import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { recoverFromStaleSession } from "@/proxy";
import {
  isStaleRefreshTokenError,
  isSupabaseAuthCookieName
} from "@/lib/session-recovery";

describe("Supabase session recovery", () => {
  it("recognizes base, chunked, and PKCE auth cookies", () => {
    expect(isSupabaseAuthCookieName("sb-project-auth-token")).toBe(true);
    expect(isSupabaseAuthCookieName("sb-project-auth-token.0")).toBe(true);
    expect(isSupabaseAuthCookieName("sb-project-auth-token-code-verifier")).toBe(true);
  });

  it("does not clear unrelated cookies", () => {
    expect(isSupabaseAuthCookieName("theme")).toBe(false);
    expect(isSupabaseAuthCookieName("sb-project-preferences")).toBe(false);
  });

  it("recognizes stale refresh-token responses by code or message", () => {
    expect(isStaleRefreshTokenError({ code: "refresh_token_not_found" })).toBe(true);
    expect(isStaleRefreshTokenError({ code: "refresh_token_already_used" })).toBe(true);
    expect(
      isStaleRefreshTokenError({
        message: "Invalid Refresh Token: Refresh Token Not Found"
      })
    ).toBe(true);
    expect(
      isStaleRefreshTokenError({
        code: "validation_failed",
        message: "Refresh token is not valid"
      })
    ).toBe(true);
  });

  it("does not mask unrelated authentication or runtime errors", () => {
    expect(isStaleRefreshTokenError({ code: "invalid_credentials" })).toBe(false);
    expect(isStaleRefreshTokenError(new Error("network unavailable"))).toBe(false);
  });

  it("clears only Supabase auth cookies and redirects page requests to login", () => {
    const request = new NextRequest("https://www.itqan.website/student/check-in", {
      headers: {
        cookie: "sb-project-auth-token.0=stale; sb-project-auth-token.1=session; theme=dark"
      }
    });

    const response = recoverFromStaleSession(request);

    expect(response.headers.get("location")).toBe(
      "https://www.itqan.website/login?status=session-expired"
    );
    expect(request.cookies.get("sb-project-auth-token.0")).toBeUndefined();
    expect(request.cookies.get("sb-project-auth-token.1")).toBeUndefined();
    expect(request.cookies.get("theme")?.value).toBe("dark");
    expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token.0=");
    expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token.1=");
    expect(response.headers.get("set-cookie")).not.toContain("theme=");
  });

  it("clears a stale login session without causing a redirect loop", () => {
    const request = new NextRequest("https://www.itqan.website/login", {
      headers: { cookie: "sb-project-auth-token=stale" }
    });

    const response = recoverFromStaleSession(request);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token=");
  });
});
