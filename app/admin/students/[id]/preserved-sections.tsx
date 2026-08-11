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
import { checkInEffectiveDateString, formatDateTimeInAppTimeZone, formatWeekRange } from "@/lib/dates";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import { isAllowedWeeklyPlanType } from "@/lib/weekly-plans";
import CorrectionsSection from "./corrections-section";
import HalaqaGradeForm from "./halaqa-grade-form";
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
    const planDownloadUrl = data.weeklyPlan
      && isAllowedWeeklyPlanType(data.weeklyPlan.file_type)
      && weeklyPlanPathMatchesExactContext(shell.student.id, shell.selectedWeekStart, data.weeklyPlan.file_path, data.weeklyPlan.file_name)
      ? adminWeeklyPlanUrl(shell.student.id, shell.selectedWeekStart, "attachment")
      : null;
    return (
      <section className="py-8">
        <h2 className="text-2xl font-semibold text-ink">{sectionTitle(view)}</h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-ink">Halaqa grade</h3>
            <p className="mt-1 text-sm text-stone-600">Saturday grade for {formatWeekRange(shell.selectedWeekStart)}</p>
            <HalaqaGradeForm grade={data.halaqaGrade} studentId={shell.student.id} weekStart={shell.selectedWeekStart} redirectView={view} />
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-ink">Weekly plan</h3>
            <p className="mt-1 text-sm text-stone-600">{formatWeekRange(shell.selectedWeekStart)}</p>
            {data.weeklyPlan ? (
              <div className="mt-5">
                <p className="break-words font-medium text-ink">{data.weeklyPlan.file_name}</p>
                <p className="mt-1 text-sm text-stone-600">Uploaded {formatDateTimeInAppTimeZone(data.weeklyPlan.uploaded_at)}</p>
                {planDownloadUrl ? <a className="mt-4 inline-flex min-h-11 items-center rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink" href={planDownloadUrl}>Download plan</a> : null}
              </div>
            ) : <p className="mt-5 rounded-md bg-stone-50 p-4 text-stone-600">No plan uploaded for this week.</p>}
          </div>
        </div>
      </section>
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
