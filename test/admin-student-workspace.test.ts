import { beforeEach, describe, expect, it, vi } from "vitest";

const { canAdminDeleteStudentMock, canAdminManageStudentForWeekMock } = vi.hoisted(() => ({
  canAdminDeleteStudentMock: vi.fn(),
  canAdminManageStudentForWeekMock: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-scope", () => ({
  canAdminDeleteStudent: canAdminDeleteStudentMock,
  canAdminManageStudentForWeek: canAdminManageStudentForWeekMock
}));

import {
  adminStudentWorkspaceHref,
  loadAdminStudentCorrections,
  loadAdminStudentHalaqaPlan,
  loadAdminStudentOverview,
  loadAdminStudentSettings,
  loadAdminStudentWeeklyActivity,
  loadAdminStudentWorkspaceShell,
  isAdminStudentWorkspaceView,
  normalizeAdminStudentWorkspaceView
} from "@/lib/admin-student-workspace";
import type { CheckIn, CheckInItem, HalaqaGrade, PartnerRecitation, WeeklyPlan } from "@/lib/types";

const studentId = "11111111-1111-4111-8111-111111111111";
const weekStart = "2026-07-19";
const masjidId = "22222222-2222-4222-8222-222222222222";
const cohortId = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";

type FakeCall = { table: string; select: string; terminal: "returns" | "maybeSingle" };

type FakeSupabaseOptions = {
  profile?: Record<string, unknown> | null;
  scope?: Record<string, unknown> | null;
  checkins?: CheckIn[];
  items?: CheckInItem[];
  partnerRecitations?: PartnerRecitation[];
  halaqaGrade?: HalaqaGrade | null;
  weeklyPlan?: WeeklyPlan | null;
  errors?: string[];
  streakData?: unknown[];
  streakError?: boolean;
};

const defaultProfile = {
  id: studentId,
  name: "Student One",
  email: "student@example.com",
  phone: null,
  role: "student",
  active: true,
  score_starts_on: weekStart,
  created_at: "2026-07-01T00:00:00.000Z"
};

const defaultScope = {
  group_id: groupId,
  starts_on: weekStart,
  halaqa_groups: {
    id: groupId,
    name: "Group One",
    cohort_id: cohortId,
    cohorts: {
      id: cohortId,
      name: "Brothers",
      kind: "brothers",
      masjid_id: masjidId,
      masajid: { id: masjidId, name: "Masjid One", slug: "masjid-one" }
    }
  }
};

const defaultCheckin = {
  id: "55555555-5555-4555-8555-555555555555",
  student_id: studentId,
  date: weekStart,
  completed: true,
  note: "Stored note",
  earned_weight: 80,
  total_weight: 100,
  daily_score: 80,
  submitted_at: "2026-07-19T12:00:00.000Z",
  updated_at: "2026-07-19T12:00:00.000Z",
  updated_by_admin: null,
  masjid_id: masjidId,
  cohort_id: cohortId,
  halaqa_group_id: groupId
} as CheckIn;

const defaultItem = {
  id: "66666666-6666-4666-8666-666666666666",
  checkin_id: defaultCheckin.id,
  student_id: studentId,
  date: weekStart,
  task_key: "fajr",
  task_label: "Fajr",
  weight: 20,
  completed: true,
  created_at: "2026-07-19T12:00:00.000Z"
} as CheckInItem;

const defaultPartner = {
  id: "77777777-7777-4777-8777-777777777777",
  student_id: studentId,
  week_start: weekStart,
  round: "round_1",
  points: 75,
  submitted_at: "2026-07-19T12:00:00.000Z",
  masjid_id: masjidId,
  cohort_id: cohortId,
  halaqa_group_id: groupId
} as PartnerRecitation;

const defaultGrade = {
  id: "88888888-8888-4888-8888-888888888888",
  student_id: studentId,
  week_start: weekStart,
  attended: true,
  attendance_points: 100,
  recitation_points: 40,
  notes: "Good work",
  graded_by: "99999999-9999-4999-8999-999999999999",
  graded_at: "2026-07-19T12:00:00.000Z",
  updated_at: "2026-07-19T12:00:00.000Z",
  masjid_id: masjidId,
  cohort_id: cohortId,
  halaqa_group_id: groupId
} as HalaqaGrade;

const defaultPlan = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
} as WeeklyPlan;

function queryFor(
  table: string,
  responseFor: (select: string, terminal: "returns" | "maybeSingle") => { data: unknown; error: { message: string } | null },
  calls: FakeCall[]
) {
  let selected = "";
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn((value: string) => {
    selected = value;
    return builder;
  });
  for (const method of ["eq", "gte", "lte", "in", "order", "limit", "or"]) {
    builder[method] = vi.fn(() => builder);
  }
  for (const terminal of ["returns", "maybeSingle"] as const) {
    builder[terminal] = vi.fn(async () => {
      calls.push({ table, select: selected, terminal });
      return responseFor(selected, terminal);
    });
  }
  return builder;
}

