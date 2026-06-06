"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canStudentAttestAccountabilityPaid } from "@/lib/accountability";
import {
  blankCheckInItemPayloads,
  calculateTotalsFromCompletedKeys,
  completedTaskKeysAfterToggle,
  normalizeNote,
  taskForDateOrThrow
} from "@/lib/checkins";
import { todayDateString, weekStartForDate } from "@/lib/dates";
import { assertNoDuplicatePartnerRecitation } from "@/lib/partner-recitations";
import { partnerRoundForDate, PARTNER_RECITATION_POINTS_PER_ROUND, tasksForDate } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import { findOrCreateBlockingAccountabilityObligation } from "@/lib/weekly-incentives";
import type { AccountabilityObligation, CheckIn, CheckInItem, PartnerRecitation } from "@/lib/types";

export async function attestAccountabilityPaid(obligationId: string) {
  const { supabase, profile } = await requireProfile(["student"]);

  if (!obligationId) {
    redirect("/student/check-in?status=accountability-error");
  }

  const { data: obligation } = await supabase
    .from("accountability_obligations")
    .select("id,student_id,week_start,weekly_percentage,amount_cents,status")
    .eq("id", obligationId)
    .eq("student_id", profile.id)
    .eq("status", "pending")
    .maybeSingle<Pick<AccountabilityObligation, "id" | "student_id" | "week_start" | "weekly_percentage" | "amount_cents" | "status">>();

  if (!canStudentAttestAccountabilityPaid(profile, obligation ?? null)) {
    redirect("/student/check-in?status=accountability-error");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("accountability_obligations")
    .update({
      status: "attested_paid",
      attested_paid_at: now,
      updated_at: now
    })
    .eq("id", obligationId)
    .eq("student_id", profile.id)
    .eq("status", "pending");

  if (error) {
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
  const today = todayDateString();
  const adminSupabase = createSupabaseAdminClient();
  const blockingObligation = await findOrCreateBlockingAccountabilityObligation({
    supabase: adminSupabase,
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
    taskForDateOrThrow(today, input.taskKey);
    await ensureTodayCheckInItems({
      supabase,
      checkin,
      studentId: profile.id,
      date: today
    });

    const { error: itemUpdateError } = await supabase
      .from("checkin_items")
      .update({
        completed: input.completed
      })
      .eq("checkin_id", checkin.id)
      .eq("task_key", input.taskKey);

    if (itemUpdateError) {
      throw new Error("Unable to save checklist item.");
    }

    const { data: currentItems, error: currentItemsError } = await supabase
      .from("checkin_items")
      .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
      .eq("checkin_id", checkin.id)
      .returns<CheckInItem[]>();

    if (currentItemsError) {
      throw new Error("Unable to load saved checklist items.");
    }

    const completedTaskKeys = completedTaskKeysAfterToggle({
      items: currentItems ?? [],
      taskKey: input.taskKey,
      completed: input.completed
    });
    const totals = calculateTotalsFromCompletedKeys(today, completedTaskKeys);
    const savedAt = new Date().toISOString();
    const { error: checkinUpdateError } = await supabase
      .from("checkins")
      .update({
        earned_weight: totals.earnedWeight,
        total_weight: totals.totalWeight,
        daily_score: totals.dailyScore,
        updated_at: savedAt
      })
      .eq("id", checkin.id)
      .eq("student_id", profile.id);

    if (checkinUpdateError) {
      throw new Error("Unable to save checklist score.");
    }

    revalidatePath("/student/check-in");
    revalidatePath("/student/history");

    return {
      ok: true,
      completedTaskKeys: totals.completedTaskKeys,
      earnedWeight: totals.earnedWeight,
      totalWeight: totals.totalWeight,
      dailyScore: totals.dailyScore,
      savedAt
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save checklist item."
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
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save note."
    };
  }
}

export async function submitPartnerRecitation() {
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const weekStart = weekStartForDate(today);
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
