import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoginTiming } from "@/lib/login-timing";

const { createServerSupabaseClientMock, signInWithPasswordMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  signInWithPasswordMock: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock
}));

import { authenticateWithPhone } from "@/app/login/authenticate";

describe("phone authentication timing", () => {
  beforeEach(() => {
    createServerSupabaseClientMock.mockReset();
    signInWithPasswordMock.mockReset();
  });

  it("records identifier, password, and profile phase durations without changing the result", async () => {
    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn()
    };
    profileQuery.select.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);
    profileQuery.single.mockResolvedValue({
      data: {
        id: "profile-id",
        name: "Admin",
        email: "admin@example.com",
        phone: "+14165550100",
        role: "admin",
        active: true
      },
      error: null
    });
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "profile-id" } },
      error: null
    });
    createServerSupabaseClientMock.mockResolvedValue({
      auth: {
        signInWithPassword: signInWithPasswordMock,
        signOut: vi.fn()
      },
      from: vi.fn().mockReturnValue(profileQuery)
    });

    const timings = createLoginTiming();
    const result = await authenticateWithPhone("+14165550100", "assigned-password", timings);

    expect(result).toEqual({ ok: true, redirectTo: "/admin" });
    expect(timings.identifierAccountResolutionMs).toEqual(expect.any(Number));
    expect(timings.passwordAuthenticationMs).toEqual(expect.any(Number));
    expect(timings.profileRoleResolutionMs).toEqual(expect.any(Number));
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "14165550100@itqan.local",
      password: "assigned-password"
    });
  });
});
