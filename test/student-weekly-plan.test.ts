import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeStudentWeeklyPlan,
  type StudentWeeklyPlanRecord
} from "@/lib/student-weekly-plan";
import {
  handleStudentWeeklyPlanRoute,
  type StudentWeeklyPlanRouteDependencies
} from "@/lib/student-weekly-plan-route";

vi.mock("server-only", () => ({}));

const studentId = "11111111-1111-4111-8111-111111111111";
const otherStudentId = "22222222-2222-4222-8222-222222222222";
const weekStart = "2026-08-09";

const plan: StudentWeeklyPlanRecord = {
  id: "plan-id",
  student_id: studentId,
  week_start: weekStart,
  file_path: `${studentId}/${weekStart}/plan.pdf`,
  file_name: "plan.pdf",
  file_type: "application/pdf",
  file_size: 9,
  uploaded_at: "2026-08-09T12:00:00.000Z"
};

function request(week = weekStart) {
  return new NextRequest(`https://itqan.test/student/weekly-plan/preview?week=${week}`);
}

function makeDependencies(input?: {
  user?: { id: string } | null;
  profile?: { id: string; role: string; active: boolean } | null;
  authorization?: { status: "not-found" } | { status: "ok"; plan: StudentWeeklyPlanRecord };
  file?: Blob | null;
}) {
  const file = input?.file === undefined
    ? new Blob(["pdf-bytes"], { type: "application/pdf" })
    : input.file;
  const download = vi.fn().mockResolvedValue({
    data: file,
    error: file ? null : { message: "missing" }
  });
  const from = vi.fn().mockReturnValue({ download });
  const authorizeStudentWeeklyPlan = vi.fn().mockResolvedValue(
    input?.authorization ?? { status: "ok", plan }
  );
  const getCurrentProfile = vi.fn().mockResolvedValue({
    user: input?.user === undefined ? { id: studentId } : input.user,
    profile: input?.profile === undefined
      ? { id: studentId, name: "Student", email: "student@example.com", role: "student", active: true }
      : input.profile,
    supabase: {}
  });
  const createSupabaseAdminClient = vi.fn().mockReturnValue({ storage: { from } });
  const currentWeeklyPlanContext = vi.fn().mockReturnValue({ effectiveDate: "2026-08-14", weekStart });

  return {
    deps: {
      authorizeStudentWeeklyPlan,
      createSupabaseAdminClient,
      currentWeeklyPlanContext,
      getCurrentProfile
    } as unknown as StudentWeeklyPlanRouteDependencies,
    authorizeStudentWeeklyPlan,
    createSupabaseAdminClient,
    download,
    getCurrentProfile
  };
}

