import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  canAdminDeleteStudentMock,
  canAdminManageStudentForWeekMock,
  requireProfileMock,
  redirectMock
} = vi.hoisted(() => ({
  canAdminDeleteStudentMock: vi.fn(),
  canAdminManageStudentForWeekMock: vi.fn(),
  requireProfileMock: vi.fn(),
  redirectMock: vi.fn((location: string) => {
    const error = new Error(`Redirected to ${location}`);
    error.name = "RedirectSignal";
    Object.assign(error, { location });
    throw error;
  })
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-scope", () => ({
  assertAdminCanManageGroup: vi.fn(),
  assertAdminCanManageMasjid: vi.fn(),
  canAdminDeleteStudent: canAdminDeleteStudentMock,
  canAdminManageStudentForWeek: canAdminManageStudentForWeekMock,
  requireScopedAdmin: vi.fn()
}));
vi.mock("@/lib/admin-student-workspace", () => ({
  isAdminStudentWorkspaceView: (value: string | null | undefined) =>
    ["overview", "activity", "halaqa-plan", "corrections", "settings"].includes(value ?? "")
}));
vi.mock("@/lib/supabase-server", () => ({ requireProfile: requireProfileMock }));

import {
  correctCheckIn,
  correctPartnerRecitations,
  deleteStudent,
  saveHalaqaGrade
} from "@/app/admin/actions";

const studentId = "11111111-1111-4111-8111-111111111111";
const weekStart = "2026-07-19";
const adminProfile = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Admin",
  email: "admin@example.com",
  phone: null,
  role: "admin" as const,
  active: true
};

function makeSupabase(input?: { correctionError?: boolean; studentName?: string }) {
  const profileQuery: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn()
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);
  profileQuery.maybeSingle.mockResolvedValue({
    data: { id: studentId, name: input?.studentName ?? "Student One", role: "student" },
    error: null
  });

  return {
    from: vi.fn().mockReturnValue(profileQuery),
    rpc: vi.fn().mockResolvedValue(input?.correctionError ? { data: null, error: { message: "failed" } } : { data: null, error: null }),
    profileQuery
  };
}

function form(fields: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) result.set(key, value);
  return result;
}

async function expectDashboardRedirect(action: (data: FormData) => Promise<unknown>, data: FormData) {
  await expect(action(data)).rejects.toMatchObject({
    message: "Redirected to /admin?status=student-scope-denied"
  });
  expect(redirectMock).toHaveBeenLastCalledWith("/admin?status=student-scope-denied");
}

describe("admin student mutation redirect contracts", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    canAdminManageStudentForWeekMock.mockReset().mockResolvedValue(false);
    canAdminDeleteStudentMock.mockReset().mockResolvedValue(false);
  });

  it("sends scope loss to the safe admin dashboard for every protected student mutation", async () => {
    for (const [action, data] of [
      [correctCheckIn, form({ student_id: studentId, date: weekStart, status: "submitted", redirect_week: weekStart, redirect_view: "corrections" })],
      [correctPartnerRecitations, form({ student_id: studentId, week_start: weekStart, completed_rounds: "round_1", redirect_week: weekStart, redirect_view: "corrections" })],
      [saveHalaqaGrade, form({ student_id: studentId, week_start: weekStart, attended: "false", recitation_points: "0", redirect_week: weekStart, redirect_view: "halaqa-plan" })]
    ] as const) {
      const supabase = makeSupabase();
      requireProfileMock.mockResolvedValueOnce({ supabase, profile: adminProfile, user: { id: adminProfile.id } });
      await expectDashboardRedirect(action, data);
    }
  });

  it("sends student deletion scope loss to the dashboard for both authorization gates", async () => {
    const supabase = makeSupabase();
    requireProfileMock.mockResolvedValueOnce({ supabase, profile: adminProfile, user: { id: adminProfile.id } });
    await expectDashboardRedirect(
      deleteStudent,
      form({ student_id: studentId, confirmation_name: "Student One", redirect_week: weekStart, redirect_view: "settings" })
    );

    canAdminManageStudentForWeekMock.mockResolvedValueOnce(true);
    canAdminDeleteStudentMock.mockResolvedValueOnce(false);
    requireProfileMock.mockResolvedValueOnce({ supabase, profile: adminProfile, user: { id: adminProfile.id } });
    await expectDashboardRedirect(
      deleteStudent,
      form({ student_id: studentId, confirmation_name: "Student One", redirect_week: weekStart, redirect_view: "settings" })
    );
  });

  it("preserves week and section for an ordinary correction error while authorization remains valid", async () => {
    const supabase = makeSupabase({ correctionError: true });
    canAdminManageStudentForWeekMock.mockResolvedValue(true);
    requireProfileMock.mockResolvedValueOnce({ supabase, profile: adminProfile, user: { id: adminProfile.id } });

    await expect(correctCheckIn(form({
      student_id: studentId,
      date: weekStart,
      status: "submitted",
      redirect_week: weekStart,
      redirect_view: "corrections"
    }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}?status=correction-error&week=${weekStart}&view=corrections`
    });
  });

  it("preserves week and section for ordinary deletion validation errors", async () => {
    const supabase = makeSupabase();
    requireProfileMock.mockResolvedValueOnce({ supabase, profile: adminProfile, user: { id: adminProfile.id } });

    await expect(deleteStudent(form({
      student_id: studentId,
      confirmation_name: "Wrong Name",
      redirect_week: weekStart,
      redirect_view: "settings"
    }))).rejects.toMatchObject({
      location: `/admin/students/${studentId}?status=delete-name-mismatch&week=${weekStart}&view=settings`
    });
  });
});
