import Link from "next/link";
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
import StudentDeleteForm from "./student-delete-form";
import WeeklyActivitySection from "./weekly-activity-section";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

function sectionTitle(view: Exclude<AdminStudentWorkspaceView, "overview">) {
  if (view === "activity") return "Weekly activity";
  if (view === "halaqa-plan") return "Halaqa & plan";
  if (view === "corrections") return "Corrections";
  return "Student settings";
}

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
  return (
    <section className="py-8">
      <h2 className="text-2xl font-semibold text-ink">{sectionTitle(view)}</h2>
      <div className="mt-5 rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-ink">Official scoring</h3>
        <p className="mt-1 text-sm text-stone-600">{settings.scoringStatus.description}</p>
        <p className="mt-2 font-medium text-ink">{settings.scoringStatus.label}</p>
        <Link className="mt-4 inline-flex min-h-11 items-center rounded-md border border-moss px-4 py-2.5 text-sm font-semibold text-moss hover:bg-green-50" href={`/admin/students/${shell.student.id}/official-scoring?return_week=${encodeURIComponent(shell.selectedWeekStart)}&return_view=settings`} prefetch={false}>Open scoring settings</Link>
      </div>
      {settings.canDeleteStudent ? <div className="mt-12 rounded-lg border border-red-200 bg-white p-5"><h3 className="text-lg font-semibold text-red-800">Danger zone</h3><StudentDeleteForm redirectView={view} redirectWeek={shell.selectedWeekStart} studentId={shell.student.id} studentName={shell.student.name} /></div> : null}
    </section>
  );
}
