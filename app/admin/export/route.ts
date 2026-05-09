import { NextResponse } from "next/server";
import { buildCompletionRows } from "@/lib/checkins";
import { completionRowsToCsv } from "@/lib/csv";
import { currentWeekDates, todayDateString } from "@/lib/dates";
import { getCurrentProfile } from "@/lib/supabase-server";
import type { CheckIn, CompletionStatus, DashboardFilters, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

function filtersFromUrl(url: URL): DashboardFilters {
  const status = url.searchParams.get("status");

  return {
    studentId: url.searchParams.get("student") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
    status: status === "completed" || status === "missing" ? (status as CompletionStatus) : undefined
  };
}

export async function GET(request: Request) {
  const { supabase, profile } = await getCurrentProfile();

  if (!profile || profile.role !== "admin") {
    return new NextResponse("Not found", { status: 404 });
  }

  const filters = filtersFromUrl(new URL(request.url));
  const dates = filters.date ? [filters.date] : currentWeekDates(todayDateString());

  const { data: students } = await supabase
    .from("profiles")
    .select("id,name,email,role,active,created_at")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Profile[]>();

  let checkinQuery = supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,submitted_at,updated_at,updated_by_admin")
    .in("date", dates);

  if (filters.studentId) {
    checkinQuery = checkinQuery.eq("student_id", filters.studentId);
  }

  const { data: checkins } = await checkinQuery.returns<CheckIn[]>();
  const rows = buildCompletionRows(students ?? [], checkins ?? [], dates, filters);
  const csv = completionRowsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="itqan-checkins.csv"'
    }
  });
}
