import { NextResponse } from "next/server";
import { buildCompletionRows } from "@/lib/checkins";
import { completionRowsToCsv } from "@/lib/csv";
import { isValidDateString, todayDateString, weekDatesFromStart, weekStartForDate } from "@/lib/dates";
import { getCurrentProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem, CompletionStatus, DashboardFilters, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

function validWeekStart(value: string | null, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

function filtersFromUrl(url: URL, currentWeekStart: string): DashboardFilters {
  const status = url.searchParams.get("status");
  const date = url.searchParams.get("date");

  return {
    studentId: url.searchParams.get("student") ?? undefined,
    date: date && isValidDateString(date) ? date : undefined,
    weekStart: validWeekStart(url.searchParams.get("week"), currentWeekStart),
    status: status === "submitted" || status === "missing" ? (status as CompletionStatus) : undefined
  };
}

export async function GET(request: Request) {
  const { supabase, profile } = await getCurrentProfile();

  if (!profile || profile.role !== "admin") {
    return new NextResponse("Not found", { status: 404 });
  }

  const currentWeekStart = weekStartForDate(todayDateString());
  const filters = filtersFromUrl(new URL(request.url), currentWeekStart);
  const dates = filters.date ? [filters.date] : weekDatesFromStart(filters.weekStart ?? currentWeekStart);

  const { data: students } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Profile[]>();

  let checkinQuery = supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .in("date", dates);

  if (filters.studentId) {
    checkinQuery = checkinQuery.eq("student_id", filters.studentId);
  }

  const { data: checkins } = await checkinQuery.returns<CheckIn[]>();
  const checkinIds = (checkins ?? []).map((checkin) => checkin.id);
  const { data: items } = checkinIds.length
    ? await supabase
        .from("checkin_items")
        .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
        .in("checkin_id", checkinIds)
        .returns<CheckInItem[]>()
    : { data: [] };
  const rows = buildCompletionRows(students ?? [], checkins ?? [], dates, filters, items ?? []);
  const csv = completionRowsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="itqan-checkins.csv"'
    }
  });
}
