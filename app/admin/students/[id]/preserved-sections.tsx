import Link from "next/link";
import { correctPartnerRecitations } from "@/app/admin/actions";
import {
  loadAdminStudentCorrections,
  loadAdminStudentHalaqaPlan,
  loadAdminStudentSettings,
  loadAdminStudentWeeklyActivity,
  type AdminStudentWorkspaceShell,
  type AdminStudentWorkspaceView
} from "@/lib/admin-student-workspace";
import { adminWeeklyPlanUrl, weeklyPlanPathMatchesExactContext } from "@/lib/admin-weekly-plan";
import {
  checkInEffectiveDateString,
  formatDateTimeInAppTimeZone,
  formatWeekRange,
  friendlyDate,
  weekDatesFromStart
} from "@/lib/dates";
import { PARTNER_RECITATION_ROUNDS } from "@/lib/partner-recitations";
import type { createServerSupabaseClient } from "@/lib/supabase-server";
import type { PartnerRecitation } from "@/lib/types";
import { isAllowedWeeklyPlanType } from "@/lib/weekly-plans";
import CorrectionForm, { type CorrectionFormCheckIn } from "./correction-form";
import HalaqaGradeForm from "./halaqa-grade-form";
import StudentDeleteForm from "./student-delete-form";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

function sectionTitle(view: Exclude<AdminStudentWorkspaceView, "overview">) {
  if (view === "activity") return "Weekly activity";
  if (view === "halaqa-plan") return "Halaqa & plan";
  if (view === "corrections") return "Corrections";
  return "Student settings";
}

function partnerRoundLabel(round: PartnerRecitation["round"]) {
  return round === "round_1" ? "Round 1" : "Round 2";
}

export default async function PreservedSection({
  supabase,
  shell,
  view
}: {
  supabase: SupabaseClient;
  shell: AdminStudentWorkspaceShell;
  view: Exclude<AdminStudentWorkspaceView, "overview">;
}) {
  if (view === "activity") {
    const data = await loadAdminStudentWeeklyActivity(supabase, shell);
    const checkinByDate = new Map(data.checkins.map((checkin) => [checkin.date, checkin]));
    const itemsByCheckin = new Map<string, typeof data.items>();
    for (const item of data.items) itemsByCheckin.set(item.checkin_id, [...(itemsByCheckin.get(item.checkin_id) ?? []), item]);

    return (
      <section className="py-8">
        <h2 className="text-2xl font-semibold text-ink">{sectionTitle(view)}</h2>
        <p className="mt-1 text-sm text-stone-600">Saved and missing check-ins for {formatWeekRange(shell.selectedWeekStart)}.</p>
        <div className="mt-5 space-y-3">
          {weekDatesFromStart(shell.selectedWeekStart).map((date) => {
            const checkin = checkinByDate.get(date);
            const items = checkin ? itemsByCheckin.get(checkin.id) ?? [] : [];
            return (
              <details className="rounded-lg border border-stone-200 bg-white" key={date} open={Boolean(checkin)}>
                <summary className="min-h-12 cursor-pointer list-none px-4 py-3 font-medium text-ink">
                  <span className="flex items-center justify-between gap-4">
                    <span>{friendlyDate(date)}</span>
                    <span className="text-sm font-normal text-stone-600">{checkin ? `Saved · ${Math.round(Number(checkin.daily_score ?? 0))}%` : "No saved check-in"}</span>
                  </span>
                </summary>
                {checkin ? (
                  <div className="border-t border-stone-200 px-4 py-4 text-sm text-stone-700">
                    <p>{checkin.earned_weight ?? 0} / {checkin.total_weight ?? 0} checklist points</p>
                    <p className="mt-1">Saved {formatDateTimeInAppTimeZone(checkin.updated_at ?? checkin.submitted_at)}</p>
                    <ul className="mt-3 space-y-1">
                      {items.map((item) => <li key={item.id}>{item.completed ? "Completed" : "Missed"}: {item.task_label} ({item.completed ? item.weight : 0} / {item.weight})</li>)}
                    </ul>
                    <p className="mt-3">Student note: {checkin.note || "No note provided."}</p>
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      </section>
    );
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
    const itemsByCheckin = new Map<string, typeof data.items>();
    for (const item of data.items) itemsByCheckin.set(item.checkin_id, [...(itemsByCheckin.get(item.checkin_id) ?? []), item]);
    const existingCheckIns: CorrectionFormCheckIn[] = data.checkins.map((checkin) => ({
      date: checkin.date,
      status: checkin.completed ? "submitted" : "missing",
      note: checkin.note ?? "",
      completedTaskKeys: (itemsByCheckin.get(checkin.id) ?? []).filter((item) => item.completed).map((item) => item.task_key)
    }));
    const recitationByRound = new Map(data.partnerRecitations.map((round) => [round.round, round]));
    const today = checkInEffectiveDateString();
    const weekDates = weekDatesFromStart(shell.selectedWeekStart);
    const initialDate = weekDates.includes(today) ? today : weekDates[0];
    return (
      <section className="py-8">
        <h2 className="text-2xl font-semibold text-ink">{sectionTitle(view)}</h2>
        <p className="mt-1 text-sm text-stone-600">Correct student-entered records for the selected week. Every change is audited.</p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-lg font-semibold text-ink">Daily check-in correction</h3>
            <CorrectionForm existingCheckIns={existingCheckIns} initialDate={initialDate} maxDate={today} redirectWeek={shell.selectedWeekStart} redirectView={view} studentId={shell.student.id} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-ink">Partner recitation correction</h3>
            <p className="mt-1 text-sm text-stone-600">Students normally record these rounds themselves. Correct them only when needed.</p>
            <form action={correctPartnerRecitations} className="mt-4">
              <input name="student_id" type="hidden" value={shell.student.id} />
              <input name="week_start" type="hidden" value={shell.selectedWeekStart} />
              <input name="redirect_week" type="hidden" value={shell.selectedWeekStart} />
              <input name="redirect_view" type="hidden" value={view} />
              <fieldset className="space-y-3">
                <legend className="sr-only">Partner recitation completion status</legend>
                {PARTNER_RECITATION_ROUNDS.map((round) => {
                  const stored = recitationByRound.get(round);
                  return <label className="flex min-h-16 items-center gap-3 rounded-md border border-stone-200 bg-white p-4" key={round}>
                    <input className="size-5 accent-moss" defaultChecked={Boolean(stored)} name="completed_rounds" type="checkbox" value={round} />
                    <span className="flex-1"><span className="block font-medium text-ink">{partnerRoundLabel(round)}</span><span className="text-sm text-stone-600">{stored ? "Completed" : "Not completed"}</span></span>
                    <strong>{stored?.points ?? 0} / 75</strong>
                  </label>;
                })}
              </fieldset>
              <button className="mt-4 min-h-11 w-full rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink sm:w-auto">Save partner correction</button>
            </form>
          </div>
        </div>
      </section>
    );
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
