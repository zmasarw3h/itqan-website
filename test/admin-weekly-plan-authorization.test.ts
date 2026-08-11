import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeAdminWeeklyPlan,
  type AdminWeeklyPlanRecord
} from "@/lib/admin-weekly-plan";
import {
  handleAdminWeeklyPlanRoute,
  type AdminWeeklyPlanRouteDependencies
} from "@/lib/admin-weekly-plan-route";
import { WEEKLY_PLAN_MAX_BYTES } from "@/lib/weekly-plans";

vi.mock("server-only", () => ({}));

const studentId = "11111111-1111-4111-8111-111111111111";
const otherStudentId = "22222222-2222-4222-8222-222222222222";
const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const masjidId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherMasjidId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const cohortId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherCohortId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const groupId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherGroupId = "99999999-9999-4999-8999-999999999999";
const weekStart = "2026-07-19";

const activeStudent = {
  id: studentId,
  role: "student" as const,
  active: true
};

const plan: AdminWeeklyPlanRecord = {
  id: "plan-id",
  student_id: studentId,
  week_start: weekStart,
  file_path: `${studentId}/${weekStart}/plan.pdf`,
  file_name: "plan.pdf",
  file_type: "application/pdf",
  file_size: 9,
  uploaded_at: "2026-07-19T12:00:00.000Z",
  masjid_id: masjidId,
  cohort_id: cohortId,
  halaqa_group_id: groupId
};

type QueryResponse = { data: unknown; error: { message: string } | null };

function query(response: QueryResponse) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    returns: vi.fn()
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(response);
  builder.returns.mockResolvedValue(response);

  return builder;
}

