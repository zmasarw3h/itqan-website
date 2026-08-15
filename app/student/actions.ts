"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  blankCheckInItemPayloads,
  calculateTotalsFromCompletedKeys,
  normalizeNote
} from "@/lib/checkins";
import { checkInEffectiveDateString, weekStartForDate } from "@/lib/dates";
import { assertNoDuplicatePartnerRecitation } from "@/lib/partner-recitations";
import { partnerRoundForDate, PARTNER_RECITATION_POINTS_PER_ROUND, tasksForDate } from "@/lib/scoring";
import { requireStudentScopeForWeek } from "@/lib/student-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import { findOrCreateBlockingAccountabilityObligation } from "@/lib/weekly-incentives";
import { currentWeeklyPlanContext, weeklyPlanBlocksCheckIn } from "@/lib/weekly-plans";
import type { CheckIn, CheckInItem, PartnerRecitation, WeeklyPlan } from "@/lib/types";

export async function attestAccountabilityPaid(obligationId: string) {
  const { supabase } = await requireProfile(["student"]);

  if (!obligationId) {
    redirect("/student/check-in?status=accountability-error");
  }

  const { data, error } = await supabase.rpc("attest_oldest_accountability_obligation", {
    input_obligation_id: obligationId
  });

  if (
    error
    || !data
    || typeof data !== "object"
    || Array.isArray(data)
    || (data as { status?: unknown }).status !== "attested_paid"
  ) {
    redirect("/student/check-in?status=accountability-error");
  }

  revalidatePath("/student/check-in");
  redirect("/student/check-in?status=accountability-attested");
}

