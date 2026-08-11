import {
  loadAdminStudentCorrections,
  loadAdminStudentHalaqaPlan,
  loadAdminStudentSettings,
  loadAdminStudentWeeklyActivity,
  type AdminStudentWorkspaceShell,
  type AdminStudentWorkspaceView
} from "@/lib/admin-student-workspace";
import { adminWeeklyPlanUrl, weeklyPlanPathMatchesExactContext } from "@/lib/admin-weekly-plan";
import { checkInEffectiveDateString } from "@/lib/dates";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { isAllowedWeeklyPlanType } from "@/lib/weekly-plans";
import CorrectionsSection from "./corrections-section";
import HalaqaPlanSection from "./halaqa-plan-section";
import StudentSettingsSection from "./student-settings-section";
import WeeklyActivitySection from "./weekly-activity-section";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export default async function PreservedSection({
  supabase,
  shell,
  view,
  status
}: {
  supabase: SupabaseClient;
  shell: AdminStudentWorkspaceShell;
  view: Exclude<AdminStudentWorkspaceView, "overview">;
  status?: string;
}) {
  if (view === "activity") {
    const data = await loadAdminStudentWeeklyActivity(supabase, shell);
    return <WeeklyActivitySection checkins={data.checkins} effectiveDate={checkInEffectiveDateString()} items={data.items} weekStart={shell.selectedWeekStart} />;
  }

  if (view === "halaqa-plan") {
    const data = await loadAdminStudentHalaqaPlan(supabase, shell);
    const planHasExactPath = Boolean(data.weeklyPlan && weeklyPlanPathMatchesExactContext(
      shell.student.id,
      shell.selectedWeekStart,
      data.weeklyPlan.file_path,
      data.weeklyPlan.file_name
    ));
    const planDownloadUrl = planHasExactPath
      ? adminWeeklyPlanUrl(shell.student.id, shell.selectedWeekStart, "attachment")
      : null;
    const planPreviewUrl = planHasExactPath && data.weeklyPlan && isAllowedWeeklyPlanType(data.weeklyPlan.file_type)
      ? adminWeeklyPlanUrl(shell.student.id, shell.selectedWeekStart, "inline")
      : null;
    return (
      <HalaqaPlanSection
        grade={data.halaqaGrade}
        plan={data.weeklyPlan}
        planDownloadUrl={planDownloadUrl}
        planPreviewUrl={planPreviewUrl}
        status={status}
        studentId={shell.student.id}
        weekStart={shell.selectedWeekStart}
      />
    );
  }

  if (view === "corrections") {
    const data = await loadAdminStudentCorrections(supabase, shell);
    return <CorrectionsSection checkins={data.checkins} effectiveDate={checkInEffectiveDateString()} items={data.items} partnerRecitations={data.partnerRecitations} shell={shell} status={status} />;
  }

  const settings = await loadAdminStudentSettings(supabase, shell);
  return <StudentSettingsSection settings={settings} shell={shell} />;
}
