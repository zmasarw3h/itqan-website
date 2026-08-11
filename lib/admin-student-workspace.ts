import "server-only";

import { canAdminDeleteStudent, canAdminManageStudentForWeek } from "@/lib/admin-scope";
export {
  ADMIN_STUDENT_WORKSPACE_VIEWS,
  adminStudentWorkspaceHref,
  isAdminStudentWorkspaceView,
  normalizeAdminStudentWorkspaceView
} from "@/lib/admin-student-workspace-state";
export type { AdminStudentWorkspaceView } from "@/lib/admin-student-workspace-state";
import {
  latestCompletedTrackerWeekStart,
  parseBelow70StreakReadRows,
  type Below70StreakReadRow
} from "@/lib/below70-streak";
import {
  addDays,
  checkInEffectiveDateString,
  isValidDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import {
  calculateDailyScoreProgress,
  calculateWeeklyScore
} from "@/lib/scoring";
import { loadStudentScopeForWeek, type StudentWeekScope } from "@/lib/student-scope";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem, HalaqaGrade, PartnerRecitation, Profile, WeeklyPlan } from "@/lib/types";
import { officialScoringStatus } from "@/lib/official-scoring";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdminStudentWorkspaceStudent = Pick<
  Profile,
  "id" | "name" | "email" | "phone" | "role" | "active" | "score_starts_on" | "created_at"
>;

export type AdminStudentWorkspaceShell = {
  student: AdminStudentWorkspaceStudent;
  selectedWeekStart: string;
  currentTrackerWeekStart: string;
  availableWeekStarts: string[];
  scope: StudentWeekScope;
};

export type AdminStudentDailyRecords = {
  checkins: CheckIn[];
  items: CheckInItem[];
};

export type AdminStudentWeeklyRequirements = {
  partnerRecitations: PartnerRecitation[];
  halaqaGrade: HalaqaGrade | null;
  weeklyPlan: WeeklyPlan | null;
};

export type AdminStudentOverviewData = {
  checkins: CheckIn[];
  partnerRecitations: PartnerRecitation[];
  halaqaGrade: HalaqaGrade | null;
  weeklyScore: ReturnType<typeof calculateWeeklyScore>;
  dailyProgress: ReturnType<typeof calculateDailyScoreProgress>;
  below70Streak: Below70StreakReadRow | null;
  recentWeekStarts: string[];
};

export type AdminStudentSettingsData = {
  canDeleteStudent: boolean;
  scoringStatus: ReturnType<typeof officialScoringStatus>;
  scoreStartsOn: string | null;
};

export class AdminStudentWorkspaceError extends Error {
  constructor(
    public readonly code: "invalid-context" | "scope-denied" | "not-found" | "load-error",
    message: string
  ) {
    super(message);
    this.name = "AdminStudentWorkspaceError";
  }
}

function assertWorkspaceContext(studentId: string, weekStart: string) {
  if (!UUID_PATTERN.test(studentId) || !isValidDateString(weekStart) || weekStartForDate(weekStart) !== weekStart) {
    throw new AdminStudentWorkspaceError("invalid-context", "The student workspace context is invalid.");
  }
}

function canonicalWeekFromDate(date: string) {
  if (!isValidDateString(date)) return null;
  return weekStartForDate(date);
}

async function loadAvailableWeekStarts(
  supabase: SupabaseClient,
  studentId: string,
  currentTrackerWeekStart: string,
  selectedWeekStart: string
) {
  const [checkinRows, partnerRows, halaqaRows, planRows] = await Promise.all([
    supabase
      .from("checkins")
      .select("date")
      .eq("student_id", studentId)
      .returns<Array<{ date: string }>>(),
    supabase
      .from("partner_recitations")
      .select("week_start")
      .eq("student_id", studentId)
      .returns<Array<{ week_start: string }>>(),
    supabase
      .from("halaqa_grades")
      .select("week_start")
      .eq("student_id", studentId)
      .returns<Array<{ week_start: string }>>(),
    supabase
      .from("weekly_plans")
      .select("week_start")
      .eq("student_id", studentId)
      .returns<Array<{ week_start: string }>>()
  ]);

  if (checkinRows.error || partnerRows.error || halaqaRows.error || planRows.error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load student workspace week options.");
  }

  const candidates = [
    currentTrackerWeekStart,
    selectedWeekStart,
    ...(checkinRows.data ?? []).map((row) => canonicalWeekFromDate(row.date)).filter((week): week is string => Boolean(week)),
    ...(partnerRows.data ?? []).map((row) => row.week_start),
    ...(halaqaRows.data ?? []).map((row) => row.week_start),
    ...(planRows.data ?? []).map((row) => row.week_start)
  ];

  return [...new Set(candidates)].filter((weekStart) => {
    try {
      return isValidDateString(weekStart)
        && weekStartForDate(weekStart) === weekStart
        && weekStart <= currentTrackerWeekStart;
    } catch {
      return false;
    }
  }).sort((left, right) => right.localeCompare(left));
}

