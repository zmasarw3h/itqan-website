import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginFailure, type SignInResult } from "@/lib/login-contract";
import type { LoginTimingFields } from "@/lib/login-timing";

const { authenticateWithPhoneMock } = vi.hoisted(() => ({
  authenticateWithPhoneMock: vi.fn()
}));

vi.mock("@/app/login/authenticate", () => ({
  authenticateWithPhone: authenticateWithPhoneMock
}));

import { POST } from "@/app/api/login/route";

const FULL_PHASE_TIMINGS: Omit<LoginTimingFields, "totalRequestMs"> = {
  identifierAccountResolutionMs: 11,
  passwordAuthenticationMs: 22,
  profileRoleResolutionMs: 33
};

function mockAuthenticationWithTimings(result: SignInResult) {
  authenticateWithPhoneMock.mockImplementation(async (
    _identifier: string,
    _password: string,
    timings?: LoginTimingFields
  ) => {
    if (timings) {
      Object.assign(timings, FULL_PHASE_TIMINGS);
    }

    return result;
  });
}

function expectPrivacySafeTimingLog(loggedEntry: unknown) {
  expect(loggedEntry).toMatchObject({
    totalRequestMs: expect.any(Number),
    ...FULL_PHASE_TIMINGS
  });

  const serializedEntry = JSON.stringify(loggedEntry);
  for (const privateValue of [
    "4165550100",
    "assigned-password",
    "profile-id",
    "admin@example.com",
    "+14165550100",
    "Admin"
  ]) {
    expect(serializedEntry).not.toContain(privateValue);
  }
}

function expectTotalOnlyServerTiming(response: Response) {
  const serverTiming = response.headers.get("server-timing");
  expect(serverTiming).toMatch(/^login-total;dur=\d+$/);
  expect(serverTiming).not.toContain("login-identifier");
  expect(serverTiming).not.toContain("login-password");
  expect(serverTiming).not.toContain("login-profile");
  for (const privateValue of ["4165550100", "assigned-password", "profile-id", "admin@example.com"]) {
    expect(serverTiming).not.toContain(privateValue);
  }
}

function loginRequest(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/login", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "x-vercel-id": "test-request-id"
    },
    body
  });
}

describe("login route", () => {
  beforeEach(() => {
    authenticateWithPhoneMock.mockReset();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects malformed and incomplete requests before authentication", async () => {
    const malformed = await POST(loginRequest("not-json", "text/plain"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual(loginFailure("invalid_request"));

    const incomplete = await POST(loginRequest(JSON.stringify({ identifier: "4165550100" })));
    expect(incomplete.status).toBe(400);
    await expect(incomplete.json()).resolves.toEqual(loginFailure("invalid_request"));
    expect(authenticateWithPhoneMock).not.toHaveBeenCalled();
  });

  it("returns a successful local redirect with no-store, request-id, and timing headers", async () => {
    mockAuthenticationWithTimings({ ok: true, redirectTo: "/admin" });

    const response = await POST(loginRequest(JSON.stringify({
      identifier: "4165550100",
      password: "assigned-password"
    })));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("test-request-id");
    expectTotalOnlyServerTiming(response);
    await expect(response.json()).resolves.toEqual({ ok: true, redirectTo: "/admin" });

    expectPrivacySafeTimingLog(vi.mocked(console.info).mock.calls[0]?.[0]);
  });

  it.each([
    ["invalid_credentials", 401, "info"],
    ["service_unavailable", 503, "error"]
  ] as const)("exposes only total timing and retains full server timings on %s", async (code, status, logger) => {
    mockAuthenticationWithTimings(loginFailure(code));

    const response = await POST(loginRequest(JSON.stringify({
      identifier: "4165550100",
      password: "assigned-password"
    })));

    expect(response.status).toBe(status);
    expectTotalOnlyServerTiming(response);
    await expect(response.json()).resolves.toEqual(loginFailure(code));

    const loggedEntry = logger === "error"
      ? vi.mocked(console.error).mock.calls[0]?.[0]
      : vi.mocked(console.info).mock.calls[0]?.[0];
    expectPrivacySafeTimingLog(loggedEntry);
  });

  it.each([
    ["invalid_identifier", 400],
    ["ambiguous_identifier", 400],
    ["invalid_credentials", 401],
    ["inactive_account", 401],
    ["rate_limited", 429],
    ["service_unavailable", 503]
  ] as const)("maps %s to HTTP %s", async (code, status) => {
    authenticateWithPhoneMock.mockResolvedValue(loginFailure(code));

    const response = await POST(loginRequest(JSON.stringify({
      identifier: "4165550100",
      password: "assigned-password"
    })));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(loginFailure(code));
  });

  it("contains unexpected authentication failures as a service outage", async () => {
    authenticateWithPhoneMock.mockRejectedValue(new Error("private provider detail"));

    const response = await POST(loginRequest(JSON.stringify({
      identifier: "4165550100",
      password: "assigned-password"
    })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(loginFailure("service_unavailable"));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private provider detail");
  });
});
