import { randomUUID } from "crypto";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { redirect } from "next/navigation";
import AppNav from "@/app/nav";
import { RotationAvailabilityProvider } from "@/app/admin/rotation/availability-state";
import RotationScopeSelector from "@/app/admin/rotation/scope-selector";
import RotationStepIndicator from "@/app/admin/rotation/rotation-step-indicator";
import SessionRosterEditor from "@/app/admin/rotation/session-roster-editor";
import { loadSessionRosterPageData } from "@/app/admin/rotation/session-roster-data";
import StudentAvailabilityForm from "@/app/admin/rotation/student-availability-form";
import TeacherAvailabilityForm from "@/app/admin/rotation/teacher-availability-form";
import { ROTATION_STATUS_MESSAGES, loadRotationPageData, type RotationSearchParams } from "@/app/admin/rotation/data";
import { formatHalaqaSaturday } from "@/lib/dates";
import { rotationPath } from "@/lib/rotation-scope";
import { clampRotationWizardStep, parseRotationWizardStep, rotationWizardUnlockedSteps, type RotationWizardStep } from "@/lib/rotation-workflow";
import { requireProfile } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function AdminRotationPage({ searchParams }: { searchParams: Promise<RotationSearchParams> }) {
  const params = await searchParams;
  const { profile } = await requireProfile(["admin"]);
  const data = await loadRotationPageData({ profile, searchParams: params, publicationRequestId: randomUUID() });
  if (data.canonicalPath) redirect(data.canonicalPath);

  const roster = data.context ? await loadSessionRosterPageData({ context: data.context, profile, weekStart: data.selectedWeekStart }) : null;
  const requestedStep = parseRotationWizardStep(params.step);
  const availableTeacherCount = data.teachers.filter((teacher) => teacher.available).length;
  const readiness = roster?.draft?.readiness;
  const groupsValid = Boolean(roster?.published.version || (readiness && !readiness.source_stale && readiness.unplaced_count === 0 && readiness.missing_primary_teachers.length === 0 && !readiness.group_count_mismatch_confirmation_required && !readiness.permanent_anchor_mismatch_confirmation_required));
  const publishedPlanExists = Boolean(roster?.published.version);
  const unlocked = rotationWizardUnlockedSteps({ studentsSaved: Boolean(data.context), availableTeacherCount: publishedPlanExists ? Math.max(1, availableTeacherCount) : availableTeacherCount, groupsGenerated: Boolean(publishedPlanExists || roster?.draft?.groups.length), groupsValid });
  const step = clampRotationWizardStep(requestedStep, unlocked);

  function pathFor(nextStep: RotationWizardStep) {
    if (!data.context) return "/admin/rotation";
    return rotationPath({ masjidId: data.context.masjid.id, cohortId: data.context.cohort.id, weekStart: data.selectedWeekStart, step: nextStep });
  }
  if (params.step !== requestedStep && data.context) redirect(pathFor(requestedStep));
  if (step !== requestedStep && data.context) redirect(pathFor(step));

  const status = params.status ? ROTATION_STATUS_MESSAGES[params.status] : null;
  const absentCount = data.students.filter((student) => !student.available).length;
  const wizardSetupIssues = data.setupIssues.filter((issue) =>
    issue.startsWith("No active halaqa groups") ||
    issue.startsWith("No active students") ||
    issue.startsWith("No active teachers")
  );
  const pageCopy = {
    students: "Prepare this Saturday’s attendance, teachers, groups, and responsibilities.",
    teachers: "Available teachers determine the default number of session groups.",
    groups: "Available teachers determine the default number of session groups.",
    review: "Confirm the complete Saturday plan before publishing."
  }[step];

  return <>
    <AppNav activeHref="/admin/rotation" role={profile.role} name={profile.name} variant="rotation" />
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
      <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)] lg:items-end">
        <div><p className="text-sm font-semibold uppercase tracking-wide text-gold">Saturday halaqa operations</p><div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight text-ink">Weekly rotation</h1>{roster?.draft && !roster.draft.readiness.source_stale ? <span className="rounded bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-900">Draft saved</span> : null}</div><p className="mt-1 text-sm text-stone-600">{pageCopy}</p></div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1"><RotationScopeSelector contexts={data.contexts} selectedCohortId={params.cohort} selectedMasjidId={params.masjid} selectedStep={step} selectedWeekStart={data.selectedWeekStart} /></div>
          {data.context ? <form className="flex min-w-56 items-end gap-2"><input name="masjid" type="hidden" value={data.context.masjid.id} /><input name="cohort" type="hidden" value={data.context.cohort.id} /><input name="step" type="hidden" value={step} /><label className="min-w-0 flex-1"><span className="text-xs font-semibold uppercase text-stone-500">Week</span><input className="mt-1 min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" defaultValue={data.selectedWeekStart} name="week" type="date" /></label><button className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink">Apply</button></form> : null}
        </div>
      </header>

      {data.context ? <RotationStepIndicator activeStep={step} hrefFor={pathFor} unlocked={unlocked} /> : null}
      {status ? <p className={`mt-4 rounded-md px-3 py-2.5 text-sm ${status.className}`}>{status.text}</p> : null}
      {wizardSetupIssues.length ? <div className="mt-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Needs attention</p><ul className="mt-1 list-disc pl-5">{wizardSetupIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}

      <div className="mt-5">
        {!data.context ? <section className="rounded-lg border border-stone-200 bg-white p-6"><h2 className="text-xl font-semibold text-ink">Rotation unavailable</h2><p className="mt-2 text-sm text-stone-600">No authorized masjid and cohort context is available for this admin.</p></section> : null}
        {data.context && step === "students" ? <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-gold">Step 1</p><h2 className="mt-1 text-2xl font-semibold text-ink">Student availability</h2><p className="mt-1 text-sm text-stone-600">Students attend by default; absences apply only to {formatHalaqaSaturday(data.selectedWeekStart)}.</p></div><div className="grid grid-cols-3 divide-x divide-stone-200"><Metric label="Students" value={data.students.length} /><Metric label="Attending" value={data.students.length - absentCount} /><Metric label="Absent" value={absentCount} danger /></div></div>
          <StudentAvailabilityForm cohortId={data.context.cohort.id} continueHref={pathFor("teachers")} masjidId={data.context.masjid.id} saturdayLabel={formatHalaqaSaturday(data.selectedWeekStart)} students={data.students} weekStart={data.selectedWeekStart} />
        </section> : null}
        {data.context && step === "teachers" ? <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-gold">Step 2</p><h2 className="mt-1 text-2xl font-semibold text-ink">Teacher availability</h2><p className="mt-1 text-sm text-stone-600">Choose who can teach this cohort on Saturday. Groups are assigned in the next step.</p></div><div className="grid grid-cols-3 divide-x divide-stone-200"><Metric label="Active" value={data.teachers.length} /><Metric label="Available" value={availableTeacherCount} /><Metric label="Next: groups" value={availableTeacherCount} /></div></div>
          <RotationAvailabilityProvider initialAvailableTeacherIds={data.teachers.filter((teacher) => teacher.available).map((teacher) => teacher.id)}><TeacherAvailabilityForm backHref={pathFor("students")} cohortId={data.context.cohort.id} continueHref={pathFor("groups")} masjidId={data.context.masjid.id} teachers={data.teachers} weekStart={data.selectedWeekStart} /></RotationAvailabilityProvider>
          {availableTeacherCount === 0 ? <p className="mt-4 border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-800">At least one available teacher is required before session groups can be created.</p> : <p className="mt-4 flex items-center gap-2 border border-green-200 bg-green-50 p-3 text-sm text-green-900"><CheckCircle className="size-5" />{availableTeacherCount} available {availableTeacherCount === 1 ? "teacher" : "teachers"} → {availableTeacherCount} default session {availableTeacherCount === 1 ? "group" : "groups"}.</p>}
        </section> : null}
        {data.context && roster && (step === "groups" || step === "review") ? <SessionRosterEditor actorNames={roster.actorNames} cohortId={data.context.cohort.id} initialDraft={roster.draft} initialHistory={roster.history} initialPublished={roster.published} legacyTransition={roster.legacyTransition} masjidId={data.context.masjid.id} paths={{ students: pathFor("students"), teachers: pathFor("teachers"), groups: pathFor("groups"), review: pathFor("review") }} step={step} weekStart={data.selectedWeekStart} /> : null}
      </div>
    </main>
  </>;
}

function Metric({ danger = false, label, value }: { danger?: boolean; label: string; value: number }) { return <div className="min-w-20 px-3 text-center"><p className={`text-2xl font-semibold ${danger && value ? "text-red-700" : "text-moss"}`}>{value}</p><p className="text-xs text-stone-600">{label}</p></div>; }