/**
 * Shared, server-side gate for every student-workspace section. The caller
 * must run this on the same request that loads a section; the browser never
 * supplies the scope or student record as an authorization assertion.
 */
export async function loadAdminStudentWorkspaceShell(
  supabase: SupabaseClient,
  input: { studentId: string; selectedWeekStart: string }
): Promise<AdminStudentWorkspaceShell> {
  assertWorkspaceContext(input.studentId, input.selectedWeekStart);
  const currentTrackerWeekStart = weekStartForDate(checkInEffectiveDateString());

  if (!(await canAdminManageStudentForWeek(supabase, input.studentId, input.selectedWeekStart))) {
    throw new AdminStudentWorkspaceError("scope-denied", "The student is outside the admin scope for this week.");
  }

  let studentResult: {
    data: AdminStudentWorkspaceStudent | null;
    error: { message?: string | null } | null;
  };
  let scope: StudentWeekScope | null;
  let availableWeekStarts: string[];

  try {
    [studentResult, scope, availableWeekStarts] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,name,email,phone,role,active,score_starts_on,created_at")
        .eq("id", input.studentId)
      .eq("role", "student")
      .eq("active", true)
      .maybeSingle<AdminStudentWorkspaceStudent>(),
      loadStudentScopeForWeek(supabase, input.studentId, input.selectedWeekStart),
      loadAvailableWeekStarts(
        supabase,
        input.studentId,
        currentTrackerWeekStart,
        input.selectedWeekStart
      )
    ]);
  } catch (error) {
    if (error instanceof AdminStudentWorkspaceError) throw error;
    throw new AdminStudentWorkspaceError("load-error", "Unable to load the student workspace shell.");
  }

  const { data: student, error: studentError } = studentResult;

  if (studentError) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load student identity.");
  }

  if (!student || student.role !== "student" || !student.active) {
    throw new AdminStudentWorkspaceError("not-found", "Student not found.");
  }

  if (!scope) {
    throw new AdminStudentWorkspaceError("scope-denied", "The student has no operational scope for this week.");
  }

  return {
    student,
    selectedWeekStart: input.selectedWeekStart,
    currentTrackerWeekStart,
    availableWeekStarts,
    scope
  };
}

async function loadCheckinsForWeek(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const { data, error } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin,masjid_id,cohort_id,halaqa_group_id")
    .eq("student_id", studentId)
    .gte("date", weekStart)
    .lte("date", addDays(weekStart, 6))
    .order("date", { ascending: true })
    .returns<CheckIn[]>();

  if (error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load weekly check-ins.");
  }

  return data ?? [];
}

export async function loadAdminStudentDailyRecords(
  supabase: SupabaseClient,
  shell: AdminStudentWorkspaceShell
): Promise<AdminStudentDailyRecords> {
  const checkins = await loadCheckinsForWeek(supabase, shell.student.id, shell.selectedWeekStart);
  const checkinIds = checkins.map((checkin) => checkin.id);

  if (!checkinIds.length) {
    return { checkins, items: [] };
  }

  const { data, error } = await supabase
    .from("checkin_items")
    .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
    .in("checkin_id", checkinIds)
    .order("created_at", { ascending: true })
    .returns<CheckInItem[]>();

  if (error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load stored checklist items.");
  }

  return { checkins, items: data ?? [] };
}

async function loadScoringInputs(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const [partnerResult, gradeResult] = await Promise.all([
    supabase
      .from("partner_recitations")
      .select("id,student_id,week_start,round,points,submitted_at,masjid_id,cohort_id,halaqa_group_id")
      .eq("student_id", studentId)
      .eq("week_start", weekStart)
      .returns<PartnerRecitation[]>(),
    supabase
      .from("halaqa_grades")
      .select("id,student_id,week_start,attended,attendance_points,recitation_points,notes,graded_by,graded_at,updated_at,masjid_id,cohort_id,halaqa_group_id")
      .eq("student_id", studentId)
      .eq("week_start", weekStart)
      .maybeSingle<HalaqaGrade>()
  ]);

  if (partnerResult.error || gradeResult.error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load weekly scoring inputs.");
  }

  return {
    partnerRecitations: partnerResult.data ?? [],
    halaqaGrade: gradeResult.data ?? null
  };
}

async function loadPartnerRecitations(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const { data, error } = await supabase
    .from("partner_recitations")
    .select("id,student_id,week_start,round,points,submitted_at,masjid_id,cohort_id,halaqa_group_id")
    .eq("student_id", studentId)
    .eq("week_start", weekStart)
    .returns<PartnerRecitation[]>();

  if (error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load partner recitations.");
  }

  return data ?? [];
}