describe("student weekly-plan proxy route", () => {
  it("streams an authenticated owner's PDF inline with private no-store headers", async () => {
    const dependencies = makeDependencies();
    const response = await handleStudentWeeklyPlanRoute(request(), "inline", dependencies.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="plan.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBe("9");
    expect(dependencies.download).toHaveBeenCalledWith(plan.file_path);
  });

  it("streams an authenticated owner's supported image with its stored MIME type", async () => {
    const imagePlan = {
      ...plan,
      file_path: `${studentId}/${weekStart}/plan.png`,
      file_name: "plan.png",
      file_type: "image/png",
      file_size: 11
    } satisfies StudentWeeklyPlanRecord;
    const dependencies = makeDependencies({
      authorization: { status: "ok", plan: imagePlan },
      file: new Blob(["image-bytes"], { type: "image/png" })
    });
    const response = await handleStudentWeeklyPlanRoute(request(), "inline", dependencies.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="plan.png"');
  });

  it("keeps attachment download disposition separate from inline preview", async () => {
    const dependencies = makeDependencies();
    const response = await handleStudentWeeklyPlanRoute(request(), "attachment", dependencies.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="plan.pdf"');
  });

  it.each([
    ["unauthenticated", { user: null, profile: null }],
    ["inactive", { profile: { id: studentId, role: "student", active: false } }],
    ["wrong role", { profile: { id: studentId, role: "admin", active: true } }]
  ] as const)("rejects %s before metadata or Storage access", async (_label, input) => {
    const dependencies = makeDependencies(input);
    const response = await handleStudentWeeklyPlanRoute(request(), "inline", dependencies.deps);

    expect(response.status).toBe("user" in input && input.user === null ? 401 : 403);
    expect(dependencies.authorizeStudentWeeklyPlan).not.toHaveBeenCalled();
    expect(dependencies.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a wrong operational week before reading metadata", async () => {
    const dependencies = makeDependencies();
    const response = await handleStudentWeeklyPlanRoute(request("2026-08-02"), "inline", dependencies.deps);

    expect(response.status).toBe(404);
    expect(dependencies.authorizeStudentWeeklyPlan).not.toHaveBeenCalled();
  });

  it("does not stream cross-student, malformed, missing, or size-mismatched plans", async () => {
    const crossStudent = makeDependencies({
      authorization: { status: "ok", plan: { ...plan, student_id: otherStudentId } }
    });
    const crossStudentResponse = await handleStudentWeeklyPlanRoute(request(), "inline", crossStudent.deps);
    expect(crossStudentResponse.status).toBe(404);
    expect(crossStudent.createSupabaseAdminClient).not.toHaveBeenCalled();

    const missing = makeDependencies({ authorization: { status: "not-found" } });
    const missingResponse = await handleStudentWeeklyPlanRoute(request(), "inline", missing.deps);
    expect(missingResponse.status).toBe(404);
    expect(missing.createSupabaseAdminClient).not.toHaveBeenCalled();

    const mismatch = makeDependencies({ file: new Blob(["wrong"], { type: "application/pdf" }) });
    const mismatchResponse = await handleStudentWeeklyPlanRoute(request(), "inline", {
      ...mismatch.deps,
      authorizeStudentWeeklyPlan: vi.fn().mockResolvedValue({ status: "ok", plan })
    } as StudentWeeklyPlanRouteDependencies);
    expect(mismatchResponse.status).toBe(404);
    expect(mismatch.createSupabaseAdminClient).toHaveBeenCalled();
  });
});

function query(response: { data: unknown; error: { message: string } | null }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn()
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(response);
  return builder;
}

describe("student weekly-plan metadata authorization", () => {
  it("reads only the caller's exact current-week row and rejects substituted ownership/path metadata", async () => {
    const planQuery = query({ data: { ...plan, student_id: otherStudentId }, error: null });
    const fake = { from: vi.fn().mockReturnValue(planQuery) };
    const result = await authorizeStudentWeeklyPlan(fake as never, { studentId, weekStart });

    expect(result).toEqual({ status: "not-found" });
    expect(planQuery.eq).toHaveBeenCalledWith("student_id", studentId);
    expect(planQuery.eq).toHaveBeenCalledWith("week_start", weekStart);
  });

  it("accepts legacy exact paths and UUID-prefixed replacement paths", async () => {
    const replacementPlan = {
      ...plan,
      file_path: `${studentId}/${weekStart}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-plan.pdf`
    };
    const planQuery = query({ data: replacementPlan, error: null });
    const fake = { from: vi.fn().mockReturnValue(planQuery) };
    const result = await authorizeStudentWeeklyPlan(fake as never, { studentId, weekStart });

    expect(result).toEqual({ status: "ok", plan: replacementPlan });
  });

  it("rejects a path outside the exact student/week prefix", async () => {
    const planQuery = query({
      data: { ...plan, file_path: `${studentId}/${weekStart}/../plan.pdf` },
      error: null
    });
    const fake = { from: vi.fn().mockReturnValue(planQuery) };

    const result = await authorizeStudentWeeklyPlan(fake as never, { studentId, weekStart });

    expect(result).toEqual({ status: "not-found" });
  });
});