type SaveTodayChecklistResult =
  | {
      ok: true;
      completedTaskKeys: string[];
      earnedWeight: number;
      totalWeight: number;
      dailyScore: number;
      savedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

type SaveTodayNoteResult =
  | {
      ok: true;
      note: string | null;
      completedTaskKeys: string[];
      earnedWeight: number;
      totalWeight: number;
      dailyScore: number;
      savedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

function checkInSelect() {
  return "id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin";
}

async function findOrCreateTodayCheckIn() {
  const { supabase, profile } = await requireProfile(["student"]);
  const { effectiveDate: today, weekStart } = currentWeeklyPlanContext();
  await requireStudentScopeForWeek(supabase, profile.id, weekStart);

  const { data: currentWeeklyPlan } = await supabase
    .from("weekly_plans")
    .select("week_start")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .maybeSingle<Pick<WeeklyPlan, "week_start">>();

  if (weeklyPlanBlocksCheckIn(currentWeeklyPlan ?? null, today)) {
    throw new Error("Upload this week's weekly plan before using today's checklist.");
  }

  const adminSupabase = createSupabaseAdminClient();
  const blockingObligation = await findOrCreateBlockingAccountabilityObligation({
    supabase,
    adminSupabase,
    studentId: profile.id,
    today
  });

  if (blockingObligation) {
    throw new Error("Confirm the required sadaqa before opening today's checklist.");
  }

  const totalWeight = tasksForDate(today).reduce((sum, task) => sum + task.weight, 0);

  const { data: existing, error: existingError } = await supabase
    .from("checkins")
    .select(checkInSelect())
    .eq("student_id", profile.id)
    .eq("date", today)
    .maybeSingle<CheckIn>();

  if (existingError) {
    throw new Error("Unable to load today's checklist.");
  }

  if (existing) {
    return { supabase, profile, today, checkin: existing };
  }

  const savedAt = new Date().toISOString();
  const { data: created, error: createError } = await supabase
    .from("checkins")
    .insert({
      student_id: profile.id,
      date: today,
      completed: true,
      note: null,
      earned_weight: 0,
      total_weight: totalWeight,
      daily_score: 0,
      updated_at: savedAt
    })
    .select(checkInSelect())
    .single<CheckIn>();

  if (createError?.code === "23505") {
    const { data: racedExisting, error: racedExistingError } = await supabase
      .from("checkins")
      .select(checkInSelect())
      .eq("student_id", profile.id)
      .eq("date", today)
      .single<CheckIn>();

    if (racedExistingError || !racedExisting) {
      throw new Error("Unable to load today's checklist.");
    }

    return { supabase, profile, today, checkin: racedExisting };
  }

  if (createError || !created) {
    throw new Error("Unable to create today's checklist.");
  }

  return { supabase, profile, today, checkin: created };
}

async function ensureTodayCheckInItems(input: {
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"];
  checkin: CheckIn;
  studentId: string;
  date: string;
}) {
  const { data: existingItems, error: existingItemsError } = await input.supabase
    .from("checkin_items")
    .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
    .eq("checkin_id", input.checkin.id)
    .returns<CheckInItem[]>();

  if (existingItemsError) {
    throw new Error("Unable to load checklist items.");
  }

  const existingTaskKeys = new Set((existingItems ?? []).map((item) => item.task_key));
  const missingPayloads = blankCheckInItemPayloads({
    checkinId: input.checkin.id,
    studentId: input.studentId,
    date: input.date
  }).filter((payload) => !existingTaskKeys.has(payload.task_key));

  if (missingPayloads.length) {
    const { error: upsertError } = await input.supabase
      .from("checkin_items")
      .upsert(missingPayloads, { onConflict: "checkin_id,task_key", ignoreDuplicates: true });

    if (upsertError) {
      throw new Error("Unable to initialize checklist items.");
    }
  }

  if (!missingPayloads.length) {
    return existingItems ?? [];
  }

  const { data: items, error: itemsError } = await input.supabase
    .from("checkin_items")
    .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
    .eq("checkin_id", input.checkin.id)
    .returns<CheckInItem[]>();

  if (itemsError) {
    throw new Error("Unable to load checklist items.");
  }

  return items ?? [];
}

export async function saveTodayChecklistItem(input: {
  taskKey: string;
  completed: boolean;
}): Promise<SaveTodayChecklistResult> {
  try {
    if (!input || typeof input.taskKey !== "string" || typeof input.completed !== "boolean") {
      return { ok: false, error: "Invalid checklist update." };
    }

    const { supabase, profile, today, checkin } = await findOrCreateTodayCheckIn();
    await ensureTodayCheckInItems({
      supabase,
      checkin,
      studentId: profile.id,
      date: today
    });

    const { data, error } = await supabase.rpc("save_student_checklist_item", {
      input_task_key: input.taskKey,
      input_completed: input.completed
    });

    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Unable to save checklist item.");
    }

    const result = data as {
      completed_task_keys?: unknown;
      earned_weight?: unknown;
      total_weight?: unknown;
      daily_score?: unknown;
      saved_at?: unknown;
    };

    if (
      !Array.isArray(result.completed_task_keys)
      || !result.completed_task_keys.every((taskKey): taskKey is string => typeof taskKey === "string")
      || typeof result.earned_weight !== "number"
      || typeof result.total_weight !== "number"
      || typeof result.daily_score !== "number"
      || typeof result.saved_at !== "string"
    ) {
      throw new Error("Unable to read the authoritative checklist result.");
    }

    revalidatePath("/student/check-in");
    revalidatePath("/student/history");

    return {
      ok: true,
      completedTaskKeys: result.completed_task_keys,
      earnedWeight: result.earned_weight,
      totalWeight: result.total_weight,
      dailyScore: result.daily_score,
      savedAt: result.saved_at
    };
  } catch {
    return {
      ok: false,
      error: "Your checklist change could not be saved. Please try again."
    };
  }
}

export async function saveTodayCheckInNote(input: { note: string }): Promise<SaveTodayNoteResult> {
  try {
    if (!input || typeof input.note !== "string") {
      return { ok: false, error: "Invalid note." };
    }

    const { supabase, profile, today, checkin } = await findOrCreateTodayCheckIn();
    const items = await ensureTodayCheckInItems({
      supabase,
      checkin,
      studentId: profile.id,
      date: today
    });
    const completedTaskKeys = items.filter((item) => item.completed).map((item) => item.task_key);
    const totals = calculateTotalsFromCompletedKeys(today, completedTaskKeys);
    const note = normalizeNote(input.note);
    const savedAt = new Date().toISOString();
    const { error } = await supabase
      .from("checkins")
      .update({
        note,
        earned_weight: totals.earnedWeight,
        total_weight: totals.totalWeight,
        daily_score: totals.dailyScore,
        updated_at: savedAt
      })
      .eq("id", checkin.id)
      .eq("student_id", profile.id);

    if (error) {
      throw new Error("Unable to save note.");
    }

    revalidatePath("/student/check-in");
    revalidatePath("/student/history");

    return {
      ok: true,
      note,
      completedTaskKeys: totals.completedTaskKeys,
      earnedWeight: totals.earnedWeight,
      totalWeight: totals.totalWeight,
      dailyScore: totals.dailyScore,
      savedAt
    };
  } catch {
    return {
      ok: false,
      error: "Your note could not be saved. Please try again."
    };
  }
}

export async function submitPartnerRecitation() {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = checkInEffectiveDateString();
  const weekStart = weekStartForDate(today);
  try {
    await requireStudentScopeForWeek(supabase, profile.id, weekStart);
  } catch {
    redirect("/student/partner-recitation?status=setup-incomplete");
  }

  const round = partnerRoundForDate(today);

  const { data: existing } = await supabase
    .from("partner_recitations")
    .select("student_id,week_start,round")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .eq("round", round)
    .maybeSingle<Pick<PartnerRecitation, "student_id" | "week_start" | "round">>();

  try {
    assertNoDuplicatePartnerRecitation(existing ?? null);
  } catch {
    redirect("/student/partner-recitation?status=duplicate");
  }

  const { error } = await supabase.from("partner_recitations").insert({
    student_id: profile.id,
    week_start: weekStart,
    round,
    points: PARTNER_RECITATION_POINTS_PER_ROUND
  });

  if (error?.code === "23505") {
    redirect("/student/partner-recitation?status=duplicate");
  }

  if (error) {
    redirect("/student/partner-recitation?status=error");
  }

  revalidatePath("/student/partner-recitation");
  revalidatePath("/student/history");
  redirect("/student/partner-recitation?status=submitted");
}
