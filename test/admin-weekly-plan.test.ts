import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminWeeklyPlanAuthorization,
  AdminWeeklyPlanRecord
} from "@/lib/admin-weekly-plan";
import {
  handleAdminWeeklyPlanRoute,
  type AdminWeeklyPlanRouteDependencies
} from "@/lib/admin-weekly-plan-route";

vi.mock("server-only", () => ({}));

const studentId = "11111111-1111-4111-8111-111111111111";
const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const weekStart = "2026-07-19";

const plan: AdminWeeklyPlanRecord = {
  id: "plan-id",
  student_id: studentId,
  week_start: weekStart,
  file_path: `${studentId}/${weekStart}/plan.pdf`,
  file_name: "plan.pdf",
  file_type: "application/pdf",
  file_size: 9,
  uploaded_at: "2026-07-19T12:00:00.000Z",
  masjid_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  cohort_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  halaqa_group_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
};

function request(path: string) {
  return new NextRequest(`https://itqan.test${path}`);
}

function makeDependencies(input?: {
  profileRole?: "admin" | "student";
  authorization?: AdminWeeklyPlanAuthorization;
  file?: Blob | null;
  storageError?: { message: string } | null;
}) {
  const file = input?.file === undefined
    ? new Blob(["pdf-bytes"], { type: "application/pdf" })
    : input.file;
  const download = vi.fn().mockResolvedValue({
    data: file,
    error: input?.storageError ?? (file ? null : { message: "missing" })
  });
  const from = vi.fn().mockReturnValue({ download });
  const authorizeAdminWeeklyPlan = vi.fn().mockResolvedValue(
    input?.authorization ?? { status: "ok", plan }
  );
  const getCurrentProfile = vi.fn().mockResolvedValue({
    user: { id: adminId },
    profile: {
      id: adminId,
      name: "Scoped admin",
      email: "admin@example.com",
      phone: null,
      role: input?.profileRole ?? "admin",
      active: true
    },
    supabase: {}
  });
  const createSupabaseAdminClient = vi.fn().mockReturnValue({
    storage: { from }
  });

  return {
    deps: {
      authorizeAdminWeeklyPlan,
      createSupabaseAdminClient,
      getCurrentProfile
    } as unknown as AdminWeeklyPlanRouteDependencies,
    authorizeAdminWeeklyPlan,
    createSupabaseAdminClient,
    download,
    getCurrentProfile
  };
}

describe("admin weekly-plan preview and download routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an inline preview with exact safe response headers", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminWeeklyPlanRoute(
      request(`/admin/students/${studentId}/weekly-plan/preview?week=${weekStart}`),
      Promise.resolve({ id: studentId }),
      "inline",
      dependencies.deps
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="plan.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("9");
    expect(dependencies.download).toHaveBeenCalledWith(plan.file_path);
  });

  it("returns a separate attachment download with the same short-lived authorization contract", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminWeeklyPlanRoute(
      request(`/admin/students/${studentId}/weekly-plan/download?week=${weekStart}`),
      Promise.resolve({ id: studentId }),
      "attachment",
      dependencies.deps
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="plan.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("does not invoke the authorizer or service-role storage for an unauthorized role", async () => {
    const dependencies = makeDependencies({ profileRole: "student" });
    const response = await handleAdminWeeklyPlanRoute(
      request(`/admin/students/${studentId}/weekly-plan/preview?week=${weekStart}`),
      Promise.resolve({ id: studentId }),
      "inline",
      dependencies.deps
    );

    expect(response.status).toBe(403);
    expect(dependencies.authorizeAdminWeeklyPlan).not.toHaveBeenCalled();
    expect(dependencies.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects malformed or missing tracker context before reading metadata", async () => {
    const dependencies = makeDependencies();
    const response = await handleAdminWeeklyPlanRoute(
      request(`/admin/students/${studentId}/weekly-plan/preview?week=2026-07-20`),
      Promise.resolve({ id: studentId }),
      "inline",
      dependencies.deps
    );

    expect(response.status).toBe(400);
    expect(dependencies.authorizeAdminWeeklyPlan).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-student", { status: "forbidden" }],
    ["cross-masjid", { status: "forbidden" }],
    ["stale historical context", { status: "forbidden" }],
    ["malformed or unsupported metadata", { status: "not-found" }]
  ] as const)("maps %s authorization failures without streaming bytes", async (_label, authorization) => {
    const dependencies = makeDependencies({ authorization });
    const response = await handleAdminWeeklyPlanRoute(
      request(`/admin/students/${studentId}/weekly-plan/preview?week=${weekStart}`),
      Promise.resolve({ id: studentId }),
      "inline",
      dependencies.deps
    );

    expect(response.status).toBe(authorization.status === "forbidden" ? 403 : 404);
    expect(dependencies.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("returns not found when the authorized metadata row has no Storage object", async () => {
    const dependencies = makeDependencies({ file: null });
    const response = await handleAdminWeeklyPlanRoute(
      request(`/admin/students/${studentId}/weekly-plan/preview?week=${weekStart}`),
      Promise.resolve({ id: studentId }),
      "inline",
      dependencies.deps
    );

    expect(response.status).toBe(404);
    expect(dependencies.download).toHaveBeenCalledWith(plan.file_path);
  });
});
