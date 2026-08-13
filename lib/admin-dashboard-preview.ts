import "server-only";

import {
  loadAdminStudentOverview,
  loadAdminStudentWorkspaceShell
} from "@/lib/admin-student-workspace";
import { addDays, checkInEffectiveDateString, friendlyDate } from "@/lib/dates";
import type { createServerSupabaseClient } from "@/lib/supabase-server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type AdminDashboardStudentPreview = {
  studentId: string;
  studentName: string;
  studentContact: string | null;
  dailyPoints: number;
  partnerPoints: number;
  halaqaPoints: number;
  percentage: number;
  dueDays: number;
  savedDays: number;
  recentActivity: Array<{
    date: string;
    label: string;
    status: "saved" | "missing" | "open" | "upcoming";
    statusLabel: string;
  }>;
};

export async function loadAdminDashboardStudentPreview(
  supabase: SupabaseClient,
  input: { studentId: string; selectedWeekStart: string }
): Promise<AdminDashboardStudentPreview> {
  const shell = await loadAdminStudentWorkspaceShell(supabase, input);
  const overview = await loadAdminStudentOverview(supabase, shell);
  const today = checkInEffectiveDateString();
  const checkinByDate = new Map(overview.checkins.map((checkin) => [checkin.date, checkin]));
  const recentActivity = Array.from({ length: 3 }, (_, index) => addDays(input.selectedWeekStart, index)).map((date) => {
    const checkin = checkinByDate.get(date);
    const status: AdminDashboardStudentPreview["recentActivity"][number]["status"] = checkin?.completed
      ? "saved"
      : date < today
        ? "missing"
        : date === today
          ? "open"
          : "upcoming";
    const statusLabel = status === "saved"
      ? `Saved · ${Math.round(Number(checkin?.daily_score ?? 0))}%`
      : status === "missing"
        ? "Missing"
        : status === "open"
          ? "Open today"
          : "Upcoming · Not due";

    return { date, label: friendlyDate(date), status, statusLabel };
  });

  return {
    studentId: shell.student.id,
    studentName: shell.student.name,
    studentContact: shell.student.phone || shell.student.email,
    dailyPoints: overview.weeklyScore.daily_points,
    partnerPoints: overview.weeklyScore.partner_points,
    halaqaPoints: overview.weeklyScore.halaqa_points,
    percentage: overview.weeklyScore.percentage,
    dueDays: overview.dailyProgress.due_days,
    savedDays: overview.dailyProgress.submitted_days,
    recentActivity
  };
}