async function loadHalaqaGrade(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const { data, error } = await supabase
    .from("halaqa_grades")
    .select("id,student_id,week_start,attended,attendance_points,recitation_points,notes,graded_by,graded_at,updated_at,masjid_id,cohort_id,halaqa_group_id")
    .eq("student_id", studentId)
    .eq("week_start", weekStart)
    .maybeSingle<HalaqaGrade>();

  if (error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load the halaqa grade.");
  }

  return data ?? null;
}

async function loadPlanMetadata(
  supabase: SupabaseClient,
  studentId: string,
  weekStart: string
) {
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at,masjid_id,cohort_id,halaqa_group_id")
    .eq("student_id", studentId)
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyPlan>();

  if (error) {
    throw new AdminStudentWorkspaceError("load-error", "Unable to load weekly-plan metadata.");
  }

  return data ?? null;
}

export async function loadAdminStudentOverview(
  supabase: SupabaseClient,
  shell: AdminStudentWorkspaceShell
): Promise<AdminStudentOverviewData> {
  const [checkins, scoringInputs, streakResult] = await Promise.all([
    loadCheckinsForWeek(supabase, shell.student.id, shell.selectedWeekStart),
    loadScoringInputs(supabase, shell.student.id, shell.selectedWeekStart),
    supabase.rpc("get_student_below70_streak", {
      input_student_id: shell.student.id,
      input_through_week_start: latestCompletedTrackerWeekStart()
    }).returns<Below70StreakReadRow[]>()
  ]);
  let below70Streak: Below70StreakReadRow | null = null;

  if (!streakResult.error) {
    try {
      below70Streak = parseBelow70StreakReadRows(streakResult.data)[0] ?? null;
    } catch {
      below70Streak = null;
    }
  }

  const selectedWeekDates = weekDatesFromStart(shell.selectedWeekStart);
  const checkinByDate = new Map(checkins.map((checkin) => [checkin.date, checkin]));
  const scorable = Boolean(
    shell.student.score_starts_on && shell.selectedWeekStart >= shell.student.score_starts_on
  );
  const dailyScores = scorable
    ? selectedWeekDates.map((date) => checkinByDate.get(date)?.daily_score ?? 0)
    : [];
  const weeklyScore = calculateWeeklyScore({
    dailyScores,
    partnerRecitations: scorable ? scoringInputs.partnerRecitations : [],
    halaqaGrade: scorable ? scoringInputs.halaqaGrade : null
  });
  const effectiveDate = checkInEffectiveDateString();
  const effectiveToday = !selectedWeekDates.includes(effectiveDate) || checkinByDate.has(effectiveDate)
    ? effectiveDate
    : addDays(effectiveDate, -1);

  return {
    checkins,
    partnerRecitations: scoringInputs.partnerRecitations,
    halaqaGrade: scoringInputs.halaqaGrade,
    weeklyScore,
    dailyProgress: calculateDailyScoreProgress({
      weekDates: selectedWeekDates,
      dailyScoresByDate: new Map(checkins.map((checkin) => [checkin.date, checkin.daily_score])),
      today: effectiveToday
    }),
    below70Streak,
    recentWeekStarts: shell.availableWeekStarts.slice(0, 4)
  };
}

export async function loadAdminStudentWeeklyActivity(
  supabase: SupabaseClient,
  shell: AdminStudentWorkspaceShell
) {
  return loadAdminStudentDailyRecords(supabase, shell);
}

export async function loadAdminStudentHalaqaPlan(
  supabase: SupabaseClient,
  shell: AdminStudentWorkspaceShell
): Promise<Pick<AdminStudentWeeklyRequirements, "halaqaGrade" | "weeklyPlan">> {
  const [halaqaGrade, weeklyPlan] = await Promise.all([
    loadHalaqaGrade(supabase, shell.student.id, shell.selectedWeekStart),
    loadPlanMetadata(supabase, shell.student.id, shell.selectedWeekStart)
  ]);

  return {
    halaqaGrade,
    weeklyPlan
  };
}

export async function loadAdminStudentCorrections(
  supabase: SupabaseClient,
  shell: AdminStudentWorkspaceShell
) {
  const [dailyRecords, partnerRecitations] = await Promise.all([
    loadAdminStudentDailyRecords(supabase, shell),
    loadPartnerRecitations(supabase, shell.student.id, shell.selectedWeekStart)
  ]);

  return {
    ...dailyRecords,
    partnerRecitations
  };
}

export async function loadAdminStudentSettings(
  supabase: SupabaseClient,
  shell: AdminStudentWorkspaceShell
): Promise<AdminStudentSettingsData> {
  return {
    canDeleteStudent: await canAdminDeleteStudent(supabase, shell.student.id),
    scoringStatus: officialScoringStatus(shell.student.score_starts_on, shell.currentTrackerWeekStart),
    scoreStartsOn: shell.student.score_starts_on ?? null
  };
}