function makeFakeSupabase(options: FakeSupabaseOptions = {}) {
  const calls: FakeCall[] = [];
  const errors = new Set(options.errors ?? []);
  const profile = options.profile === undefined ? defaultProfile : options.profile;
  const scope = options.scope === undefined ? defaultScope : options.scope;
  const checkins = options.checkins ?? [defaultCheckin];
  const items = options.items ?? [defaultItem];
  const partnerRecitations = options.partnerRecitations ?? [defaultPartner];
  const halaqaGrade = options.halaqaGrade === undefined ? defaultGrade : options.halaqaGrade;
  const weeklyPlan = options.weeklyPlan === undefined ? defaultPlan : options.weeklyPlan;

  function response(table: string, selected: string, terminal: "returns" | "maybeSingle") {
    const errorKey = `${table}:${terminal}`;
    const selectedErrorKey = `${table}:${terminal}:${selected}`;
    if (errors.has(errorKey) || errors.has(selectedErrorKey)) {
      return { data: null, error: { message: `Synthetic ${errorKey} error` } };
    }

    if (table === "profiles") return { data: profile, error: null };
    if (table === "student_group_memberships") return { data: scope, error: null };
    if (table === "checkins") {
      return { data: selected === "date" ? [{ date: weekStart }] : checkins, error: null };
    }
    if (table === "checkin_items") return { data: items, error: null };
    if (table === "partner_recitations") {
      return { data: selected === "week_start" ? [{ week_start: weekStart }] : partnerRecitations, error: null };
    }
    if (table === "halaqa_grades") {
      return { data: terminal === "maybeSingle" ? halaqaGrade : [{ week_start: weekStart }], error: null };
    }
    if (table === "weekly_plans") {
      return { data: terminal === "maybeSingle" ? weeklyPlan : [{ week_start: weekStart }], error: null };
    }
    return { data: null, error: { message: `Unexpected table: ${table}` } };
  }

  const from = vi.fn((table: string) => queryFor(table, (selected, terminal) => response(table, selected, terminal), calls));
  const rpc = vi.fn((name: string) => ({
    returns: vi.fn(async () => ({
      data: options.streakData ?? [],
      error: options.streakError ? { message: `Synthetic ${name} error` } : null
    }))
  }));

  return { supabase: { from, rpc }, from, rpc, calls };
}

describe("admin student workspace URL contract", () => {
  it("allows only the five approved sections and defaults invalid values to overview", () => {
    expect(isAdminStudentWorkspaceView("overview")).toBe(true);
    expect(isAdminStudentWorkspaceView("halaqa-plan")).toBe(true);
    expect(isAdminStudentWorkspaceView("not-a-section")).toBe(false);
    expect(normalizeAdminStudentWorkspaceView(undefined)).toBe("overview");
    expect(normalizeAdminStudentWorkspaceView("not-a-section")).toBe("overview");
  });

  it("keeps the canonical week, section, and mutation status together", () => {
    expect(adminStudentWorkspaceHref({
      studentId: "student/with-slash",
      weekStart: "2026-07-19",
      view: "corrections",
      status: "corrected"
    })).toBe(
      "/admin/students/student%2Fwith-slash?week=2026-07-19&view=corrections&status=corrected"
    );
  });
});

