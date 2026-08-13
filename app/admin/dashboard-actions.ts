"use server";

import { loadAdminDashboardStudentPreview } from "@/lib/admin-dashboard-preview";
import { requireProfile } from "@/lib/supabase-server";

export async function loadSelectedStudentPreview(studentId: string, selectedWeekStart: string) {
  const { supabase } = await requireProfile(["admin", "super_admin"]);
  return loadAdminDashboardStudentPreview(supabase, { studentId, selectedWeekStart });
}
