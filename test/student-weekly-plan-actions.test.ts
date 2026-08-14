import { describe, expect, it, vi } from "vitest";

const {
  createSupabaseAdminClientMock,
  redirectMock,
  requireProfileMock,
  requireStudentScopeForWeekMock,
  revalidatePathMock
} = vi.hoisted(() => ({
  createSupabaseAdminClientMock: vi.fn(),
  redirectMock: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  requireProfileMock: vi.fn(),
  requireStudentScopeForWeekMock: vi.fn(),
  revalidatePathMock: vi.fn()
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase-server", () => ({ requireProfile: requireProfileMock }));
vi.mock("@/lib/student-scope", () => ({ requireStudentScopeForWeek: requireStudentScopeForWeekMock }));
vi.mock("@/lib/supabase-admin", () => ({ createSupabaseAdminClient: createSupabaseAdminClientMock }));

import { uploadWeeklyPlan } from "@/app/student/weekly-plan/actions";
import { currentWeeklyPlanContext } from "@/lib/weekly-plans";

const studentId = "11111111-1111-4111-8111-111111111111";

function formWithFile() {
  const form = new FormData();
  form.set("plan", new File(["new plan"], "New Plan.pdf", { type: "application/pdf" }));
  return form;
}

function makeHarness(input?: {
  existingPlan?: Record<string, unknown> | null;
  uploadError?: { message: string } | null;
  metadataError?: { message: string } | null;
}) {
  const context = currentWeeklyPlanContext();
  const events: string[] = [];
  const existingPlan = input?.existingPlan === undefined
    ? {
        id: "old-plan",
        student_id: studentId,
        week_start: context.weekStart,
        file_path: `${studentId}/${context.weekStart}/old-plan.pdf`,
        file_name: "old-plan.pdf",
        file_type: "application/pdf",
        file_size: 8,
        uploaded_at: "2026-08-09T12:00:00.000Z"
      }
    : input.existingPlan;
  const upload = vi.fn(async () => {
    events.push("upload");
    return { error: input?.uploadError ?? null };
  });
  const remove = vi.fn(async (paths: string[]) => {
    events.push(`remove:${paths[0]}`);
    return { data: paths, error: null };
  });
  const storageBucket = { upload, remove };
  const storageClient = {
    storage: {
      from: vi.fn().mockReturnValue(storageBucket)
    }
  };
  const metadataQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingPlan, error: null }),
    upsert: vi.fn(async (row: Record<string, unknown>) => {
      events.push("upsert");
      return { data: row, error: input?.metadataError ?? null };
    })
  };
  const supabase = {
    from: vi.fn().mockReturnValue(metadataQuery)
  };
  const profile = {
    id: studentId,
    name: "Student",
    email: "student@example.com",
    phone: null,
    role: "student" as const,
    active: true
  };

  requireProfileMock.mockResolvedValue({ supabase, profile });
  requireStudentScopeForWeekMock.mockResolvedValue(undefined);

  return {
    context,
    events,
    metadataQuery,
    profile,
    remove,
    storageClient,
    supabase,
    upload
  };
}

describe("student weekly-plan replacement action", () => {
  it("uploads a unique candidate without overwrite, commits metadata, then removes the old object", async () => {
    const harness = makeHarness();
    createSupabaseAdminClientMock.mockReturnValue(harness.storageClient);

    await expect(uploadWeeklyPlan(formWithFile())).rejects.toThrow("REDIRECT:/student/weekly-plan?status=uploaded");

    const uploadCall = harness.upload.mock.calls[0] as unknown as [string, File, Record<string, unknown>];
    const candidatePath = uploadCall[0];
    const options = uploadCall[2];
    expect(candidatePath).toMatch(
      new RegExp(`^${harness.profile.id}/${harness.context.weekStart}/[0-9a-f-]{36}-new-plan\\.pdf$`)
    );
    expect(options).toMatchObject({ contentType: "application/pdf", upsert: false });
    expect(harness.metadataQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ file_path: candidatePath, file_name: "New Plan.pdf" }),
      { onConflict: "student_id,week_start" }
    );
    expect(harness.remove).toHaveBeenCalledWith([
      `${harness.profile.id}/${harness.context.weekStart}/old-plan.pdf`
    ]);
    expect(harness.events).toEqual([
      "upload",
      "upsert",
      `remove:${harness.profile.id}/${harness.context.weekStart}/old-plan.pdf`
    ]);
  });

  it("leaves the existing metadata and object untouched when candidate upload fails", async () => {
    const harness = makeHarness({ uploadError: { message: "already exists" } });
    createSupabaseAdminClientMock.mockReturnValue(harness.storageClient);

    await expect(uploadWeeklyPlan(formWithFile())).rejects.toThrow("REDIRECT:/student/weekly-plan?status=upload-error");

    expect(harness.metadataQuery.upsert).not.toHaveBeenCalled();
    expect(harness.remove).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["upload"]);
  });

  it("removes only the new candidate when metadata commit fails", async () => {
    const harness = makeHarness({ metadataError: { message: "metadata unavailable" } });
    createSupabaseAdminClientMock.mockReturnValue(harness.storageClient);

    await expect(uploadWeeklyPlan(formWithFile())).rejects.toThrow("REDIRECT:/student/weekly-plan?status=save-error");

    const candidatePath = (harness.upload.mock.calls[0] as unknown as [string])[0];
    expect(harness.remove).toHaveBeenCalledWith([candidatePath]);
    expect(harness.remove).not.toHaveBeenCalledWith([
      `${harness.profile.id}/${harness.context.weekStart}/old-plan.pdf`
    ]);
    expect(harness.events).toEqual(["upload", "upsert", `remove:${candidatePath}`]);
  });
});