function makeSupabase(input?: {
  profile?: { id: string; role: string; active: boolean } | null;
  profileError?: { message: string } | null;
  plan?: AdminWeeklyPlanRecord | null;
  planError?: { message: string } | null;
  canManage?: boolean;
  scope?: { masjidId?: string | null; cohortId?: string | null; groupId?: string | null };
}) {
  const profileQuery = query({ data: input?.profile === undefined ? activeStudent : input.profile, error: input?.profileError ?? null });
  const planQuery = query({ data: input?.plan === undefined ? plan : input.plan, error: input?.planError ?? null });
  const calls: Array<{ name: string; args: Record<string, string> }> = [];
  const from = vi.fn((table: string) => {
    if (table === "profiles") return profileQuery;
    if (table === "weekly_plans") return planQuery;
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn((name: string, args: Record<string, string>) => {
    calls.push({ name, args });

    if (name === "can_admin_manage_student_for_week") {
      return Promise.resolve({ data: input?.canManage ?? true, error: null });
    }

    const scope = input?.scope ?? {};
    const values: Record<string, string | null | undefined> = {
      student_group_for_week: scope.groupId === undefined ? groupId : scope.groupId,
      student_cohort_for_week: scope.cohortId === undefined ? cohortId : scope.cohortId,
      student_masjid_for_week: scope.masjidId === undefined ? masjidId : scope.masjidId
    };

    return Promise.resolve({ data: values[name] ?? null, error: null });
  });

  return {
    supabase: { from, rpc },
    profileQuery,
    planQuery,
    from,
    rpc,
    calls
  };
}

function request() {
  return new NextRequest(`https://itqan.test/admin/students/${studentId}/weekly-plan/preview?week=${weekStart}`);
}

describe("authorizeAdminWeeklyPlan", () => {
  it.each(["application/pdf", "image/png", "image/jpeg"])(
    "accepts an active student with supported MIME %s at the positive maximum size",
    async (fileType) => {
      const expectedPlan = { ...plan, file_type: fileType, file_size: WEEKLY_PLAN_MAX_BYTES };
      const fake = makeSupabase({ plan: expectedPlan });
      const result = await authorizeAdminWeeklyPlan(fake.supabase as never, { studentId, weekStart });

      expect(result).toEqual({ status: "ok", plan: expectedPlan });
      expect(fake.profileQuery.eq).toHaveBeenCalledWith("role", "student");
      expect(fake.profileQuery.eq).toHaveBeenCalledWith("active", true);
      expect(fake.planQuery.eq).toHaveBeenCalledWith("student_id", studentId);
      expect(fake.planQuery.eq).toHaveBeenCalledWith("week_start", weekStart);
      expect(fake.calls).toEqual([
        { name: "can_admin_manage_student_for_week", args: { input_student_id: studentId, input_week_start: weekStart } },
        { name: "student_group_for_week", args: { input_student_id: studentId, input_week_start: weekStart } },
        { name: "student_cohort_for_week", args: { input_student_id: studentId, input_week_start: weekStart } },
        { name: "student_masjid_for_week", args: { input_student_id: studentId, input_week_start: weekStart } }
      ]);
    }
  );

  it.each([
    ["inactive", { id: studentId, role: "student", active: false }],
    ["non-student", { id: studentId, role: "teacher", active: true }]
  ] as const)("denies an %s target before scope or metadata reads", async (_label, profile) => {
    const fake = makeSupabase({ profile });
    const result = await authorizeAdminWeeklyPlan(fake.supabase as never, { studentId, weekStart });

    expect(result).toEqual({ status: "forbidden" });
    expect(fake.from).toHaveBeenCalledTimes(1);
    expect(fake.planQuery.maybeSingle).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("denies a target outside the active admin scope before metadata is read", async () => {
    const fake = makeSupabase({ canManage: false });
    const result = await authorizeAdminWeeklyPlan(fake.supabase as never, { studentId, weekStart });

    expect(result).toEqual({ status: "forbidden" });
    expect(fake.planQuery.maybeSingle).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-masjid scope", { scope: { masjidId: otherMasjidId } }],
    ["cross-cohort scope", { scope: { cohortId: otherCohortId } }],
    ["cross-group scope", { scope: { groupId: otherGroupId } }],
    ["cross-student metadata", { plan: { ...plan, student_id: otherStudentId } }],
    ["cross-masjid metadata", { plan: { ...plan, masjid_id: otherMasjidId } }],
    ["cross-cohort metadata", { plan: { ...plan, cohort_id: otherCohortId } }],
    ["cross-group metadata", { plan: { ...plan, halaqa_group_id: otherGroupId } }],
    ["missing metadata", { plan: null }],
    ["malformed substituted path", { plan: { ...plan, file_path: `${otherStudentId}/${weekStart}/plan.pdf` } }],
    ["parent traversal path", { plan: { ...plan, file_path: `${studentId}/${weekStart}/../plan.pdf` } }],
    ["nested path", { plan: { ...plan, file_path: `${studentId}/${weekStart}/nested/plan.pdf` } }],
    ["noncanonical path week", { plan: { ...plan, file_path: `${studentId}/2026-07-20/plan.pdf` } }],
    ["metadata filename mismatch", { plan: { ...plan, file_name: "other.pdf" } }],
    ["unsupported MIME", { plan: { ...plan, file_type: "image/gif" } }],
    ["empty file", { plan: { ...plan, file_size: 0 } }],
    ["oversized file", { plan: { ...plan, file_size: WEEKLY_PLAN_MAX_BYTES + 1 } }]
  ] as const)("denies %s", async (_label, input) => {
    const fake = makeSupabase(input);
    const result = await authorizeAdminWeeklyPlan(fake.supabase as never, { studentId, weekStart });

    expect(result.status).not.toBe("ok");
  });

  it("denies malformed or stale tracker context before any database lookup", async () => {
    const fake = makeSupabase();
    expect(await authorizeAdminWeeklyPlan(fake.supabase as never, { studentId, weekStart: "2026-07-20" })).toEqual({
      status: "not-found"
    });
    expect(fake.from).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe("route/storage boundary with the real authorizer", () => {
  it("denies an inactive target before creating the service-role Storage client", async () => {
    const fake = makeSupabase({ profile: { id: studentId, role: "student", active: false } });
    const getCurrentProfile = vi.fn().mockResolvedValue({
      user: { id: adminId },
      profile: {
        id: adminId,
        name: "Scoped admin",
        email: "admin@example.com",
        phone: null,
        role: "admin",
        active: true
      },
      supabase: fake.supabase
    });
    const createSupabaseAdminClient = vi.fn();
    const dependencies = {
      authorizeAdminWeeklyPlan,
      createSupabaseAdminClient,
      getCurrentProfile
    } as unknown as AdminWeeklyPlanRouteDependencies;

    const response = await handleAdminWeeklyPlanRoute(
      request(),
      Promise.resolve({ id: studentId }),
      "inline",
      dependencies
    );

    expect(response.status).toBe(403);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
