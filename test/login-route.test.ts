import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginFailure } from "@/lib/login-contract";

const { authenticateWithPhoneMock } = vi.hoisted(() => ({
  authenticateWithPhoneMock: vi.fn()
}));

vi.mock("@/app/login/authenticate", () => ({
  authenticateWithPhone: authenticateWithPhoneMock
}));

import { POST } from "@/app/api/login/route";

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

  it("returns a successful local redirect with no-store and request-id headers", async () => {
    authenticateWithPhoneMock.mockResolvedValue({ ok: true, redirectTo: "/admin" });

    const response = await POST(loginRequest(JSON.stringify({
      identifier: "4165550100",
      password: "assigned-password"
    })));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("test-request-id");
    await expect(response.json()).resolves.toEqual({ ok: true, redirectTo: "/admin" });

    const loggedEntry = vi.mocked(console.info).mock.calls[0];
    expect(JSON.stringify(loggedEntry)).not.toContain("4165550100");
    expect(JSON.stringify(loggedEntry)).not.toContain("assigned-password");
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