describe("admin student workspace server contracts", () => {
  beforeEach(() => {
    canAdminManageStudentForWeekMock.mockReset().mockResolvedValue(true);
    canAdminDeleteStudentMock.mockReset().mockResolvedValue(true);
  });

  it("rejects invalid student/week context before authorization", async () => {
    const fake = makeFakeSupabase();

    await expect(loadAdminStudentWorkspaceShell(fake.supabase as never, {
      studentId: "not-a-uuid",
      selectedWeekStart: "2026-07-20"
    })).rejects.toMatchObject({ code: "invalid-context" });
    expect(canAdminManageStudentForWeekMock).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("rejects a denied scope before loading student or section data", async () => {
    canAdminManageStudentForWeekMock.mockResolvedValue(false);
    const fake = makeFakeSupabase();

    await expect(loadAdminStudentWorkspaceShell(fake.supabase as never, { studentId, selectedWeekStart: weekStart }))
      .rejects.toMatchObject({ code: "scope-denied" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive", { ...defaultProfile, active: false }],
    ["non-student", { ...defaultProfile, role: "teacher" }]
  ] as const)("rejects an %s target even when scope is otherwise available", async (_label, profile) => {
    const fake = makeFakeSupabase({ profile });

    await expect(loadAdminStudentWorkspaceShell(fake.supabase as never, { studentId, selectedWeekStart: weekStart }))
      .rejects.toMatchObject({ code: "not-found" });
  });

  it("distinguishes missing student, missing scope, and shell load errors", async () => {
    await expect(loadAdminStudentWorkspaceShell(
      makeFakeSupabase({ profile: null }).supabase as never,
      { studentId, selectedWeekStart: weekStart }
    )).rejects.toMatchObject({ code: "not-found" });

    await expect(loadAdminStudentWorkspaceShell(
      makeFakeSupabase({ scope: null }).supabase as never,
      { studentId, selectedWeekStart: weekStart }
    )).rejects.toMatchObject({ code: "scope-denied" });

    await expect(loadAdminStudentWorkspaceShell(
      makeFakeSupabase({ errors: ["profiles:maybeSingle"] }).supabase as never,
      { studentId, selectedWeekStart: weekStart }
    )).rejects.toMatchObject({ code: "load-error" });

    await expect(loadAdminStudentWorkspaceShell(
      makeFakeSupabase({ errors: ["student_group_memberships:maybeSingle"] }).supabase as never,
      { studentId, selectedWeekStart: weekStart }
    )).rejects.toMatchObject({ code: "load-error" });
  });

  it("loads the active shell and focused section data without cross-section fetches", async () => {
    const fake = makeFakeSupabase();
    const shell = await loadAdminStudentWorkspaceShell(fake.supabase as never, {
      studentId,
      selectedWeekStart: weekStart
    });

    expect(shell.student).toMatchObject({ id: studentId, role: "student", active: true });
    expect(shell.scope).toMatchObject({ masjidId, cohortId, groupId });
    expect(shell.availableWeekStarts).toContain(weekStart);

    fake.calls.length = 0;
    const overview = await loadAdminStudentOverview(fake.supabase as never, shell);
    expect(overview).toMatchObject({ checkins: [defaultCheckin], partnerRecitations: [defaultPartner], halaqaGrade: defaultGrade });
    expect(new Set(fake.calls.map((call) => call.table))).toEqual(new Set(["checkins", "partner_recitations", "halaqa_grades"]));
    expect(fake.calls.some((call) => call.table === "weekly_plans" || call.table === "checkin_items")).toBe(false);

    fake.calls.length = 0;
    const activity = await loadAdminStudentWeeklyActivity(fake.supabase as never, shell);
    expect(activity).toEqual({ checkins: [defaultCheckin], items: [defaultItem] });
    expect(new Set(fake.calls.map((call) => call.table))).toEqual(new Set(["checkins", "checkin_items"]));

    fake.calls.length = 0;
    const halaqaPlan = await loadAdminStudentHalaqaPlan(fake.supabase as never, shell);
    expect(halaqaPlan).toEqual({ halaqaGrade: defaultGrade, weeklyPlan: defaultPlan });
    expect(new Set(fake.calls.map((call) => call.table))).toEqual(new Set(["halaqa_grades", "weekly_plans"]));
    expect(fake.calls.some((call) => call.table === "partner_recitations")).toBe(false);

    fake.calls.length = 0;
    const corrections = await loadAdminStudentCorrections(fake.supabase as never, shell);
    expect(corrections).toEqual({ checkins: [defaultCheckin], items: [defaultItem], partnerRecitations: [defaultPartner] });
    expect(new Set(fake.calls.map((call) => call.table))).toEqual(new Set(["checkins", "checkin_items", "partner_recitations"]));
    expect(fake.calls.some((call) => call.table === "halaqa_grades" || call.table === "weekly_plans")).toBe(false);

    fake.calls.length = 0;
    const settings = await loadAdminStudentSettings(fake.supabase as never, shell);
    expect(settings.canDeleteStudent).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it("maps section query failures to load-error", async () => {
    const shellFake = makeFakeSupabase();
    const shell = await loadAdminStudentWorkspaceShell(shellFake.supabase as never, {
      studentId,
      selectedWeekStart: weekStart
    });

    await expect(loadAdminStudentOverview(
      makeFakeSupabase({ errors: ["partner_recitations:returns"] }).supabase as never,
      shell
    )).rejects.toMatchObject({ code: "load-error" });
    await expect(loadAdminStudentWeeklyActivity(
      makeFakeSupabase({ errors: ["checkin_items:returns"] }).supabase as never,
      shell
    )).rejects.toMatchObject({ code: "load-error" });
    await expect(loadAdminStudentHalaqaPlan(
      makeFakeSupabase({ errors: ["weekly_plans:maybeSingle"] }).supabase as never,
      shell
    )).rejects.toMatchObject({ code: "load-error" });
    await expect(loadAdminStudentCorrections(
      makeFakeSupabase({ errors: ["partner_recitations:returns"] }).supabase as never,
      shell
    )).rejects.toMatchObject({ code: "load-error" });
  });
});
