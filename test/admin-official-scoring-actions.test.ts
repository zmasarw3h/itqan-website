import { beforeEach, describe, expect, it, vi } from "vitest";

const { canManage, redirect, requireAdmin } = vi.hoisted(() => ({
  canManage: vi.fn(),
  requireAdmin: vi.fn(),
  redirect: vi.fn((location: string) => {
    const error = new Error(`Redirected to ${location}`);
    Object.assign(error, { location });
    throw error;
  })
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-scope", () => ({
  canAdminManageStudentForWeek: canManage,
  requireScopedAdmin: requireAdmin
}));

import { applyOfficialScoringStart, reviewOfficialScoringStart } from "@/app/admin/students/[id]/official-scoring/actions";

const studentId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const returnWeek = "2026-08-09";
const proposed = "2026-08-16";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function preview() {
  return {
    student_id: studentId,
    student_name: "Student One",
    actor_role: "admin",
    old_score_starts_on: "2026-01-04",
    new_score_starts_on: proposed,
    earliest_access_starts_on: "2025-12-01",
    earliest_valid_score_start: "2025-12-07",
    direction: "forward",
    affected_week_starts: [returnWeek],
    pending_obligations: [],
    pending_obligation_count: 0,
    pending_amount_cents: 0
  };
}

function auth(input?: { rpcError?: { code: string }; name?: string }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq"]) query[method] = vi.fn(() => query);
  query.single = vi.fn().mockResolvedValue({
    data: { id: studentId, name: input?.name ?? "Student One", role: "student", score_starts_on: "2026-01-04" },
    error: null
  });
  return {
    supabase: {},
    profile: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "admin" },
    adminSupabase: {
      from: vi.fn(() => query),
      rpc: vi.fn().mockResolvedValue(input?.rpcError ? { data: null, error: input.rpcError } : { data: preview(), error: null })
    }
  };
}

const returnFields = { return_week: returnWeek, return_view: "settings" };

describe("official scoring guarded workflow", () => {
  beforeEach(() => {
    redirect.mockClear();
    canManage.mockReset().mockResolvedValue(true);
    requireAdmin.mockReset().mockResolvedValue(auth());
  });

  it("rejects a non-Sunday before loading privileged scope and preserves return state", async () => {
    await expect(reviewOfficialScoringStart(form({ student_id: studentId, score_starts_on: "2026-08-17", ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}/official-scoring?status=invalid-date&return_week=${returnWeek}&return_view=settings`
    });
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("maps access-eligibility preview rejection to invalid-date", async () => {
    requireAdmin.mockResolvedValue(auth({ rpcError: { code: "22023" } }));
    await expect(reviewOfficialScoringStart(form({ student_id: studentId, score_starts_on: proposed, ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}/official-scoring?status=invalid-date&return_week=${returnWeek}&return_view=settings`
    });
  });

  it("opens a current impact preview without mutation and retains return state", async () => {
    await expect(reviewOfficialScoringStart(form({ student_id: studentId, score_starts_on: proposed, ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}/official-scoring?proposed=${proposed}&return_week=${returnWeek}&return_view=settings`
    });
    const scoped = await requireAdmin.mock.results[0]?.value;
    expect(scoped.adminSupabase.rpc).toHaveBeenCalledWith("preview_official_scoring_start_change", expect.any(Object));
  });

  it("requires a reason before attempting the mutation", async () => {
    await expect(applyOfficialScoringStart(form({ student_id: studentId, request_id: requestId, score_starts_on: proposed, expected_score_starts_on: "2026-01-04", reason: "no", confirmation_name: "Student One", ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}/official-scoring?proposed=${proposed}&status=invalid&return_week=${returnWeek}&return_view=settings`
    });
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it.each(["     ", "x".repeat(501)])("rejects a crafted invalid reason server-side", async (reason) => {
    await expect(applyOfficialScoringStart(form({ student_id: studentId, request_id: requestId, score_starts_on: proposed, expected_score_starts_on: "2026-01-04", reason, confirmation_name: "Student One", ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}/official-scoring?proposed=${proposed}&status=invalid&return_week=${returnWeek}&return_view=settings`
    });
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("requires exact-name confirmation", async () => {
    await expect(applyOfficialScoringStart(form({ student_id: studentId, request_id: requestId, score_starts_on: proposed, expected_score_starts_on: "2026-01-04", reason: "Approved boundary change", confirmation_name: "Wrong", ...returnFields }))).rejects.toMatchObject({
      location: expect.stringContaining("status=confirmation-mismatch")
    });
  });

  it("surfaces stale-preview protection without changing return state", async () => {
    requireAdmin.mockResolvedValue(auth({ rpcError: { code: "P0001" } }));
    await expect(applyOfficialScoringStart(form({ student_id: studentId, request_id: requestId, score_starts_on: proposed, expected_score_starts_on: "2026-01-04", reason: "Approved boundary change", confirmation_name: "Student One", ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}/official-scoring?proposed=${proposed}&status=stale&return_week=${returnWeek}&return_view=settings`
    });
  });

  it("returns successful confirmation to the selected settings workspace", async () => {
    await expect(applyOfficialScoringStart(form({ student_id: studentId, request_id: requestId, score_starts_on: proposed, expected_score_starts_on: "2026-01-04", reason: "Approved boundary change", confirmation_name: "Student One", ...returnFields }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}?week=${returnWeek}&view=settings&status=score-start-changed`
    });
  });
});
